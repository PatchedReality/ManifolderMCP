/*
 * Copyright 2026 Patched Reality, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mock } from 'node:test';
import https from 'node:https';
import { Readable, PassThrough } from 'node:stream';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { WebDavStorage, parseMultistatus } = await import('../dist/storage/WebDavStorage.js');
const { createFileStorage } = await import('../dist/storage/createFileStorage.js');
const { ScpStorage } = await import('../dist/storage/ScpStorage.js');

const BASE = 'https://files.example.com/';
const PREFIX = '/objects/';

function baseProfile(overrides = {}) {
  return {
    fabricUrl: 'wss://fabric.example.com',
    adminKey: 'secret-key',
    filesUrl: BASE,
    resourceUrlPrefix: PREFIX,
    ...overrides,
  };
}

/**
 * Install a mock over https.request. `handler(record)` returns
 * { status, headers, body } per call; defaults to 200/empty. Returns the array
 * of recorded calls (method, url, options/headers, and any written body).
 */
function mockHttps(handler) {
  const calls = [];
  mock.method(https, 'request', (url, options, cb) => {
    const record = {
      method: options.method,
      url: url.toString(),
      host: url.host,
      headers: options.headers || {},
      options,
      writtenChunks: [],
    };
    calls.push(record);

    const result = (handler && handler(record)) || { status: 200, headers: {}, body: '' };

    const res = new Readable({ read() {} });
    res.statusCode = result.status;
    res.headers = result.headers || {};

    const req = new PassThrough();
    // ClientRequest exposes setTimeout; the PassThrough stand-in doesn't, so stub
    // it. Capturing the callback lets a test simulate the idle-timeout firing.
    req.setTimeout = (ms, fn) => {
      record.timeoutMs = ms;
      record.timeoutCb = fn;
      return req;
    };
    req.on('data', c => record.writtenChunks.push(c));
    req.on('finish', () => {
      if (result.timeout) {
        // Simulate a stalled server: never deliver a response, fire the idle
        // timeout instead (the production callback calls req.destroy(err)).
        if (record.timeoutCb) record.timeoutCb();
        return;
      }
      // Once the request body is fully written/ended, deliver the response.
      cb(res);
      res.push(result.body || '');
      res.push(null);
    });
    // For body-less requests our code calls req.end() with no write; 'finish' still fires.
    return req;
  });
  return calls;
}

function tempFile(contents) {
  const dir = mkdtempSync(join(tmpdir(), 'dav-test-'));
  const path = join(dir, 'upload.bin');
  writeFileSync(path, contents);
  return { path, dir };
}

test.afterEach(() => {
  mock.restoreAll();
});

// ---------------------------------------------------------------------------
// Transport selection (the byte-for-byte SCP AC)
// ---------------------------------------------------------------------------

test('createFileStorage returns ScpStorage when filesUrl is absent', () => {
  const storage = createFileStorage(baseProfile({ filesUrl: undefined }));
  assert.ok(storage instanceof ScpStorage);
});

test('createFileStorage returns WebDavStorage when filesUrl is present', () => {
  const storage = createFileStorage(baseProfile());
  assert.ok(storage instanceof WebDavStorage);
});

// ---------------------------------------------------------------------------
// Upload: PUT with Bearer + explicit Content-Length
// ---------------------------------------------------------------------------

test('upload PUTs with Bearer auth and an explicit Content-Length', async () => {
  const { path, dir } = tempFile('hello world'); // 11 bytes
  try {
    const calls = mockHttps(() => ({ status: 201 }));
    const storage = new WebDavStorage(baseProfile());
    const result = await storage.upload(path, 'greeting.txt');

    const put = calls.find(c => c.method === 'PUT');
    assert.ok(put, 'a PUT was issued');
    assert.equal(put.url, BASE + 'greeting.txt');
    assert.equal(put.headers['Authorization'], 'Bearer secret-key');
    assert.equal(put.headers['Content-Length'], '11');
    assert.deepEqual(result, { url: PREFIX + 'greeting.txt', filename: 'greeting.txt' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('upload into a subdir MKCOLs the parent before PUT', async () => {
  const { path, dir } = tempFile('data');
  try {
    const calls = mockHttps(record => (record.method === 'MKCOL' ? { status: 201 } : { status: 201 }));
    const storage = new WebDavStorage(baseProfile());
    await storage.upload(path, 'Forest/oak.glb');

    const mkcol = calls.find(c => c.method === 'MKCOL');
    assert.ok(mkcol, 'parent collection created');
    assert.equal(mkcol.url, BASE + 'Forest');
    const put = calls.find(c => c.method === 'PUT');
    assert.equal(put.url, BASE + 'Forest/oak.glb');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('upload surfaces 507 as a storage-cap error', async () => {
  const { path, dir } = tempFile('too big');
  try {
    mockHttps(() => ({ status: 507 }));
    const storage = new WebDavStorage(baseProfile());
    await assert.rejects(() => storage.upload(path, 'big.glb'), /Insufficient storage \(507\)/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('upload surfaces 401 as an auth error', async () => {
  const { path, dir } = tempFile('x');
  try {
    mockHttps(() => ({ status: 401 }));
    const storage = new WebDavStorage(baseProfile());
    await assert.rejects(() => storage.upload(path, 'x.glb'), /authentication failed \(401\)/i);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// List: PROPFIND Depth 1 + multistatus parse
// ---------------------------------------------------------------------------

const ROOT_MULTISTATUS = `<?xml version="1.0" encoding="utf-8"?>
<D:multistatus xmlns:D="DAV:">
  <D:response>
    <D:href>/</D:href>
    <D:propstat><D:prop><D:resourcetype><D:collection/></D:resourcetype></D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat>
  </D:response>
  <D:response>
    <D:href>/tree.glb</D:href>
    <D:propstat><D:prop>
      <D:getcontentlength>1024</D:getcontentlength>
      <D:getlastmodified>Wed, 11 Jun 2026 10:00:00 GMT</D:getlastmodified>
      <D:resourcetype/>
    </D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat>
  </D:response>
  <D:response>
    <D:href>/Forest/</D:href>
    <D:propstat><D:prop><D:resourcetype><D:collection/></D:resourcetype></D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat>
  </D:response>
</D:multistatus>`;

const FOREST_MULTISTATUS = `<?xml version="1.0" encoding="utf-8"?>
<D:multistatus xmlns:D="DAV:">
  <D:response>
    <D:href>/Forest/</D:href>
    <D:propstat><D:prop><D:resourcetype><D:collection/></D:resourcetype></D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat>
  </D:response>
  <D:response>
    <D:href>/Forest/oak.glb</D:href>
    <D:propstat><D:prop>
      <D:getcontentlength>2048</D:getcontentlength>
      <D:getlastmodified>Wed, 11 Jun 2026 11:00:00 GMT</D:getlastmodified>
      <D:resourcetype/>
    </D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat>
  </D:response>
</D:multistatus>`;

test('list issues PROPFIND Depth 1 and parses files, dropping the self-entry', async () => {
  const calls = mockHttps(() => ({ status: 207, body: ROOT_MULTISTATUS }));
  const storage = new WebDavStorage(baseProfile());
  const results = await storage.list();

  const propfind = calls.find(c => c.method === 'PROPFIND');
  assert.ok(propfind, 'a PROPFIND was issued');
  assert.equal(propfind.headers['Depth'], '1');
  // Non-recursive: only the top-level file, not the Forest collection.
  assert.deepEqual(results.map(r => r.name), ['tree.glb']);
  assert.equal(results[0].url, PREFIX + 'tree.glb');
  assert.equal(results[0].size, 1024);
});

test('list recurses into subdirectories when recursive=true', async () => {
  const calls = mockHttps(record => {
    if (record.url.includes('/Forest')) {
      return { status: 207, body: FOREST_MULTISTATUS };
    }
    return { status: 207, body: ROOT_MULTISTATUS };
  });
  const storage = new WebDavStorage(baseProfile());
  const results = await storage.list(undefined, undefined, true);

  assert.deepEqual(results.map(r => r.name).sort(), ['Forest/oak.glb', 'tree.glb']);
  assert.equal(calls.filter(c => c.method === 'PROPFIND').length, 2);
});

test('list applies a glob filter on basenames', async () => {
  mockHttps(() => ({ status: 207, body: ROOT_MULTISTATUS }));
  const storage = new WebDavStorage(baseProfile());
  const glb = await storage.list(undefined, '*.glb');
  assert.deepEqual(glb.map(r => r.name), ['tree.glb']);
  const png = await storage.list(undefined, '*.png');
  assert.deepEqual(png, []);
});

test('parseMultistatus is namespace-prefix tolerant', () => {
  const noPrefix = ROOT_MULTISTATUS.replace(/D:/g, '');
  const entries = parseMultistatus(noPrefix, '/');
  assert.deepEqual(entries.map(e => e.name).sort(), ['Forest', 'tree.glb']);
});

// ---------------------------------------------------------------------------
// Move / delete / download
// ---------------------------------------------------------------------------

test('move sends MOVE with a Destination header', async () => {
  const calls = mockHttps(() => ({ status: 201 }));
  const storage = new WebDavStorage(baseProfile());
  const result = await storage.move('a.glb', 'b.glb');

  const move = calls.find(c => c.method === 'MOVE');
  assert.ok(move, 'a MOVE was issued');
  assert.equal(move.url, BASE + 'a.glb');
  assert.equal(move.headers['Destination'], BASE + 'b.glb');
  assert.deepEqual(result, { url: PREFIX + 'b.glb', filename: 'b.glb' });
});

test('delete sends DELETE to the resource url', async () => {
  const calls = mockHttps(() => ({ status: 204 }));
  const storage = new WebDavStorage(baseProfile());
  await storage.delete('gone.glb');

  const del = calls.find(c => c.method === 'DELETE');
  assert.ok(del);
  assert.equal(del.url, BASE + 'gone.glb');
});

test('download streams the response body to the local path', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dav-dl-'));
  const localPath = join(dir, 'out.glb');
  try {
    mockHttps(() => ({ status: 200, body: 'GLB-BYTES' }));
    const storage = new WebDavStorage(baseProfile());
    const result = await storage.download('remote.glb', localPath);
    assert.deepEqual(result, { resourceName: 'remote.glb', localPath });
    assert.equal(readFileSync(localPath, 'utf-8'), 'GLB-BYTES');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Directory guard parity with SCP (files-only contract)
// ---------------------------------------------------------------------------

const COLLECTION_PROPFIND = `<?xml version="1.0" encoding="utf-8"?>
<D:multistatus xmlns:D="DAV:">
  <D:response>
    <D:href>/Forest/</D:href>
    <D:propstat><D:prop><D:resourcetype><D:collection/></D:resourcetype></D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat>
  </D:response>
</D:multistatus>`;

const FILE_PROPFIND = `<?xml version="1.0" encoding="utf-8"?>
<D:multistatus xmlns:D="DAV:">
  <D:response>
    <D:href>/tree.glb</D:href>
    <D:propstat><D:prop><D:getcontentlength>10</D:getcontentlength><D:resourcetype/></D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat>
  </D:response>
</D:multistatus>`;

test('delete() on a collection is refused (parity with SCP), no DELETE issued', async () => {
  const calls = mockHttps(record => (record.method === 'PROPFIND' ? { status: 207, body: COLLECTION_PROPFIND } : { status: 204 }));
  const storage = new WebDavStorage(baseProfile());
  await assert.rejects(() => storage.delete('Forest'), /Cannot delete directory/);
  assert.equal(calls.filter(c => c.method === 'DELETE').length, 0, 'no DELETE issued for a directory');
});

test('move() with a collection source is refused (parity with SCP), no MOVE issued', async () => {
  const calls = mockHttps(record => (record.method === 'PROPFIND' ? { status: 207, body: COLLECTION_PROPFIND } : { status: 201 }));
  const storage = new WebDavStorage(baseProfile());
  await assert.rejects(() => storage.move('Forest', 'Grove'), /Cannot move directory/);
  assert.equal(calls.filter(c => c.method === 'MOVE').length, 0, 'no MOVE issued for a directory');
});

test('delete() on a file stat-checks then DELETEs', async () => {
  const calls = mockHttps(record => (record.method === 'PROPFIND' ? { status: 207, body: FILE_PROPFIND } : { status: 204 }));
  const storage = new WebDavStorage(baseProfile());
  await storage.delete('tree.glb');
  assert.equal(calls.filter(c => c.method === 'PROPFIND')[0].headers['Depth'], '0', 'stat is a Depth 0 PROPFIND');
  assert.ok(calls.find(c => c.method === 'DELETE'), 'DELETE issued for a file');
});

test('delete() of a missing resource rejects not-found, no DELETE issued', async () => {
  const calls = mockHttps(() => ({ status: 404 }));
  const storage = new WebDavStorage(baseProfile());
  await assert.rejects(() => storage.delete('gone.glb'), /Resource not found/);
  assert.equal(calls.filter(c => c.method === 'DELETE').length, 0);
});

test('move() sends Overwrite:F (no silent clobber)', async () => {
  const calls = mockHttps(record => (record.method === 'PROPFIND' ? { status: 207, body: FILE_PROPFIND } : { status: 201 }));
  const storage = new WebDavStorage(baseProfile());
  await storage.move('a.glb', 'b.glb');
  const move = calls.find(c => c.method === 'MOVE');
  assert.equal(move.headers['Overwrite'], 'F');
});

// ---------------------------------------------------------------------------
// Request timeout — a stalled server rejects instead of hanging forever
// ---------------------------------------------------------------------------

test('a stalled request arms an idle timeout and rejects when it fires', async () => {
  const calls = mockHttps(() => ({ timeout: true }));
  const storage = new WebDavStorage(baseProfile());
  await assert.rejects(() => storage.list(), /timed out/);
  assert.equal(calls[0].timeoutMs, 30000, 'idle timeout armed at 30s');
});

// ---------------------------------------------------------------------------
// download integrity — truncation rejects and cleans up
// ---------------------------------------------------------------------------

test('download rejects a short-but-clean body and removes the partial file', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dav-trunc-'));
  const localPath = join(dir, 'out.glb');
  try {
    mockHttps(() => ({ status: 200, headers: { 'content-length': '100' }, body: 'short' }));
    const storage = new WebDavStorage(baseProfile());
    await assert.rejects(() => storage.download('remote.glb', localPath), /truncated/);
    assert.equal(existsSync(localPath), false, 'partial file removed on truncation');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('download accepts a body whose length matches Content-Length', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dav-ok-'));
  const localPath = join(dir, 'out.glb');
  try {
    mockHttps(() => ({ status: 200, headers: { 'content-length': '9' }, body: 'GLB-BYTES' }));
    const storage = new WebDavStorage(baseProfile());
    await storage.download('remote.glb', localPath);
    assert.equal(readFileSync(localPath, 'utf-8'), 'GLB-BYTES');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// multistatus: failed-propstat members are skipped (not listed as size-0)
// ---------------------------------------------------------------------------

const MIXED_MULTISTATUS = `<?xml version="1.0" encoding="utf-8"?>
<D:multistatus xmlns:D="DAV:">
  <D:response>
    <D:href>/</D:href>
    <D:propstat><D:prop><D:resourcetype><D:collection/></D:resourcetype></D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat>
  </D:response>
  <D:response>
    <D:href>/good.glb</D:href>
    <D:propstat><D:prop><D:getcontentlength>1024</D:getcontentlength><D:resourcetype/></D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat>
  </D:response>
  <D:response>
    <D:href>/missing.glb</D:href>
    <D:propstat><D:status>HTTP/1.1 404 Not Found</D:status></D:propstat>
  </D:response>
</D:multistatus>`;

test('list skips members whose propstat status is non-2xx', async () => {
  mockHttps(() => ({ status: 207, body: MIXED_MULTISTATUS }));
  const storage = new WebDavStorage(baseProfile());
  const results = await storage.list();
  assert.deepEqual(results.map(r => r.name), ['good.glb'], 'the 404 member is not surfaced');
});

// ---------------------------------------------------------------------------
// filesUrl protocol validation
// ---------------------------------------------------------------------------

test('a non-https filesUrl is rejected at construction with a clear error', () => {
  assert.throws(() => new WebDavStorage(baseProfile({ filesUrl: 'http://files.example.com/' })), /must be an https/);
});

// ---------------------------------------------------------------------------
// unsafeHosts TLS bypass
// ---------------------------------------------------------------------------

test('unsafeHosts host gets rejectUnauthorized: false', async () => {
  const calls = mockHttps(() => ({ status: 204 }));
  const storage = new WebDavStorage(baseProfile({ unsafeHosts: ['files.example.com'] }));
  await storage.delete('x.glb');
  const del = calls.find(c => c.method === 'DELETE');
  assert.equal(del.options.rejectUnauthorized, false);
});

test('hosts not in unsafeHosts keep TLS verification', async () => {
  const calls = mockHttps(() => ({ status: 204 }));
  const storage = new WebDavStorage(baseProfile({ unsafeHosts: ['other.example.com'] }));
  await storage.delete('x.glb');
  const del = calls.find(c => c.method === 'DELETE');
  assert.equal(del.options.rejectUnauthorized, undefined);
});

// ---------------------------------------------------------------------------
// Path-escape parity with ScpStorage
// ---------------------------------------------------------------------------

test('upload rejects names that escape the resource directory', async () => {
  const { path, dir } = tempFile('x');
  try {
    const calls = mockHttps(() => ({ status: 201 }));
    const storage = new WebDavStorage(baseProfile());
    await assert.rejects(() => storage.upload(path, '../escape.txt'), /escapes resource directory/);
    assert.equal(calls.length, 0, 'no request issued for an escaping path');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('delete and move reject escaping paths', async () => {
  const calls = mockHttps(() => ({ status: 204 }));
  const storage = new WebDavStorage(baseProfile());
  await assert.rejects(() => storage.delete('../../etc/passwd'), /escapes resource directory/);
  await assert.rejects(() => storage.move('../a', 'b'), /escapes resource directory/);
  await assert.rejects(() => storage.move('a', '../b'), /escapes resource directory/);
  assert.equal(calls.length, 0, 'no requests issued for escaping paths');
});
