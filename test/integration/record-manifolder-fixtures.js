import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

import '../../src/vendor/mv/index.js';
import { ManifolderClient, asManifolderPromiseClient } from '../../src/client/index.js';

const CONFIG_PATH = join(homedir(), '.config', 'manifolder-mcp', 'config.json');
const PROFILE_NAME = process.env.FABRIC_IT_PROFILE || 'default';
const RUN_ID = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
const OUTPUT_DIR = process.env.FABRIC_IT_RECORD_DIR || 'test/fixtures/manifolder/live';
const OUTPUT_FILE = process.env.FABRIC_IT_RECORD_FILE || join(OUTPUT_DIR, `manifolder-live-${RUN_ID}.json`);
const LATEST_FILE = join(OUTPUT_DIR, 'latest.json');
const SCENE_PREFIX = process.env.FABRIC_IT_SCENE_PREFIX || 'it-owned';

function toJSON(value) {
  return JSON.parse(JSON.stringify(value, (_k, v) => {
    if (typeof v === 'function') return undefined;
    return v;
  }));
}

async function resolveTarget() {
  const envUrl = process.env.FABRIC_IT_URL || process.env.FABRIC_URL || '';
  if (envUrl) {
    return {
      fabricUrl: envUrl,
      adminKey: process.env.FABRIC_IT_ADMIN_KEY || process.env.FABRIC_ADMIN_KEY || '',
      source: 'env',
    };
  }

  const content = await readFile(CONFIG_PATH, 'utf-8');
  const config = JSON.parse(content);
  const profile = config?.[PROFILE_NAME];
  if (!profile?.fabricUrl) {
    throw new Error(
      `Profile "${PROFILE_NAME}" missing or invalid in ${CONFIG_PATH}. Expected { fabricUrl, adminKey? }.`
    );
  }

  return {
    fabricUrl: profile.fabricUrl,
    adminKey: profile.adminKey || '',
    source: `profile:${PROFILE_NAME}`,
  };
}

function createWriteSafetyHarness(client, runId) {
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
    if (parentId === 'root') return;
    if (!ownedSceneIds.has(parentId) && !ownedObjectIds.has(parentId)) {
      throw new Error(`Refusing to create under non-test parent: ${parentId}`);
    }
  }

  return {
    async createScene(baseName, objectType) {
      const name = `${SCENE_PREFIX}-${runId}-${baseName}`;
      const scene = await client.createScene(name, objectType);
      ownedSceneIds.add(scene.id);
      return scene;
    },
    async deleteScene(sceneId) {
      assertOwnedScene(sceneId);
      await client.deleteScene(sceneId);
      ownedSceneIds.delete(sceneId);
    },
    async createObject(params) {
      assertOwnedParent(params.parentId);
      const object = await client.createObject(params);
      ownedObjectIds.add(object.id);
      return object;
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

async function main() {
  const target = await resolveTarget();
  if (!target.adminKey) {
    throw new Error('Fixture recording requires adminKey.');
  }

  const core = new ManifolderClient();
  const client = asManifolderPromiseClient(core);
  const safe = createWriteSafetyHarness(client, RUN_ID);
  const sceneType = process.env.FABRIC_IT_SCENE_TYPE || undefined;

  const fixture = {
    meta: {
      runId: RUN_ID,
      recordedAt: new Date().toISOString(),
      targetSource: target.source,
      fabricUrl: target.fabricUrl,
      scenePrefix: SCENE_PREFIX,
    },
    calls: [],
    actions: [],
    notifications: [],
    rawNotices: [],
  };

  const eventNames = ['status', 'connected', 'disconnected', 'modelReady', 'nodeInserted', 'nodeUpdated', 'nodeDeleted'];
  for (const eventName of eventNames) {
    core.on(eventName, (payload) => {
      fixture.notifications.push({ eventName, payload: toJSON(payload) });
    });
  }

  const originalSendAction = core.sendAction.bind(core);
  const originalOnInserted = core.onInserted.bind(core);
  const originalOnUpdated = core.onUpdated.bind(core);
  const originalOnDeleting = core.onDeleting.bind(core);
  const originalOnChanged = core.onChanged.bind(core);

  core.onInserted = (pNotice) => {
    fixture.rawNotices.push({ handler: 'onInserted', notice: toJSON(pNotice) });
    return originalOnInserted(pNotice);
  };
  core.onUpdated = (pNotice) => {
    fixture.rawNotices.push({ handler: 'onUpdated', notice: toJSON(pNotice) });
    return originalOnUpdated(pNotice);
  };
  core.onDeleting = (pNotice) => {
    fixture.rawNotices.push({ handler: 'onDeleting', notice: toJSON(pNotice) });
    return originalOnDeleting(pNotice);
  };
  core.onChanged = (pNotice) => {
    fixture.rawNotices.push({ handler: 'onChanged', notice: toJSON(pNotice) });
    return originalOnChanged(pNotice);
  };

  core.sendAction = async (pObject, actionName, fillPayload, timeoutMs = 30000) => {
    let requestPayload = null;
    const response = await originalSendAction(
      pObject,
      actionName,
      (payload) => {
        fillPayload(payload);
        requestPayload = toJSON(payload);
      },
      timeoutMs,
    );
    fixture.actions.push({
      actionName,
      request: requestPayload,
      response: toJSON(response),
    });
    return response;
  };

  try {
    const rootModel = await client.connect(target.fabricUrl, target.adminKey);
    fixture.calls.push({ name: 'connect', result: { hasRootModel: Boolean(rootModel) } });

    const scene = await safe.createScene('record', sceneType);
    fixture.calls.push({ name: 'createScene', args: { objectType: sceneType || null }, result: toJSON(scene) });

    const openedScene = await client.openScene(scene.id);
    fixture.calls.push({ name: 'openScene', args: { sceneId: scene.id }, result: toJSON(openedScene) });

    const parent = await safe.createObject({
      parentId: scene.id,
      name: `it-parent-${RUN_ID}`,
      objectType: 'physical',
      position: { x: 1, y: 2, z: 3 },
    });
    fixture.calls.push({ name: 'createObject(parent)', result: toJSON(parent) });

    const child = await safe.createObject({
      parentId: parent.id,
      name: `it-child-${RUN_ID}`,
      objectType: 'physical',
    });
    fixture.calls.push({ name: 'createObject(child)', result: toJSON(child) });

    const updated = await safe.updateObject({
      objectId: child.id,
      name: `it-child-updated-${RUN_ID}`,
      position: { x: 10, y: 20, z: 30 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      scale: { x: 2, y: 2, z: 2 },
      bound: { x: 3, y: 4, z: 5 },
      resourceReference: 'resource://test-ref',
      resourceName: 'test-resource-name',
    });
    fixture.calls.push({ name: 'updateObject', result: toJSON(updated) });

    const listed = await client.listObjects(scene.id);
    fixture.calls.push({ name: 'listObjects', args: { scopeId: scene.id }, result: { count: listed.length } });

    const got = await client.getObject(child.id);
    fixture.calls.push({ name: 'getObject', args: { objectId: child.id }, result: toJSON(got) });

    // SEARCH is not available on all servers/scopes; skip findObjects capture here.
    fixture.calls.push({
      name: 'findObjects',
      skipped: 'Search support is server/scope dependent; omitted from this capture run.',
    });

    const bulkDeleteTarget = await safe.createObject({
      parentId: scene.id,
      name: `it-bulk-delete-target-${RUN_ID}`,
      objectType: 'physical',
    });
    fixture.calls.push({ name: 'createObject(bulkDeleteTarget)', result: toJSON(bulkDeleteTarget) });

    const bulk = await client.bulkUpdate([
      { type: 'create', params: { parentId: scene.id, name: `it-bulk-${RUN_ID}`, objectType: 'physical' } },
      { type: 'update', params: { objectId: parent.id, name: `it-parent-bulk-updated-${RUN_ID}` } },
      { type: 'delete', params: { objectId: bulkDeleteTarget.id } },
    ]);
    fixture.calls.push({ name: 'bulkUpdate', result: toJSON(bulk) });

    await safe.moveObject(child.id, scene.id);
    fixture.calls.push({ name: 'moveObject', args: { objectId: child.id, newParentId: scene.id } });

    await safe.deleteObject(child.id);
    fixture.calls.push({ name: 'deleteObject(child)' });

    await safe.deleteScene(scene.id);
    fixture.calls.push({ name: 'deleteScene', args: { sceneId: scene.id } });
  } finally {
    await safe.cleanup().catch(() => {});
    await client.disconnect().catch(() => {});
  }

  await mkdir(dirname(OUTPUT_FILE), { recursive: true });
  const payload = JSON.stringify(fixture, null, 2);
  await writeFile(OUTPUT_FILE, payload);
  await writeFile(LATEST_FILE, payload);

  process.stdout.write(`Recorded fixture: ${OUTPUT_FILE}\n`);
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`Fixture recording failed: ${err.message}\n`);
  process.exit(1);
});
