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
  console.error('[integration] FABRIC_IT_ENABLED is not set; attachment E2E integration test will be skipped.');
}

async function resolveTarget() {
  if (process.env.FABRIC_IT_URL) {
    return {
      fabricUrl: process.env.FABRIC_IT_URL,
      adminKey: process.env.FABRIC_IT_ADMIN_KEY || '',
      profileName: process.env.FABRIC_IT_PROFILE || 'default',
    };
  }
  const profileName = process.env.FABRIC_IT_PROFILE || 'default';
  const config = JSON.parse(await readFile(CONFIG_PATH, 'utf-8'));
  const profile = config[profileName];
  if (!profile?.fabricUrl) {
    throw new Error(`Profile "${profileName}" missing in ${CONFIG_PATH}`);
  }
  return {
    fabricUrl: profile.fabricUrl,
    adminKey: profile.adminKey || '',
    profileName,
  };
}

function toSceneUrl(resourceRootUrl, sceneId) {
  const [prefix, idRaw] = sceneId.split(':');
  const numericId = Number.parseInt(idRaw, 10);
  const classId = { root: 70, celestial: 71, terrestrial: 72, physical: 73 }[prefix];
  const normalizedRoot = resourceRootUrl.endsWith('/') ? resourceRootUrl.slice(0, -1) : resourceRootUrl;
  return `${normalizedRoot}/fabric/${classId}/${numericId}`;
}

test('integration: sector + parcels + attachments + child content', { timeout: 240000, concurrency: false }, async (t) => {
  if (!INTEGRATION_ENABLED || !WRITE_ENABLED) {
    t.skip('Set FABRIC_IT_ENABLED=1 and FABRIC_IT_WRITE=1 for live integration coverage.');
    return;
  }

  const target = await resolveTarget();
  const client = createManifolderPromiseClient();
  const createdRootSceneIds = [];
  const createdChildSceneIds = [];
  let rootScopeId = null;

  try {
    const root = await client.connectRoot({
      fabricUrl: target.fabricUrl,
      adminKey: target.adminKey,
      associatedProfile: target.profileName,
    });

    rootScopeId = root.scopeId;
    const rootResource = client.getResourceRootUrl({ scopeId: rootScopeId });
    const sectorScene = await client.createScene({
      scopeId: rootScopeId,
      name: `it-sector-${RUN_ID}`,
      objectType: 'terrestrial:sector',
    });
    createdRootSceneIds.push(sectorScene.id);

    const parcels = [];
    for (let i = 0; i < 5; i += 1) {
      const parcel = await client.createObject({
        scopeId: rootScopeId,
        parentId: sectorScene.id,
        name: `it-parcel-${i}-${RUN_ID}`,
        objectType: 'terrestrial:parcel',
      });
      parcels.push(parcel);
    }

    for (let i = 0; i < parcels.length; i += 1) {
      const childScene = await client.createScene({
        scopeId: rootScopeId,
        name: `it-child-${i}-${RUN_ID}`,
        objectType: 'physical',
      });
      createdChildSceneIds.push(childScene.id);
      const childUrl = toSceneUrl(rootResource, childScene.id);

      const attachment = await client.createObject({
        scopeId: rootScopeId,
        parentId: parcels[i].id,
        name: `it-attach-${i}-${RUN_ID}`,
        objectType: 'physical',
        resourceReference: childUrl,
      });

      const followed = await client.followAttachment({
        scopeId: rootScopeId,
        objectId: attachment.id,
      });

      assert.ok(followed.childScopeId.startsWith('fs1_'));
      assert.equal(Object.prototype.hasOwnProperty.call(followed, 'associatedProfile'), true);
      assert.ok(followed.root?.id);

      const house = await client.createObject({
        scopeId: followed.childScopeId,
        parentId: followed.root.id,
        name: `it-house-${i}-${RUN_ID}`,
        objectType: 'physical',
      });
      assert.ok(house.nodeUid?.includes(followed.childScopeId));
    }
  } finally {
    for (const sceneId of createdChildSceneIds.reverse()) {
      if (rootScopeId) {
        await client.deleteScene({ scopeId: rootScopeId, sceneId }).catch(() => {});
      }
    }
    for (const sceneId of createdRootSceneIds.reverse()) {
      if (rootScopeId) {
        await client.deleteScene({ scopeId: rootScopeId, sceneId }).catch(() => {});
      }
    }
    for (const scope of client.listScopes()) {
      await client.closeScope({ scopeId: scope.scopeId, cascade: true }).catch(() => {});
    }
  }
});
