import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

globalThis.MV = {
  MVMF: {
    NOTIFICATION: class {},
    Escape: (value) => value,
  },
  MVRP: {},
};

const { handleCreateScene, handleOpenScene } = await import('../../dist/tools/scenes.js');
const { handleCreateObject } = await import('../../dist/tools/objects.js');
const { handleFollowAttachment } = await import('../../dist/tools/scopes.js');
const { computeChildScopeId } = await import('../../dist/client/index.js');

const CLASS_PREFIX_TO_ID = {
  root: 70,
  celestial: 71,
  terrestrial: 72,
  physical: 73,
};

function parseObjectRef(objectId) {
  const [prefix, rawId] = objectId.split(':');
  return {
    classId: CLASS_PREFIX_TO_ID[prefix],
    numericId: Number.parseInt(rawId, 10),
  };
}

function normalizeRootUrl(url) {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

function buildScopeObject(scopeId, object) {
  const { classId, numericId } = parseObjectRef(object.id);
  const rootNode = `${scopeId}:root:1`;
  return {
    id: object.id,
    scopeId,
    nodeUid: `${scopeId}:${object.id}`,
    parentId: object.parentId,
    parentNodeUid: object.parentId === 'root' ? rootNode : `${scopeId}:${object.parentId}`,
    name: object.name,
    transform: {
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      scale: { x: 1, y: 1, z: 1 },
    },
    resourceReference: object.resourceReference ?? null,
    resourceName: null,
    bound: null,
    classId,
    subtype: 0,
    children: [],
    orbit: null,
    properties: null,
    numericId,
  };
}

function createToolPathClient() {
  const scopes = [
    { scopeId: 'fs1_root', parentScopeId: null, fabricUrl: 'https://root.example.com/fabric/root.msf', depth: 0, attachmentNodeUid: null, associatedProfile: 'default' },
  ];
  const objectsByScope = new Map();
  const rootsByScope = new Map();
  const countersByScope = new Map();
  const resourceRoots = new Map([
    ['fs1_root', 'https://root.example.com/resources/'],
  ]);
  objectsByScope.set('fs1_root', new Map());
  rootsByScope.set('fs1_root', 'root');
  countersByScope.set('fs1_root', 10);

  const nextId = (scopeId, prefix) => {
    const current = countersByScope.get(scopeId) ?? 10;
    countersByScope.set(scopeId, current + 1);
    return `${prefix}:${current}`;
  };

  const getScopeMap = (scopeId) => {
    if (!objectsByScope.has(scopeId)) {
      objectsByScope.set(scopeId, new Map());
      countersByScope.set(scopeId, 10);
    }
    return objectsByScope.get(scopeId);
  };

  return {
    listScopes: () => scopes.map((scope) => ({ ...scope })),
    getScopeStatus: ({ scopeId }) => ({ scopeId, connected: true }),
    getResourceRootUrl: ({ scopeId }) => resourceRoots.get(scopeId) || '',
    createScene: async ({ scopeId, name, objectType }) => {
      const prefix = (objectType || 'physical:default').startsWith('terrestrial') ? 'terrestrial' : 'physical';
      const sceneId = nextId(scopeId, prefix);
      const classId = prefix === 'terrestrial' ? 72 : 73;
      const scene = { id: sceneId, name, rootObjectId: sceneId, classId, scopeId };
      getScopeMap(scopeId).set(sceneId, buildScopeObject(scopeId, {
        id: sceneId,
        parentId: 'root',
        name,
      }));
      return scene;
    },
    openScene: async ({ scopeId, sceneId }) => {
      const scene = getScopeMap(scopeId).get(sceneId);
      if (!scene) {
        throw new Error(`Scene not found: ${sceneId}`);
      }
      return scene;
    },
    createObject: async ({ scopeId, parentId, name, objectType, resourceReference }) => {
      const prefix = (objectType || 'physical:default').startsWith('terrestrial') ? 'terrestrial' : 'physical';
      const objectId = nextId(scopeId, prefix);
      const obj = buildScopeObject(scopeId, {
        id: objectId,
        parentId,
        name,
        resourceReference,
      });
      getScopeMap(scopeId).set(objectId, obj);
      return obj;
    },
    followAttachment: async ({ scopeId, objectId }) => {
      const parent = getScopeMap(scopeId).get(objectId);
      if (!parent?.resourceReference) {
        const error = new Error(`Attachment object not found: ${objectId}`);
        error.code = 'ATTACHMENT_NOT_FOUND';
        error.scopeId = scopeId;
        throw error;
      }
      const attachmentNodeUid = `${scopeId}:${objectId}`;
      const childScopeId = await computeChildScopeId(attachmentNodeUid, parent.resourceReference);
      let childScope = scopes.find((scope) => scope.scopeId === childScopeId);
      if (!childScope) {
        childScope = {
          scopeId: childScopeId,
          parentScopeId: scopeId,
          fabricUrl: parent.resourceReference,
          depth: 1,
          attachmentNodeUid,
          associatedProfile: null,
        };
        scopes.push(childScope);
        resourceRoots.set(childScopeId, 'https://child.example.com/resources/');
        rootsByScope.set(childScopeId, 'physical:1');
        getScopeMap(childScopeId).set('physical:1', buildScopeObject(childScopeId, {
          id: 'physical:1',
          parentId: 'root',
          name: 'Child Root',
        }));
      }
      return {
        parentScopeId: scopeId,
        attachmentNodeUid,
        childScopeId,
        childFabricUrl: parent.resourceReference,
        associatedProfile: childScope.associatedProfile,
        reused: false,
        root: {
          id: rootsByScope.get(childScopeId),
          name: 'Child Root',
          childCount: 0,
        },
      };
    },
  };
}

async function invokeTool(client, name, args) {
  switch (name) {
    case 'create_scene':
      return JSON.parse(await handleCreateScene(client, args));
    case 'open_scene':
      return JSON.parse(await handleOpenScene(client, args));
    case 'create_object':
      return JSON.parse(await handleCreateObject(client, args));
    case 'follow_attachment':
      return JSON.parse(await handleFollowAttachment(client, args));
    default:
      throw new Error(`Unsupported test tool: ${name}`);
  }
}

test('MCP-layer E2E: sector -> parcels -> attachments -> child content via tools only', async () => {
  const client = createToolPathClient();

  const sectorSceneResult = await invokeTool(client, 'create_scene', {
    scopeId: 'fs1_root',
    name: 'Sector Scene',
    objectType: 'terrestrial:sector',
  });
  const sectorScene = sectorSceneResult.scene;
  assert.equal(sectorScene.scopeId, 'fs1_root');

  const openedSector = await invokeTool(client, 'open_scene', {
    scopeId: 'fs1_root',
    sceneId: sectorScene.id,
  });
  assert.equal(openedSector.id, sectorScene.id);
  assert.equal(typeof openedSector.url, 'string');

  const parcel = await invokeTool(client, 'create_object', {
    scopeId: 'fs1_root',
    parentId: sectorScene.id,
    name: 'Parcel 1',
    objectType: 'terrestrial:parcel',
  });
  assert.equal(parcel.scopeId, 'fs1_root');

  const childSceneResult = await invokeTool(client, 'create_scene', {
    scopeId: 'fs1_root',
    name: 'Child Physical Scene',
    objectType: 'physical:default',
  });
  const childScene = childSceneResult.scene;

  const attachment = await invokeTool(client, 'create_object', {
    scopeId: 'fs1_root',
    parentId: parcel.id,
    name: 'Attachment',
    objectType: 'physical:default',
    resourceReference: childScene.url,
  });
  const followed = await invokeTool(client, 'follow_attachment', {
    scopeId: 'fs1_root',
    objectId: attachment.id,
  });
  assert.equal(followed.parentScopeId, 'fs1_root');
  assert.equal(typeof followed.childScopeId, 'string');
  assert.equal(typeof followed.root.id, 'string');

  const house = await invokeTool(client, 'create_object', {
    scopeId: followed.childScopeId,
    parentId: followed.root.id,
    name: 'House',
    objectType: 'physical:default',
  });
  assert.equal(house.scopeId, followed.childScopeId);
  assert.equal(house.parentId, followed.root.id);
});

test('cross-server follow_attachment semantics match same-server semantics', async () => {
  const client = {
    listScopes: () => [{ scopeId: 'fs1_root', parentScopeId: null }],
    getScopeStatus: () => ({ connected: true }),
    followAttachment: async ({ scopeId, objectId }) => {
      const crossServer = objectId === 'physical:2';
      const childFabricUrl = crossServer
        ? 'https://other-host.example.com/fabric/child.msf'
        : 'https://root-host.example.com/fabric/child.msf';
      const childScopeId = await computeChildScopeId(`${scopeId}:${objectId}`, childFabricUrl);
      return {
        parentScopeId: scopeId,
        attachmentNodeUid: `${scopeId}:${objectId}`,
        childScopeId,
        childFabricUrl,
        associatedProfile: null,
        reused: false,
        root: { id: 'physical:1', name: 'Child Root', childCount: 0 },
      };
    },
    setScopeAssociatedProfile: () => {},
  };

  const sameServer = await invokeTool(client, 'follow_attachment', {
    scopeId: 'fs1_root',
    objectId: 'physical:1',
  });
  const crossServer = await invokeTool(client, 'follow_attachment', {
    scopeId: 'fs1_root',
    objectId: 'physical:2',
  });

  assert.equal(sameServer.parentScopeId, crossServer.parentScopeId);
  assert.equal(typeof sameServer.childScopeId, 'string');
  assert.equal(typeof crossServer.childScopeId, 'string');
  assert.equal(typeof sameServer.attachmentNodeUid, 'string');
  assert.equal(typeof crossServer.attachmentNodeUid, 'string');
  assert.equal(typeof sameServer.root.id, 'string');
  assert.equal(typeof crossServer.root.id, 'string');
  assert.notEqual(sameServer.childScopeId, crossServer.childScopeId);
  assert.notEqual(sameServer.childFabricUrl, crossServer.childFabricUrl);
});

test('MCP stdio transport routes get_action_resource_schema via CallTool dispatcher', { timeout: 30000 }, async () => {
  const serverEntrypoint = fileURLToPath(new URL('../../dist/index.js', import.meta.url));
  const packageRoot = fileURLToPath(new URL('../..', import.meta.url));
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverEntrypoint],
    cwd: packageRoot,
    env: process.env,
    stderr: 'pipe',
  });
  const client = new Client(
    { name: 'transport-smoke-test', version: '1.0.0' },
    { capabilities: {} }
  );

  try {
    await client.connect(transport);

    const tools = await client.listTools();
    assert.equal(
      tools.tools.some((tool) => tool.name === 'get_action_resource_schema'),
      true
    );

    const result = await client.callTool({
      name: 'get_action_resource_schema',
      arguments: {},
    });

    const textBlock = result.content.find((entry) => entry.type === 'text');
    assert.ok(textBlock, 'Expected text content from tool result');
    const payload = JSON.parse(textBlock.text);
    assert.equal(payload.types.pointlight.reference, 'action://pointlight');
  } finally {
    await client.close().catch(() => {});
    await transport.close().catch(() => {});
  }
});
