import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import '../../src/vendor/mv/index.js';
import { createManifolderPromiseClient } from '../../src/client/ManifolderClient.js';

const CONFIG_PATH = join(homedir(), '.config', 'fabric-mcp', 'config.json');
const INTEGRATION_ENABLED = /^(1|true|yes)$/i.test(process.env.FABRIC_IT_ENABLED || '');
const WRITE_ENABLED = /^(1|true|yes)$/i.test(process.env.FABRIC_IT_WRITE || '');
const RUN_ID = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
const SCENE_NAME_PREFIX = process.env.FABRIC_IT_SCENE_PREFIX || 'it-owned';

let cachedTarget = null;

function createWriteSafetyHarness(client) {
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
      const created = await client.createScene(sceneName, objectType);
      ownedSceneIds.add(created.id);
      return created;
    },
    async deleteScene(sceneId) {
      assertOwnedScene(sceneId);
      await client.deleteScene(sceneId);
      ownedSceneIds.delete(sceneId);
    },
    async createObject(params) {
      assertOwnedParent(params.parentId);
      const created = await client.createObject(params);
      ownedObjectIds.add(created.id);
      return created;
    },
    async updateObject(params) {
      assertOwnedObject(params.objectId);
      return client.updateObject(params);
    },
    async moveObject(objectId, newParentId) {
      assertOwnedObject(objectId);
      assertOwnedParent(newParentId);
      return client.moveObject(objectId, newParentId);
    },
    async deleteObject(objectId) {
      assertOwnedObject(objectId);
      await client.deleteObject(objectId);
      ownedObjectIds.delete(objectId);
    },
    async cleanup() {
      for (const sceneId of Array.from(ownedSceneIds)) {
        await client.deleteScene(sceneId).catch(() => {});
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
    t.skip(`Integration target not configured: ${err.message}`);
    return null;
  }

  if (options.requireAdmin && !target.adminKey) {
    t.skip('This integration test requires adminKey.');
    return null;
  }

  return target;
}

test('integration: connect/disconnect and status metadata', { timeout: 180000, concurrency: false }, async (t) => {
  const target = await getTargetOrSkip(t);
  if (!target) return;

  const client = createManifolderPromiseClient();
  try {
    const root = await client.connect(target.fabricUrl, target.adminKey);
    assert.ok(root, `connect() should return root model (${target.source})`);
    assert.equal(client.connected, true);

    const status = client.getStatus();
    assert.equal(status.connected, true);
    assert.equal(status.fabricUrl, target.fabricUrl);
    assert.equal(typeof status.resourceRootUrl, 'string');
  } finally {
    await client.disconnect();
    assert.equal(client.connected, false);
  }
});

test('integration: scene browse path works in admin mode', { timeout: 180000, concurrency: false }, async (t) => {
  const target = await getTargetOrSkip(t);
  if (!target) return;

  const client = createManifolderPromiseClient();
  try {
    await client.connect(target.fabricUrl, target.adminKey);

    let scenes;
    try {
      scenes = await client.listScenes();
    } catch (err) {
      t.skip(`listScenes unavailable for this server/profile: ${err.message}`);
      return;
    }
    assert.ok(Array.isArray(scenes));
    if (scenes.length === 0) {
      t.skip('No scenes available to open.');
      return;
    }

    const firstScene = scenes[0];
    const opened = await client.openScene(firstScene.id);
    assert.equal(opened.id, firstScene.id);

    const objects = await client.listObjects(firstScene.id);
    assert.ok(Array.isArray(objects));
    assert.ok(objects.length >= 1);
  } finally {
    await client.disconnect();
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
      t.diagnostic(`step:fail ${name} (${Date.now() - startedAt}ms): ${err.message}`);
      throw err;
    }
  };

  try {
    await step('connect', async () => client.connect(target.fabricUrl, target.adminKey));
    safe = createWriteSafetyHarness(client);

    const created = await step('createScene', async () => safe.createScene('scene', sceneType));
    const sceneId = created.id;
    assert.ok(sceneId);
    assert.equal(created.name.startsWith(`${SCENE_NAME_PREFIX}-${RUN_ID}-`), true);

    const reopened = await step('openScene', async () => client.openScene(sceneId));
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
    await client.disconnect().catch(() => {});
  }
});
