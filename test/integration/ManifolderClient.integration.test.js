import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { createManifolderPromiseClient } from '../../dist/client/index.js';

const CONFIG_PATH = join(homedir(), '.config', 'manifolder-mcp', 'config.json');
const INTEGRATION_ENABLED = /^(1|true|yes)$/i.test(process.env.FABRIC_IT_ENABLED || '');
const EARTH_INTEGRATION_ENABLED = /^(1|true|yes)$/i.test(process.env.EARTH_IT_ENABLED || '');
const WRITE_ENABLED = /^(1|true|yes)$/i.test(process.env.FABRIC_IT_WRITE || '');
const RUN_ID = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
const SCENE_NAME_PREFIX = process.env.FABRIC_IT_SCENE_PREFIX || 'it-owned';
const EARTH_CONNECT_TIMEOUT_MS = Number.parseInt(process.env.EARTH_IT_TIMEOUT_MS || '15000', 10);
const EARTH_UNSAFE_HOSTS = (process.env.EARTH_IT_UNSAFE_HOSTS || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

if (!INTEGRATION_ENABLED) {
  console.error('[integration] FABRIC_IT_ENABLED is not set; live integration tests will be skipped.');
}
if (!EARTH_INTEGRATION_ENABLED) {
  console.error('[integration] EARTH_IT_ENABLED is not set; earth attachment integration tests will be skipped.');
}

let cachedTarget = null;
let cachedEarthTarget = null;

async function closeAllScopes(client) {
  const scopes = client.listScopes().sort((a, b) => (b.depth ?? 0) - (a.depth ?? 0));
  for (const scope of scopes) {
    await client.closeScope({ scopeId: scope.scopeId, cascade: true }).catch(() => {});
  }
}

function createWriteSafetyHarness(client, scopeId) {
  const ownedSceneIds = new Set();
  const ownedObjectIds = new Set();

  function assertOwnedScene(sceneId) {
    if (!ownedSceneIds.has(sceneId)) {
      throw new Error(`Refusing to mutate non-test scene: ${sceneId}`);
    }
  }

  function assertOwnedObject(objectId) {
    if (!ownedObjectIds.has(objectId)) {
      throw new Error(`Refusing to mutate non-test object: ${objectId}`);
    }
  }

  function assertOwnedParent(parentId) {
    if (parentId === 'root') {
      return;
    }
    if (!ownedSceneIds.has(parentId) && !ownedObjectIds.has(parentId)) {
      throw new Error(`Refusing to create under non-test parent: ${parentId}`);
    }
  }

  return {
    async createScene(baseName, objectType) {
      const sceneName = `${SCENE_NAME_PREFIX}-${RUN_ID}-${baseName}`;
      const created = await client.createScene({ scopeId, name: sceneName, objectType });
      ownedSceneIds.add(created.id);
      return created;
    },
    async deleteScene(sceneId) {
      assertOwnedScene(sceneId);
      await client.deleteScene({ scopeId, sceneId });
      ownedSceneIds.delete(sceneId);
    },
    async createObject(params) {
      assertOwnedParent(params.parentId);
      const created = await client.createObject({ scopeId, ...params });
      ownedObjectIds.add(created.id);
      return created;
    },
    async updateObject(params) {
      assertOwnedObject(params.objectId);
      return client.updateObject({ scopeId, ...params });
    },
    async moveObject(objectId, newParentId) {
      assertOwnedObject(objectId);
      assertOwnedParent(newParentId);
      return client.moveObject({ scopeId, objectId, newParentId });
    },
    async deleteObject(objectId) {
      assertOwnedObject(objectId);
      await client.deleteObject({ scopeId, objectId });
      ownedObjectIds.delete(objectId);
    },
    async cleanup() {
      for (const sceneId of Array.from(ownedSceneIds)) {
        await client.deleteScene({ scopeId, sceneId }).catch(() => {});
        ownedSceneIds.delete(sceneId);
      }
    },
  };
}

function buildEnvTarget() {
  const fabricUrl = process.env.FABRIC_IT_URL || process.env.FABRIC_URL || '';
  if (!fabricUrl) return null;

  return {
    fabricUrl,
    adminKey: process.env.FABRIC_IT_ADMIN_KEY || process.env.FABRIC_ADMIN_KEY || '',
    source: 'env',
  };
}

async function buildConfigTarget() {
  const profileName = process.env.FABRIC_IT_PROFILE || 'default';
  const content = await readFile(CONFIG_PATH, 'utf-8');
  const config = JSON.parse(content);
  const profile = config?.[profileName];

  if (!profile?.fabricUrl) {
    throw new Error(
      `Profile "${profileName}" missing or invalid in ${CONFIG_PATH}. ` +
      'Expected { fabricUrl, adminKey? }.',
    );
  }

  return {
    fabricUrl: profile.fabricUrl,
    adminKey: profile.adminKey || '',
    source: `profile:${profileName}`,
  };
}

async function resolveTarget() {
  if (cachedTarget) return cachedTarget;
  cachedTarget = buildEnvTarget() || await buildConfigTarget();
  return cachedTarget;
}

function buildEarthEnvTarget() {
  const fabricUrl = process.env.EARTH_IT_URL || '';
  if (!fabricUrl) return null;

  return {
    fabricUrl,
    adminKey: process.env.EARTH_IT_ADMIN_KEY || '',
    source: 'earth-env',
  };
}

async function buildEarthConfigTarget() {
  const profileName = process.env.EARTH_IT_PROFILE || '';
  if (!profileName) {
    return null;
  }

  const content = await readFile(CONFIG_PATH, 'utf-8');
  const config = JSON.parse(content);
  const profile = config?.[profileName];

  if (!profile?.fabricUrl) {
    throw new Error(
      `Profile "${profileName}" missing or invalid in ${CONFIG_PATH}. ` +
      'Expected { fabricUrl, adminKey? }.',
    );
  }

  return {
    fabricUrl: profile.fabricUrl,
    adminKey: profile.adminKey || '',
    source: `earth-profile:${profileName}`,
  };
}

async function resolveEarthTarget() {
  if (cachedEarthTarget) return cachedEarthTarget;
  cachedEarthTarget = buildEarthEnvTarget() || await buildEarthConfigTarget();
  return cachedEarthTarget;
}

async function getTargetOrSkip(t, options = {}) {
  if (!INTEGRATION_ENABLED) {
    t.skip(
      'Set FABRIC_IT_ENABLED=1 to run live integration tests. ' +
      'Optional: FABRIC_IT_URL/FABRIC_IT_ADMIN_KEY or FABRIC_IT_PROFILE.',
    );
    return null;
  }

  let target;
  try {
    target = await resolveTarget();
  } catch (err) {
    if (err.code !== "SCOPE_CONNECT_FAILED" && err.code !== "SCOPE_NOT_FOUND" && !err.message?.includes("Timeout") && !err.message?.includes("ECONNREFUSED")) throw err;
    t.skip(`Integration target not configured: ${err.message}`);
    return null;
  }

  if (options.requireAdmin && !target.adminKey) {
    t.skip('This integration test requires adminKey.');
    return null;
  }

  return target;
}

async function getEarthTargetOrSkip(t) {
  if (!EARTH_INTEGRATION_ENABLED) {
    t.skip(
      'Set EARTH_IT_ENABLED=1 to run earth attachment integration tests. ' +
      'Optional Earth target: EARTH_IT_URL or EARTH_IT_PROFILE.',
    );
    return null;
  }

  let target;
  try {
    target = await resolveEarthTarget();
  } catch (err) {
    if (err.code !== "SCOPE_CONNECT_FAILED" && err.code !== "SCOPE_NOT_FOUND" && !err.message?.includes("Timeout") && !err.message?.includes("ECONNREFUSED")) throw err;
    t.skip(`Earth integration target not configured: ${err.message}`);
    return null;
  }

  if (!target) {
    t.skip('Set EARTH_IT_URL or EARTH_IT_PROFILE to run earth attachment integration coverage.');
    return null;
  }

  return target;
}

function registerUnsafeHosts(hosts) {
  if (!hosts.length) {
    return;
  }
  const set = globalThis.__manifolderUnsafeHosts;
  if (!set) {
    return;
  }
  for (const host of hosts) {
    set.add(host);
  }
}

test('integration: connect/disconnect and status metadata', { timeout: 180000, concurrency: false }, async (t) => {
  const target = await getTargetOrSkip(t);
  if (!target) return;

  const client = createManifolderPromiseClient();
  try {
    const connection = await client.connectRoot({ fabricUrl: target.fabricUrl, adminKey: target.adminKey });
    assert.ok(connection.scopeId, `connectRoot() should return scope metadata (${target.source})`);
    assert.equal(client.connected, true);

    const status = client.getScopeStatus({ scopeId: connection.scopeId });
    assert.equal(status.connected, true);
    assert.equal(status.fabricUrl, target.fabricUrl);
    assert.equal(typeof status.resourceRootUrl, 'string');
  } finally {
    await closeAllScopes(client);
    assert.equal(client.connected, false);
  }
});

test('integration: scene browse path works in admin mode', { timeout: 180000, concurrency: false }, async (t) => {
  const target = await getTargetOrSkip(t);
  if (!target) return;

  const client = createManifolderPromiseClient();
  try {
    const connection = await client.connectRoot({ fabricUrl: target.fabricUrl, adminKey: target.adminKey });
    const scopeId = connection.scopeId;

    let scenes;
    try {
      scenes = await client.listScenes({ scopeId });
    } catch (err) {
    if (err.code !== "SCOPE_CONNECT_FAILED" && err.code !== "SCOPE_NOT_FOUND" && !err.message?.includes("Timeout") && !err.message?.includes("ECONNREFUSED")) throw err;
      t.skip(`listScenes unavailable for this server/profile: ${err.message}`);
      return;
    }
    assert.ok(Array.isArray(scenes));
    if (scenes.length === 0) {
      t.skip('No scenes available to open.');
      return;
    }

    const firstScene = scenes[0];
    const opened = await client.openScene({ scopeId, sceneId: firstScene.id });
    assert.equal(opened.id, firstScene.id);

    const objects = await client.listObjects({ scopeId, anchorObjectId: firstScene.id });
    assert.ok(Array.isArray(objects));
    assert.ok(objects.length >= 1);
  } finally {
    await closeAllScopes(client);
  }
});

test('integration: optional write path create/delete scene', { timeout: 240000, concurrency: false }, async (t) => {
  if (!WRITE_ENABLED) {
    t.skip('Set FABRIC_IT_WRITE=1 to run destructive write test.');
    return;
  }

  const target = await getTargetOrSkip(t, { requireAdmin: true });
  if (!target) return;

  const sceneType = process.env.FABRIC_IT_SCENE_TYPE || undefined;
  const client = createManifolderPromiseClient();
  let safe = null;
  const step = async (name, fn) => {
    const startedAt = Date.now();
    t.diagnostic(`step:start ${name}`);
    try {
      const result = await fn();
      t.diagnostic(`step:ok ${name} (${Date.now() - startedAt}ms)`);
      return result;
    } catch (err) {
    if (err.code !== "SCOPE_CONNECT_FAILED" && err.code !== "SCOPE_NOT_FOUND" && !err.message?.includes("Timeout") && !err.message?.includes("ECONNREFUSED")) throw err;
      t.diagnostic(`step:fail ${name} (${Date.now() - startedAt}ms): ${err.message}`);
      throw err;
    }
  };

  try {
    const connection = await step('connect', async () => client.connectRoot({
      fabricUrl: target.fabricUrl,
      adminKey: target.adminKey,
    }));
    const scopeId = connection.scopeId;
    safe = createWriteSafetyHarness(client, scopeId);

    const created = await step('createScene', async () => safe.createScene('scene', sceneType));
    const sceneId = created.id;
    assert.ok(sceneId);
    assert.equal(created.name.startsWith(`${SCENE_NAME_PREFIX}-${RUN_ID}-`), true);

    const reopened = await step('openScene', async () => client.openScene({ scopeId, sceneId }));
    assert.equal(reopened.id, sceneId);

    // All CUD operations are constrained to run-owned objects only.
    const createdParent = await step('createObject:parent', async () => safe.createObject({
      parentId: sceneId,
      name: `it-parent-${RUN_ID}`,
      objectType: 'physical',
    }));
    const createdChild = await step('createObject:child', async () => safe.createObject({
      parentId: createdParent.id,
      name: `it-child-${RUN_ID}`,
      objectType: 'physical',
    }));

    await step('updateObject:child', async () => safe.updateObject({
      objectId: createdChild.id,
      name: `it-child-updated-${RUN_ID}`,
    }));

    await step('moveObject:child->scene', async () => safe.moveObject(createdChild.id, sceneId));
    await step('deleteObject:child', async () => safe.deleteObject(createdChild.id));
    await step('deleteObject:parent', async () => safe.deleteObject(createdParent.id));
    await step('deleteScene', async () => safe.deleteScene(sceneId));
  } finally {
    await safe?.cleanup().catch(() => {});
    await closeAllScopes(client).catch(() => {});
  }
});

test('integration: earth attachment parent lookup returns Bay Lake for the Disney 5km case', { timeout: 240000, concurrency: false }, async (t) => {
  const target = await getEarthTargetOrSkip(t);
  if (!target) return;

  const client = createManifolderPromiseClient();
  try {
    registerUnsafeHosts(EARTH_UNSAFE_HOSTS);
    const connection = await client.connectRoot({
      fabricUrl: target.fabricUrl,
      adminKey: target.adminKey,
      timeoutMs: EARTH_CONNECT_TIMEOUT_MS,
    });
    const result = await client.findEarthAttachmentParent({
      scopeId: connection.scopeId,
      lat: 28.3772,
      lon: -81.5707,
      boundX: 2500, boundZ: 2500,
    });

    assert.equal(result.sectorSubtype, 1);
    assert.equal(result.parent?.name, 'Bay Lake');
    assert.equal(result.parent?.objectId, 'terrestrial:1102869');
    assert.equal(result.parent?.objectType, 'terrestrial:city:3');
    assert.equal(typeof result.attachment.latitude, 'number');
    assert.equal(typeof result.attachment.longitude, 'number');
    assert.ok(result.attachment.boundX > 0);
    assert.ok(result.attachment.boundY > 0);
    assert.ok(result.attachment.boundZ > 0);
    assert.equal(result.geocode.city, 'Bay Lake');
    assert.equal(result.geocode.county, 'Orange County');
    assert.equal(result.geocode.state, 'Florida');
    assert.equal(result.geocode.country, 'United States');
  } catch (err) {
    if (err.code !== "SCOPE_CONNECT_FAILED" && err.code !== "SCOPE_NOT_FOUND" && !err.message?.includes("Timeout") && !err.message?.includes("ECONNREFUSED")) throw err;
    t.skip(`earth attachment lookup unavailable for this target: ${err.message}`);
  } finally {
    await closeAllScopes(client);
  }
});

test('integration: earth attachment parent lookup finds a sector for the Disney 25km case', { timeout: 240000, concurrency: false }, async (t) => {
  const target = await getEarthTargetOrSkip(t);
  if (!target) return;

  const client = createManifolderPromiseClient();
  try {
    registerUnsafeHosts(EARTH_UNSAFE_HOSTS);
    const connection = await client.connectRoot({
      fabricUrl: target.fabricUrl,
      adminKey: target.adminKey,
      timeoutMs: EARTH_CONNECT_TIMEOUT_MS,
    });
    const result = await client.findEarthAttachmentParent({
      scopeId: connection.scopeId,
      lat: 28.3772,
      lon: -81.5707,
      boundX: 12500, boundZ: 12500,
    });

    assert.equal(result.sectorSubtype, 1);
    assert.ok(result.parent);
    assert.ok(result.parent.objectType.startsWith('terrestrial:sector'));
    assert.ok(result.parent.bound.x >= 12500, 'parent bound.x must contain campus half-width');
    assert.ok(result.parent.bound.z >= 12500, 'parent bound.z must contain campus half-depth');
    assert.equal(result.geocode.city, 'Bay Lake');
    assert.equal(result.geocode.county, 'Orange County');
    assert.equal(result.geocode.state, 'Florida');
    assert.equal(result.geocode.country, 'United States');
  } catch (err) {
    if (err.code !== "SCOPE_CONNECT_FAILED" && err.code !== "SCOPE_NOT_FOUND" && !err.message?.includes("Timeout") && !err.message?.includes("ECONNREFUSED")) throw err;
    t.skip(`earth attachment walk-up unavailable for this target: ${err.message}`);
  } finally {
    await closeAllScopes(client);
  }
});

test('integration: earth attachment parent lookup accepts caller-provided location names', { timeout: 240000, concurrency: false }, async (t) => {
  const target = await getEarthTargetOrSkip(t);
  if (!target) return;

  const client = createManifolderPromiseClient();
  try {
    registerUnsafeHosts(EARTH_UNSAFE_HOSTS);
    const connection = await client.connectRoot({
      fabricUrl: target.fabricUrl,
      adminKey: target.adminKey,
      timeoutMs: EARTH_CONNECT_TIMEOUT_MS,
    });
    const result = await client.findEarthAttachmentParent({
      scopeId: connection.scopeId,
      lat: 28.3772,
      lon: -81.5707,
      boundX: 1000, boundZ: 1000,
      city: 'Bay Lake',
      state: 'Florida',
      country: 'United States',
    });

    assert.equal(result.sectorSubtype, 2);
    assert.ok(result.parent);
    assert.ok(result.parent.objectType.startsWith('terrestrial:sector'));
    assert.ok(result.parent.bound.x >= 1000, 'parent bound.x must contain campus half-width');
    assert.ok(result.parent.bound.z >= 1000, 'parent bound.z must contain campus half-depth');
    assert.equal(result.geocode.city, 'Bay Lake');
    assert.equal(result.geocode.state, 'Florida');
    assert.equal(result.geocode.country, 'United States');
  } catch (err) {
    if (err.code !== "SCOPE_CONNECT_FAILED" && err.code !== "SCOPE_NOT_FOUND" && !err.message?.includes("Timeout") && !err.message?.includes("ECONNREFUSED")) throw err;
    t.skip(`earth attachment named lookup unavailable for this target: ${err.message}`);
  } finally {
    await closeAllScopes(client);
  }
});

test('integration: earth attachment parent lookup keeps names as search hints when the coordinate is outside Springfield', { timeout: 240000, concurrency: false }, async (t) => {
  const target = await getEarthTargetOrSkip(t);
  if (!target) return;

  const client = createManifolderPromiseClient();
  try {
    registerUnsafeHosts(EARTH_UNSAFE_HOSTS);
    const connection = await client.connectRoot({
      fabricUrl: target.fabricUrl,
      adminKey: target.adminKey,
      timeoutMs: EARTH_CONNECT_TIMEOUT_MS,
    });
    const unnamed = await client.findEarthAttachmentParent({
      scopeId: connection.scopeId,
      lat: 39.7525,
      lon: -89.65,
      boundX: 2500, boundZ: 2500,
    });
    const named = await client.findEarthAttachmentParent({
      scopeId: connection.scopeId,
      lat: 39.7525,
      lon: -89.65,
      boundX: 2500, boundZ: 2500,
      city: 'Springfield',
    });

    assert.ok(unnamed.parent);
    assert.ok(unnamed.parent.objectType.startsWith('terrestrial:sector'));
    assert.equal(unnamed.geocode.city, 'Southern View');
    assert.equal(unnamed.geocode.county, 'Sangamon County');
    assert.equal(unnamed.geocode.state, 'Illinois');
    assert.equal(unnamed.geocode.country, 'United States');
    // Named and unnamed queries for the same coordinate should return the same parent
    assert.equal(named.parent?.objectId, unnamed.parent?.objectId);
    assert.equal(named.geocode.county, unnamed.geocode.county);
    assert.equal(named.geocode.state, unnamed.geocode.state);
    assert.equal(named.geocode.country, unnamed.geocode.country);
  } catch (err) {
    if (err.code !== "SCOPE_CONNECT_FAILED" && err.code !== "SCOPE_NOT_FOUND" && !err.message?.includes("Timeout") && !err.message?.includes("ECONNREFUSED")) throw err;
    t.skip(`earth attachment Springfield hint lookup unavailable for this target: ${err.message}`);
  } finally {
    await closeAllScopes(client);
  }
});

test('integration: earth attachment parent lookup can disambiguate Springfield when the coordinate is inside the city', { timeout: 240000, concurrency: false }, async (t) => {
  const target = await getEarthTargetOrSkip(t);
  if (!target) return;

  const client = createManifolderPromiseClient();
  try {
    registerUnsafeHosts(EARTH_UNSAFE_HOSTS);
    const connection = await client.connectRoot({
      fabricUrl: target.fabricUrl,
      adminKey: target.adminKey,
      timeoutMs: EARTH_CONNECT_TIMEOUT_MS,
    });
    const unnamed = await client.findEarthAttachmentParent({
      scopeId: connection.scopeId,
      lat: 39.7982,
      lon: -89.6444,
      boundX: 2500, boundZ: 2500,
    });
    const named = await client.findEarthAttachmentParent({
      scopeId: connection.scopeId,
      lat: 39.7982,
      lon: -89.6444,
      boundX: 2500, boundZ: 2500,
      city: 'Springfield',
    });

    assert.ok(unnamed.parent);
    assert.ok(unnamed.parent.objectType.startsWith('terrestrial:sector'));
    assert.equal(unnamed.geocode.city, 'Springfield');
    assert.equal(unnamed.geocode.county, 'Sangamon County');
    assert.equal(unnamed.geocode.state, 'Illinois');
    assert.equal(named.parent?.objectId, unnamed.parent?.objectId);
    assert.equal(named.parent?.name, unnamed.parent?.name);
    assert.equal(named.geocode.city, unnamed.geocode.city);
    assert.equal(named.geocode.county, unnamed.geocode.county);
    assert.equal(named.geocode.state, unnamed.geocode.state);
    assert.equal(named.geocode.country, unnamed.geocode.country);
  } catch (err) {
    if (err.code !== "SCOPE_CONNECT_FAILED" && err.code !== "SCOPE_NOT_FOUND" && !err.message?.includes("Timeout") && !err.message?.includes("ECONNREFUSED")) throw err;
    t.skip(`earth attachment Springfield city lookup unavailable for this target: ${err.message}`);
  } finally {
    await closeAllScopes(client);
  }
});

test('integration: earth attachment parent lookup computes center and bounds from perimeter nodes', { timeout: 240000, concurrency: false }, async (t) => {
  const target = await getEarthTargetOrSkip(t);
  if (!target) return;

  const client = createManifolderPromiseClient();
  try {
    registerUnsafeHosts(EARTH_UNSAFE_HOSTS);
    const connection = await client.connectRoot({
      fabricUrl: target.fabricUrl,
      adminKey: target.adminKey,
      timeoutMs: EARTH_CONNECT_TIMEOUT_MS,
    });
    const result = await client.findEarthAttachmentParent({
      scopeId: connection.scopeId,
      nodes: [
        { lat: 39.716, lon: -75.121 },
        { lat: 39.703, lon: -75.112 },
        { lat: 39.711, lon: -75.128 },
        { lat: 39.708, lon: -75.111 },
      ],
    });

    assert.ok(result.parent);
    assert.ok(result.parent.objectId);
    assert.ok(result.parent.name);
    assert.ok(result.attachment.latitude > 39.7 && result.attachment.latitude < 39.72);
    assert.ok(result.attachment.longitude > -75.13 && result.attachment.longitude < -75.11);
    assert.ok(result.attachment.boundX > 0);
    assert.ok(result.attachment.boundY > 0);
    assert.ok(result.attachment.boundZ > 0);
    assert.ok(result.attachment.radius > 0);
    assert.equal(typeof result.sectorSubtype, 'number');
    assert.ok(result.geocode.state);
    assert.ok(result.geocode.country);
  } catch (err) {
    if (err.code !== "SCOPE_CONNECT_FAILED" && err.code !== "SCOPE_NOT_FOUND" && !err.message?.includes("Timeout") && !err.message?.includes("ECONNREFUSED")) throw err;
    t.skip(`earth attachment nodes lookup unavailable for this target: ${err.message}`);
  } finally {
    await closeAllScopes(client);
  }
});
