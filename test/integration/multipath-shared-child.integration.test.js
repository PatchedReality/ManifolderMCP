import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import '../../src/vendor/mv/index.js';
import { createManifolderPromiseClient } from '../../src/client/ManifolderClient.js';

const CONFIG_PATH = join(homedir(), '.config', 'manifolder-mcp', 'config.json');
const INTEGRATION_ENABLED = /^(1|true|yes)$/i.test(process.env.FABRIC_IT_ENABLED || '');
const WRITE_ENABLED = /^(1|true|yes)$/i.test(process.env.FABRIC_IT_WRITE || '');
const RUN_ID = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

if (!INTEGRATION_ENABLED) {
  console.error('[integration] FABRIC_IT_ENABLED is not set; multi-path integration test will be skipped.');
}

async function resolveTarget() {
  const profileName = process.env.FABRIC_IT_PROFILE || 'default';
  if (process.env.FABRIC_IT_URL) {
    return { fabricUrl: process.env.FABRIC_IT_URL, adminKey: process.env.FABRIC_IT_ADMIN_KEY || '', profileName };
  }
  const config = JSON.parse(await readFile(CONFIG_PATH, 'utf-8'));
  const profile = config[profileName];
  if (!profile?.fabricUrl) {
    throw new Error(`Profile "${profileName}" missing in ${CONFIG_PATH}`);
  }
  return { fabricUrl: profile.fabricUrl, adminKey: profile.adminKey || '', profileName };
}

function toSceneUrl(resourceRootUrl, sceneId) {
  const [prefix, idRaw] = sceneId.split(':');
  const numericId = Number.parseInt(idRaw, 10);
  const classId = { root: 70, celestial: 71, terrestrial: 72, physical: 73 }[prefix];
  const normalizedRoot = resourceRootUrl.endsWith('/') ? resourceRootUrl.slice(0, -1) : resourceRootUrl;
  return `${normalizedRoot}/fabric/${classId}/${numericId}`;
}

async function waitFor(check, { timeoutMs = 30000, intervalMs = 250 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      await check();
      return;
    } catch (err) {
      lastError = err;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw lastError ?? new Error('Timed out waiting for condition');
}

test('integration gate14: multi-path shared child reflects mutations', { timeout: 240000, concurrency: false }, async (t) => {
  if (!INTEGRATION_ENABLED || !WRITE_ENABLED) {
    t.skip('Set FABRIC_IT_ENABLED=1 and FABRIC_IT_WRITE=1 for live integration coverage.');
    return;
  }

  const target = await resolveTarget();
  const client = createManifolderPromiseClient();
  let rootScopeId = null;
  const cleanupSceneIds = [];

  try {
    const root = await client.connectRoot({
      fabricUrl: target.fabricUrl,
      adminKey: target.adminKey,
      associatedProfile: target.profileName,
    });
    rootScopeId = root.scopeId;
    const resourceRoot = client.getResourceRootUrl({ scopeId: rootScopeId });

    const parentA = await client.createScene({ scopeId: rootScopeId, name: `it-parent-a-${RUN_ID}`, objectType: 'physical' });
    const parentB = await client.createScene({ scopeId: rootScopeId, name: `it-parent-b-${RUN_ID}`, objectType: 'physical' });
    const sharedChild = await client.createScene({ scopeId: rootScopeId, name: `it-shared-child-${RUN_ID}`, objectType: 'physical' });
    cleanupSceneIds.push(parentA.id, parentB.id, sharedChild.id);

    const sharedUrl = toSceneUrl(resourceRoot, sharedChild.id);
    const attachA = await client.createObject({
      scopeId: rootScopeId,
      parentId: parentA.id,
      name: `it-attach-a-${RUN_ID}`,
      objectType: 'physical',
      resourceReference: sharedUrl,
    });
    const attachB = await client.createObject({
      scopeId: rootScopeId,
      parentId: parentB.id,
      name: `it-attach-b-${RUN_ID}`,
      objectType: 'physical',
      resourceReference: sharedUrl,
    });

    const pathA = await client.followAttachment({ scopeId: rootScopeId, objectId: attachA.id });
    const pathB = await client.followAttachment({ scopeId: rootScopeId, objectId: attachB.id });

    assert.notEqual(pathA.childScopeId, pathB.childScopeId);

    const created = await client.createObject({
      scopeId: pathA.childScopeId,
      parentId: pathA.root.id,
      name: `it-shared-object-${RUN_ID}`,
      objectType: 'physical',
    });

    const viaPathB = await client.listObjects({
      scopeId: pathB.childScopeId,
      anchorObjectId: pathB.root.id,
      limit: 200,
    });
    assert.equal(viaPathB.some((obj) => obj.id === created.id && obj.name === created.name), true);

    await client.updateObject({
      scopeId: pathB.childScopeId,
      objectId: created.id,
      name: `it-shared-object-updated-${RUN_ID}`,
    });

    await waitFor(async () => {
      const viaPathBUpdated = await client.getObject({ scopeId: pathB.childScopeId, objectId: created.id });
      assert.equal(viaPathBUpdated.name, `it-shared-object-updated-${RUN_ID}`);
    }, { timeoutMs: 45000, intervalMs: 500 });

    await waitFor(async () => {
      const viaPathA = await client.getObject({ scopeId: pathA.childScopeId, objectId: created.id });
      assert.equal(viaPathA.name, `it-shared-object-updated-${RUN_ID}`);
    }, { timeoutMs: 45000, intervalMs: 500 });
  } finally {
    if (rootScopeId) {
      for (const sceneId of cleanupSceneIds.reverse()) {
        await client.deleteScene({ scopeId: rootScopeId, sceneId }).catch(() => {});
      }
    }
    for (const scope of client.listScopes()) {
      await client.closeScope({ scopeId: scope.scopeId, cascade: true }).catch(() => {});
    }
  }
});
