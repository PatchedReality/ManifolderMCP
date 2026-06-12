/*
 * Copyright 2026 Patched Reality, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import { basename as posixBasename, join } from 'path/posix';

export interface UploadResult {
  url: string;
  filename: string;
}

export interface ResourceInfo {
  name: string;
  url: string;
  size: number;
  lastModified: Date;
}

export interface BulkUploadResult {
  success: UploadResult[];
  failed: Array<{ path: string; error: string }>;
}

export interface BulkDeleteResult {
  deleted: string[];
  failed: Array<{ name: string; error: string }>;
  skipped: Array<{ name: string; reason: string }>;
}

export interface BulkMoveResult {
  moved: Array<{ sourceName: string; url: string; filename: string }>;
  failed: Array<{ sourceName: string; destName: string; error: string }>;
  skipped: Array<{ sourceName: string; destName: string; reason: string }>;
}

export interface BulkDownloadResult {
  success: Array<{ resourceName: string; localPath: string }>;
  failed: Array<{ resourceName: string; localPath: string; error: string }>;
}

/**
 * Common transport contract for server-side resource files. Implemented by the
 * SSH/SFTP transport (ScpStorage) and the WebDAV transport (WebDavStorage); the
 * MCP resource tools are typed against this interface so transport selection is
 * invisible above the storage layer.
 */
export interface FileStorage {
  upload(localPath: string, targetName?: string): Promise<UploadResult>;
  list(path?: string, filter?: string, recursive?: boolean): Promise<ResourceInfo[]>;
  delete(resourceName: string): Promise<void>;
  move(sourceName: string, destName: string): Promise<{ url: string; filename: string }>;
  download(resourceName: string, localPath: string): Promise<{ resourceName: string; localPath: string }>;
  bulkUpload(files: Array<{ localPath: string; targetName?: string }>): Promise<BulkUploadResult>;
  bulkDelete(resourceNames: string[]): Promise<BulkDeleteResult>;
  bulkMove(moves: Array<{ sourceName: string; destName: string }>): Promise<BulkMoveResult>;
  bulkDownload(downloads: Array<{ resourceName: string; localPath: string }>): Promise<BulkDownloadResult>;
}

/**
 * Reject resource names that escape the resource directory via `..` segments or
 * absolute paths. Returns the resolved path under `basePath` when safe; throws
 * otherwise. Shared by every transport so the path-escape guarantee is identical
 * across SCP and WebDAV.
 */
export function validateResourcePath(basePath: string, resourceName: string): string {
  const resolved = join(basePath, resourceName);
  const normalizedBase = basePath.endsWith('/') ? basePath : basePath + '/';
  if (!resolved.startsWith(normalizedBase)) {
    throw new Error(`Invalid resource path: "${resourceName}" escapes resource directory`);
  }
  return resolved;
}

/**
 * Filter resources by a glob pattern (`*` wildcard, case-insensitive) matched
 * against each entry's basename. Shared by both transports' `list()` so the glob
 * semantics stay identical.
 */
export function globFilter(results: ResourceInfo[], filter: string): ResourceInfo[] {
  const escaped = filter.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp('^' + escaped.replace(/\*/g, '.*') + '$', 'i');
  return results.filter(r => pattern.test(posixBasename(r.name)));
}
