/*
 * Copyright 2026 Patched Reality, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import https from 'node:https';
import { stat, mkdir, unlink } from 'fs/promises';
import { createReadStream, createWriteStream } from 'fs';
import { basename, dirname } from 'path';
import { basename as posixBasename, dirname as posixDirname } from 'path/posix';
import { pipeline } from 'stream/promises';
import { URL } from 'url';
import type { ProfileConfig } from '../config.js';
import {
  validateResourcePath,
  globFilter,
  type FileStorage,
  type UploadResult,
  type ResourceInfo,
  type BulkUploadResult,
  type BulkDeleteResult,
  type BulkMoveResult,
  type BulkDownloadResult,
} from './FileStorage.js';

// Sentinel base for path-escape validation. Resource names are validated against
// this virtual root via the shared guard; a name that resolves outside it (`..`,
// absolute path) is rejected before any request is built.
const VALIDATION_ROOT = '/__dav_root__';

// Socket inactivity timeout for every WebDAV request. This is an idle timeout
// (resets on each byte), not a total deadline — so a long but healthy
// multi-hundred-MB transfer is never cut off, while a wedged/stalled server is
// rejected instead of pending the MCP tool call forever. Mirrors ScpStorage's
// connect `timeout: 30000`.
const REQUEST_IDLE_TIMEOUT_MS = 30000;

interface RawResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

export interface DavEntry {
  /** Path relative to the WebDAV root (no leading slash), as decoded from href. */
  name: string;
  isCollection: boolean;
  size: number;
  lastModified: Date;
}

/**
 * WebDAV transport for server-side resource files. Issues standard WebDAV verbs
 * against the endpoint configured as `filesUrl`, authenticated with the profile's
 * key as a Bearer token.
 *
 * Built on `node:https` (not global `fetch`) so `unsafeHosts` can disable TLS
 * verification per-host — `fetch` offers no per-request escape, and
 * `NODE_TLS_REJECT_UNAUTHORIZED` would disable verification process-wide,
 * including the fabric socket.
 */
export class WebDavStorage implements FileStorage {
  private config: ProfileConfig;
  private unsafeHosts: Set<string>;

  constructor(config: ProfileConfig) {
    this.config = config;
    this.unsafeHosts = new Set(config.unsafeHosts ?? []);
    if (config.filesUrl) {
      let protocol: string | undefined;
      try {
        protocol = new URL(config.filesUrl).protocol;
      } catch {
        throw new Error(`Invalid filesUrl: "${config.filesUrl}" is not a valid URL.`);
      }
      if (protocol !== 'https:') {
        throw new Error(`Invalid filesUrl: "${config.filesUrl}" must be an https:// URL (got "${protocol}").`);
      }
    }
  }

  private isConfigured(): boolean {
    return !!(this.config.filesUrl && this.config.resourceUrlPrefix);
  }

  private ensureConfigured(): void {
    if (!this.isConfigured()) {
      throw new Error('Storage not configured. Add filesUrl and resourceUrlPrefix to your profile.');
    }
  }

  /** Base WebDAV URL with a guaranteed single trailing slash. */
  private baseUrl(): string {
    this.ensureConfigured();
    const raw = this.config.filesUrl!;
    return raw.endsWith('/') ? raw : raw + '/';
  }

  /**
   * Validate a client-supplied resource name and return its normalized,
   * URL-encoded relative path (segment-by-segment) for use against the WebDAV
   * base. Throws on escape before any request is issued.
   */
  private encodeRelative(resourceName: string): string {
    const resolved = validateResourcePath(VALIDATION_ROOT, resourceName);
    const relative = resolved.slice(VALIDATION_ROOT.length + 1);
    return relative
      .split('/')
      .map(seg => encodeURIComponent(seg))
      .join('/');
  }

  private urlFor(resourceName: string): string {
    return this.baseUrl() + this.encodeRelative(resourceName);
  }

  private authHeaders(): Record<string, string> {
    const headers: Record<string, string> = {};
    if (this.config.adminKey) {
      headers['Authorization'] = `Bearer ${this.config.adminKey}`;
    }
    return headers;
  }

  /**
   * Build the URL + request options shared by every WebDAV request: auth headers
   * merged in and the per-host `rejectUnauthorized` TLS-bypass guard applied.
   * Centralized so the TLS/auth setup can never drift between the three request
   * sites (a missed copy is how a security guard silently disappears on one path).
   */
  private buildReq(
    method: string,
    urlStr: string,
    extraHeaders?: Record<string, string>
  ): { url: URL; reqOptions: https.RequestOptions } {
    const url = new URL(urlStr);
    const reqOptions: https.RequestOptions = {
      method,
      headers: { ...this.authHeaders(), ...extraHeaders },
    };
    if (this.unsafeHosts.has(url.host)) {
      reqOptions.rejectUnauthorized = false;
    }
    return { url, reqOptions };
  }

  /**
   * Arm the socket inactivity timeout. On expiry the request is destroyed, which
   * surfaces through the request's `error` handler as a rejection rather than a
   * hung promise.
   */
  private armTimeout(req: import('node:http').ClientRequest, method: string): void {
    req.setTimeout(REQUEST_IDLE_TIMEOUT_MS, () => {
      req.destroy(new Error(`WebDAV ${method} timed out after ${REQUEST_IDLE_TIMEOUT_MS}ms of inactivity`));
    });
  }

  /** Buffer a response body into a `RawResponse`. Used by the request paths that
   *  consume the whole body (everything except the streamed `download`). */
  private collectBody(res: import('node:http').IncomingMessage): Promise<RawResponse> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve({
        status: res.statusCode ?? 0,
        headers: res.headers,
        body: Buffer.concat(chunks).toString('utf-8'),
      }));
      res.on('error', reject);
    });
  }

  private request(
    method: string,
    urlStr: string,
    options: { headers?: Record<string, string>; body?: string } = {}
  ): Promise<RawResponse> {
    return new Promise((resolve, reject) => {
      const { url, reqOptions } = this.buildReq(method, urlStr, options.headers);
      const req = https.request(url, reqOptions, res => {
        this.collectBody(res).then(resolve, reject);
      });
      req.on('error', reject);
      this.armTimeout(req, method);
      if (options.body !== undefined) {
        req.write(options.body);
      }
      req.end();
    });
  }

  /**
   * Map a WebDAV response status onto the storage error contract. 401 → auth
   * error, 507 → storage-cap error, 404 → not-found, other non-2xx → generic.
   */
  private assertOk(method: string, resourceName: string, res: RawResponse): void {
    if (res.status >= 200 && res.status < 300) {
      return;
    }
    if (res.status === 401) {
      throw new Error('WebDAV authentication failed (401): invalid or missing key');
    }
    if (res.status === 507) {
      throw new Error(`Insufficient storage (507): server storage cap reached while writing "${resourceName}"`);
    }
    if (res.status === 403) {
      throw new Error(`WebDAV ${method} forbidden (403): "${resourceName}"`);
    }
    if (res.status === 404) {
      throw new Error(`Resource not found: "${resourceName}"`);
    }
    const snippet = res.body ? `: ${res.body.slice(0, 200)}` : '';
    throw new Error(`WebDAV ${method} failed (${res.status})${snippet}`);
  }

  /**
   * Create the ancestor collections of a target name top-down via MKCOL. An
   * already-existing collection (405/301) is tolerated; any other failure throws.
   */
  private async ensureParentDirs(resourceName: string): Promise<void> {
    const parent = posixDirname(resourceName);
    if (!parent || parent === '.' || parent === '/') {
      return;
    }
    const segments = parent.split('/').filter(Boolean);
    let prefix = '';
    for (const segment of segments) {
      prefix = prefix ? `${prefix}/${segment}` : segment;
      const res = await this.request('MKCOL', this.urlFor(prefix));
      // 201 created; 405/301 already exists — both fine. Anything else is fatal.
      if (res.status === 201 || res.status === 405 || res.status === 301) {
        continue;
      }
      this.assertOk('MKCOL', prefix, res);
    }
  }

  async upload(localPath: string, targetName?: string): Promise<UploadResult> {
    const filename = targetName || basename(localPath);
    // Validate before any network work.
    this.encodeRelative(filename);
    await this.ensureParentDirs(filename);
    await this.putFile(this.urlFor(filename), localPath, filename);
    return {
      url: this.config.resourceUrlPrefix! + filename,
      filename,
    };
  }

  /**
   * PUT a local file with an explicit Content-Length so the server can size the
   * write up front rather than streaming it chunked.
   */
  private async putFile(urlStr: string, localPath: string, resourceName: string): Promise<void> {
    const stats = await stat(localPath);
    return new Promise((resolve, reject) => {
      const { url, reqOptions } = this.buildReq('PUT', urlStr, {
        'Content-Length': String(stats.size),
        'Content-Type': 'application/octet-stream',
      });
      const req = https.request(url, reqOptions, res => {
        this.collectBody(res).then(raw => {
          try {
            this.assertOk('PUT', resourceName, raw);
            resolve();
          } catch (err) {
            reject(err);
          }
        }, reject);
      });
      req.on('error', reject);
      this.armTimeout(req, 'PUT');
      const source = createReadStream(localPath);
      source.on('error', reject);
      source.pipe(req);
    });
  }

  async list(path?: string, filter?: string, recursive?: boolean): Promise<ResourceInfo[]> {
    this.ensureConfigured();
    const results: ResourceInfo[] = [];
    const prefix = path ? path.replace(/\/+$/, '') + '/' : '';

    const listDir = async (relDir: string, relativePrefix: string): Promise<void> => {
      const entries = await this.propfindDepth1(relDir);
      for (const entry of entries) {
        if (entry.isCollection) {
          if (recursive) {
            await listDir(entry.name, entry.name + '/');
          }
        } else {
          const name = relativePrefix + posixBasename(entry.name);
          results.push({
            name,
            url: this.config.resourceUrlPrefix! + name,
            size: entry.size,
            lastModified: entry.lastModified,
          });
        }
      }
    };

    await listDir(path ? path.replace(/\/+$/, '') : '', prefix);

    return filter ? globFilter(results, filter) : results;
  }

  /**
   * PROPFIND Depth 1 against the directory at `relDir` (relative to the WebDAV
   * root; '' = root). Returns the immediate children — the self-entry for the
   * requested collection is dropped.
   */
  private async propfindDepth1(relDir: string): Promise<DavEntry[]> {
    const dirUrl = relDir ? this.urlFor(relDir) + '/' : this.baseUrl();
    const res = await this.request('PROPFIND', dirUrl, {
      headers: { Depth: '1', 'Content-Type': 'application/xml' },
    });
    this.assertOk('PROPFIND', relDir || '/', res);
    const requestedPath = new URL(dirUrl).pathname.replace(/\/+$/, '');
    return parseMultistatus(res.body, requestedPath);
  }

  /**
   * PROPFIND Depth 0 to classify a single resource. Returns whether it exists and
   * whether it is a collection (directory). Used to enforce the files-only
   * contract on delete/move — a bare WebDAV DELETE/MOVE on a collection is
   * recursive (RFC 4918), which ScpStorage refuses, so this transport must too.
   */
  private async statResource(resourceName: string): Promise<{ exists: boolean; isCollection: boolean }> {
    const res = await this.request('PROPFIND', this.urlFor(resourceName), {
      headers: { Depth: '0', 'Content-Type': 'application/xml' },
    });
    if (res.status === 404) {
      return { exists: false, isCollection: false };
    }
    this.assertOk('PROPFIND', resourceName, res);
    const entries = parseResponseEntries(res.body);
    return { exists: true, isCollection: entries.length > 0 && entries[0].isCollection };
  }

  async delete(resourceName: string): Promise<void> {
    const target = await this.statResource(resourceName);
    if (!target.exists) {
      throw new Error(`Resource not found: "${resourceName}"`);
    }
    if (target.isCollection) {
      throw new Error(`Cannot delete directory: "${resourceName}" - only files can be deleted`);
    }
    const res = await this.request('DELETE', this.urlFor(resourceName));
    this.assertOk('DELETE', resourceName, res);
  }

  async move(sourceName: string, destName: string): Promise<{ url: string; filename: string }> {
    // Validate both before any network work.
    this.encodeRelative(sourceName);
    this.encodeRelative(destName);
    const source = await this.statResource(sourceName);
    if (!source.exists) {
      throw new Error(`Source resource not found: "${sourceName}"`);
    }
    if (source.isCollection) {
      throw new Error(`Cannot move directory: "${sourceName}" - only files can be moved`);
    }
    await this.ensureParentDirs(destName);
    // Overwrite: 'F' — fail on an existing destination rather than silently
    // replacing it, matching ScpStorage's non-clobbering rename contract.
    const res = await this.request('MOVE', this.urlFor(sourceName), {
      headers: { Destination: this.urlFor(destName), Overwrite: 'F' },
    });
    this.assertOk('MOVE', sourceName, res);
    return {
      url: this.config.resourceUrlPrefix! + destName,
      filename: destName,
    };
  }

  async download(resourceName: string, localPath: string): Promise<{ resourceName: string; localPath: string }> {
    const urlStr = this.urlFor(resourceName);
    await mkdir(dirname(localPath), { recursive: true });
    // Remove a partial/truncated file left by a failed transfer so a later reader
    // or retry never consumes a half-written asset as if it were complete.
    const cleanup = async () => {
      await unlink(localPath).catch(() => {});
    };
    await new Promise<void>((resolve, reject) => {
      const { url, reqOptions } = this.buildReq('GET', urlStr);
      const req = https.request(url, reqOptions, res => {
        const status = res.statusCode ?? 0;
        if (status < 200 || status >= 300) {
          this.collectBody(res).then(raw => {
            try {
              this.assertOk('GET', resourceName, raw);
              resolve();
            } catch (err) {
              reject(err);
            }
          }, reject);
          return;
        }
        const expected = res.headers['content-length'];
        const writer = createWriteStream(localPath);
        pipeline(res, writer)
          .then(async () => {
            // A clean-but-short body (e.g. a proxy dropping the connection
            // mid-transfer) otherwise resolves as success leaving a truncated
            // file. Reject when the declared length doesn't match what landed.
            if (expected !== undefined && writer.bytesWritten !== Number(expected)) {
              await cleanup();
              reject(new Error(`WebDAV GET truncated: expected ${expected} bytes, received ${writer.bytesWritten} for "${resourceName}"`));
              return;
            }
            resolve();
          })
          .catch(async err => {
            await cleanup();
            reject(err);
          });
      });
      req.on('error', reject);
      this.armTimeout(req, 'GET');
      req.end();
    });
    return { resourceName, localPath };
  }

  async bulkUpload(files: Array<{ localPath: string; targetName?: string }>): Promise<BulkUploadResult> {
    const success: UploadResult[] = [];
    const failed: Array<{ path: string; error: string }> = [];
    for (const file of files) {
      try {
        success.push(await this.upload(file.localPath, file.targetName));
      } catch (err) {
        failed.push({ path: file.localPath, error: (err as Error).message });
      }
    }
    return { success, failed };
  }

  async bulkDelete(resourceNames: string[]): Promise<BulkDeleteResult> {
    const deleted: string[] = [];
    const failed: Array<{ name: string; error: string }> = [];
    const skipped: Array<{ name: string; reason: string }> = [];
    for (const name of resourceNames) {
      try {
        await this.delete(name);
        deleted.push(name);
      } catch (err) {
        const message = (err as Error).message;
        if (message.startsWith('Resource not found')) {
          skipped.push({ name, reason: 'File not found' });
        } else if (message.startsWith('Cannot delete directory')) {
          skipped.push({ name, reason: 'Is a directory, not a file' });
        } else {
          failed.push({ name, error: message });
        }
      }
    }
    return { deleted, failed, skipped };
  }

  async bulkMove(moves: Array<{ sourceName: string; destName: string }>): Promise<BulkMoveResult> {
    const moved: Array<{ sourceName: string; url: string; filename: string }> = [];
    const failed: Array<{ sourceName: string; destName: string; error: string }> = [];
    const skipped: Array<{ sourceName: string; destName: string; reason: string }> = [];
    for (const m of moves) {
      try {
        const result = await this.move(m.sourceName, m.destName);
        moved.push({ sourceName: m.sourceName, url: result.url, filename: result.filename });
      } catch (err) {
        const message = (err as Error).message;
        if (message.startsWith('Source resource not found') || message.startsWith('Resource not found')) {
          skipped.push({ sourceName: m.sourceName, destName: m.destName, reason: 'Source file not found' });
        } else if (message.startsWith('Cannot move directory')) {
          skipped.push({ sourceName: m.sourceName, destName: m.destName, reason: 'Source is a directory, not a file' });
        } else {
          failed.push({ sourceName: m.sourceName, destName: m.destName, error: message });
        }
      }
    }
    return { moved, failed, skipped };
  }

  async bulkDownload(downloads: Array<{ resourceName: string; localPath: string }>): Promise<BulkDownloadResult> {
    const success: Array<{ resourceName: string; localPath: string }> = [];
    const failed: Array<{ resourceName: string; localPath: string; error: string }> = [];
    for (const dl of downloads) {
      try {
        await this.download(dl.resourceName, dl.localPath);
        success.push({ resourceName: dl.resourceName, localPath: dl.localPath });
      } catch (err) {
        failed.push({ resourceName: dl.resourceName, localPath: dl.localPath, error: (err as Error).message });
      }
    }
    return { success, failed };
  }

}

/** A parsed `<response>` entry, with the path it referenced and whether its
 *  propstat reported a 2xx status. */
interface ResponseEntry extends DavEntry {
  /** Decoded href pathname, trailing slash trimmed. */
  path: string;
  /** True when the entry has a 2xx propstat status (or no status at all). */
  ok: boolean;
}

/**
 * Low-level WebDAV `multistatus` extractor. Parses every `<response>` block for
 * href, collection-ness, size, last-modified, and propstat status — without any
 * self-entry or status filtering. Regex-based so no XML dependency is needed.
 */
function parseResponseEntries(xml: string): ResponseEntry[] {
  const entries: ResponseEntry[] = [];
  const responseRe = /<(?:[A-Za-z][\w-]*:)?response\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z][\w-]*:)?response>/g;
  let match: RegExpExecArray | null;
  while ((match = responseRe.exec(xml)) !== null) {
    const block = match[1];

    const hrefMatch = /<(?:[A-Za-z][\w-]*:)?href\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z][\w-]*:)?href>/.exec(block);
    if (!hrefMatch) {
      continue;
    }
    let hrefPath: string;
    try {
      const raw = hrefMatch[1].trim();
      // href may be an absolute URL or an absolute path; normalize to a pathname.
      hrefPath = raw.startsWith('http') ? new URL(raw).pathname : raw;
    } catch {
      hrefPath = hrefMatch[1].trim();
    }
    const path = decodeURIComponent(hrefPath).replace(/\/+$/, '');

    // Scope the collection check to the <resourcetype> subtree so a <collection>
    // mentioned elsewhere in the block (e.g. a custom property value) can't
    // false-positive a file as a directory.
    const rtMatch = /<(?:[A-Za-z][\w-]*:)?resourcetype\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z][\w-]*:)?resourcetype>/.exec(block);
    const isCollection = rtMatch ? /<(?:[A-Za-z][\w-]*:)?collection\b/.test(rtMatch[1]) : false;

    const lengthMatch = /<(?:[A-Za-z][\w-]*:)?getcontentlength\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z][\w-]*:)?getcontentlength>/.exec(block);
    const size = lengthMatch ? parseInt(lengthMatch[1].trim(), 10) || 0 : 0;

    const modifiedMatch = /<(?:[A-Za-z][\w-]*:)?getlastmodified\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z][\w-]*:)?getlastmodified>/.exec(block);
    const lastModified = modifiedMatch ? new Date(modifiedMatch[1].trim()) : new Date(0);

    // A member may report its own propstat status; treat a present-but-non-2xx
    // status as "not ok" so failed members aren't surfaced as real entries.
    const statusMatches = block.match(/<(?:[A-Za-z][\w-]*:)?status\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z][\w-]*:)?status>/g);
    const ok = !statusMatches || statusMatches.some(s => /\s2\d\d\b/.test(s));

    const name = path.replace(/^\/+/, '');
    entries.push({ name, isCollection, size, lastModified, path, ok });
  }
  return entries;
}

/**
 * Minimal WebDAV `multistatus` parser for Depth-1 listing. Returns the immediate
 * children: the collection whose href equals `requestedPath` (the PROPFIND target
 * itself) is dropped, and members whose propstat status is non-2xx are skipped so
 * a 207 reporting a failed member never surfaces it as a size-0 file.
 */
export function parseMultistatus(xml: string, requestedPath: string): DavEntry[] {
  const self = decodeURIComponent(requestedPath).replace(/\/+$/, '');
  return parseResponseEntries(xml)
    .filter(e => e.ok && e.path !== self)
    .map(({ name, isCollection, size, lastModified }) => ({ name, isCollection, size, lastModified }));
}
