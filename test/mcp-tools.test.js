import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.MV = {
  MVMF: {
    NOTIFICATION: class {},
    Escape: (value) => value,
  },
  MVRP: {},
};

const { resolveScopeTarget } = await import('../dist/tools/scope-target.js');
const { resolveProfileTarget } = await import('../dist/tools/scope-target.js');
const { handleListScopes, handleFollowAttachment, handleCloseScope } = await import('../dist/tools/scopes.js');
const { setScopeAssociatedProfile } = await import('../dist/tools/scope-profile-registry.js');
const { handleBulkUpdate } = await import('../dist/tools/bulk.js');
const { handleOpenScene } = await import('../dist/tools/scenes.js');
const { serializeToolError } = await import('../dist/tools/errors.js');
const { objectTools } = await import('../dist/tools/objects.js');
const { resourceTools } = await import('../dist/tools/resources.js');
const { computeChildScopeId } = await import('../dist/client/index.js');
const { shapeSceneSummary, shapeObjectResponse } = await import('../dist/tools/response-shapers.js');
const { parseObjectType, formatObjectType } = await import('../dist/tools/schemas.js');

function createMockClient(overrides = {}) {
  return {
    listScopes: () => [],
    getScopeStatus: () => ({ connected: false }),
    connectRoot: async () => ({ scopeId: 'fs1_root' }),
    bulkUpdate: async () => ({ success: 0, failed: 0, createdIds: [], errors: [] }),
    ...overrides,
  };
}

test('resolveScopeTarget returns explicit scopeId when present', async () => {
  const client = createMockClient({
    listScopes: () => [{ scopeId: 'fs1_a', parentScopeId: null }],
  });
  const resolved = await resolveScopeTarget({ scopeId: 'fs1_a' }, client, {
    allowImplicitFallback: true,
    isCUD: false,
  });
  assert.deepEqual(resolved, { scopeId: 'fs1_a', source: 'scopeId' });
});

test('resolveScopeTarget enforces target conflict and fallback ambiguity', async () => {
  const client = createMockClient({
    listScopes: () => [
      { scopeId: 'fs1_a', parentScopeId: null },
      { scopeId: 'fs1_b', parentScopeId: null },
    ],
    getScopeStatus: () => ({ connected: true }),
  });

  await assert.rejects(
    () => resolveScopeTarget({ scopeId: 'a', url: 'https://x' }, client, { allowImplicitFallback: true, isCUD: false }),
    (error) => error?.code === 'SCOPE_TARGET_CONFLICT'
  );

  await assert.rejects(
    () => resolveScopeTarget({}, client, { allowImplicitFallback: true, isCUD: false }),
    (error) => error?.code === 'SCOPE_TARGET_AMBIGUOUS'
  );
});

test('resolveScopeTarget requires explicit target for CUD operations', async () => {
  const client = createMockClient({
    listScopes: () => [{ scopeId: 'fs1_a', parentScopeId: null }],
    getScopeStatus: () => ({ connected: true }),
  });

  await assert.rejects(
    () => resolveScopeTarget({}, client, { allowImplicitFallback: false, isCUD: true }),
    (error) => error?.code === 'SCOPE_TARGET_MISSING'
  );
});

test('resolveScopeTarget succeeds with fallback when exactly one connected root scope exists', async () => {
  const client = createMockClient({
    listScopes: () => [
      { scopeId: 'fs1_root', parentScopeId: null },
      { scopeId: 'fs1_child', parentScopeId: 'fs1_root' },
    ],
    getScopeStatus: ({ scopeId }) => ({ connected: scopeId === 'fs1_root' }),
  });

  const resolved = await resolveScopeTarget({}, client, {
    allowImplicitFallback: true,
    isCUD: false,
  });

  assert.deepEqual(resolved, { scopeId: 'fs1_root', source: 'fallback' });
});

test('list_scopes merges associatedProfile from MCP runtime map', async () => {
  const client = createMockClient({
    listScopes: () => [
      { scopeId: 'fs1_root', parentScopeId: null, fabricUrl: 'https://root.example.com/fabric/root.msf', attachmentNodeUid: null, depth: 0 },
    ],
  });
  setScopeAssociatedProfile(client, 'fs1_root', 'default');

  const payload = JSON.parse(await handleListScopes(client, {}));
  assert.equal(payload.items[0].scopeId, 'fs1_root');
  assert.equal(payload.items[0].associatedProfile, 'default');
});

test('follow_attachment returns associatedProfile from MCP runtime map', async () => {
  const client = createMockClient({
    listScopes: () => [{ scopeId: 'fs1_root', parentScopeId: null }],
    followAttachment: async () => ({
      parentScopeId: 'fs1_root',
      attachmentNodeUid: 'fs1_root:physical:7',
      childScopeId: 'fs1_child',
      childFabricUrl: 'https://child.example.com/fabric/child.msf',
      reused: true,
    }),
  });
  setScopeAssociatedProfile(client, 'fs1_child', 'default');

  const payload = JSON.parse(await handleFollowAttachment(client, { scopeId: 'fs1_root', objectId: 'physical:7' }));
  assert.equal(payload.childScopeId, 'fs1_child');
  assert.equal(payload.associatedProfile, 'default');
});

test('close_scope clears associatedProfile entries for closed scopes', async () => {
  const client = createMockClient({
    listScopes: () => [
      { scopeId: 'fs1_a', parentScopeId: null, fabricUrl: 'https://a.example.com/fabric/a.msf', attachmentNodeUid: null, depth: 0 },
      { scopeId: 'fs1_b', parentScopeId: null, fabricUrl: 'https://b.example.com/fabric/b.msf', attachmentNodeUid: null, depth: 0 },
    ],
    closeScope: async () => ({ closedScopeIds: ['fs1_a'] }),
  });
  setScopeAssociatedProfile(client, 'fs1_a', 'default');
  setScopeAssociatedProfile(client, 'fs1_b', 'staging');

  await handleCloseScope(client, { scopeId: 'fs1_a' });
  const payload = JSON.parse(await handleListScopes(client, {}));
  const byId = Object.fromEntries(payload.items.map((item) => [item.scopeId, item.associatedProfile]));
  assert.equal(byId.fs1_a, null);
  assert.equal(byId.fs1_b, 'staging');
});

test('resolveProfileTarget enforces profile-only resource targeting', async () => {
  await assert.rejects(
    () => resolveProfileTarget({ profile: 'default', scopeId: 'fs1_conflict' }),
    (error) => error?.code === 'SCOPE_TARGET_CONFLICT'
  );

  await assert.rejects(
    () => resolveProfileTarget({}),
    (error) => error?.code === 'SCOPE_TARGET_MISSING'
  );
});

test('computeChildScopeId is deterministic and path-based', async () => {
  const parentA = 'fs1_parentA:physical:10';
  const parentB = 'fs1_parentB:physical:10';
  const childUrl = 'https://example.com/fabric/73/1';
  const childUrlWithSlash = 'https://example.com/fabric/73/1/';

  const a1 = await computeChildScopeId(parentA, childUrl);
  const a2 = await computeChildScopeId(parentA, childUrlWithSlash);
  const b1 = await computeChildScopeId(parentB, childUrl);

  assert.equal(a1, a2);
  assert.notEqual(a1, b1);
});

test('scene summary URL uses numeric classId path shape', () => {
  const shaped = shapeSceneSummary(
    'fs1_scope',
    {
      id: 'physical:42',
      name: 'Demo Scene',
      rootObjectId: 'physical:42',
      classId: 73,
    },
    'https://cdn.example.com/resources/'
  );

  assert.equal(shaped.url, 'https://cdn.example.com/resources/fabric/73/42');
});

test('bulk update returns CROSS_SCOPE_PARTIAL_FAILURE on mixed outcomes', async () => {
  const client = createMockClient({
    bulkUpdate: async ({ scopeId }) => {
      if (scopeId === 'fs1_ok') {
        return { success: 1, failed: 0, createdIds: ['physical:1'], errors: [] };
      }
      throw new Error('boom');
    },
  });

  const payload = JSON.parse(await handleBulkUpdate(client, {
    scopeBatches: [
      { scopeId: 'fs1_ok', operations: [{ type: 'delete', params: { objectId: 'physical:1' } }] },
      { scopeId: 'fs1_fail', operations: [{ type: 'delete', params: { objectId: 'physical:2' } }] },
    ],
  }));

  assert.equal(payload.code, 'CROSS_SCOPE_PARTIAL_FAILURE');
  assert.equal(payload.summary.succeeded, 1);
  assert.equal(payload.summary.failed, 1);
  assert.equal(payload.batches.length, 2);
});

test('bulk update returns failure code when all batches fail', async () => {
  const client = createMockClient({
    bulkUpdate: async () => {
      throw new Error('all-fail');
    },
  });

  const payload = JSON.parse(await handleBulkUpdate(client, {
    scopeBatches: [
      { scopeId: 'fs1_a', operations: [{ type: 'delete', params: { objectId: 'physical:1' } }] },
      { scopeId: 'fs1_b', operations: [{ type: 'delete', params: { objectId: 'physical:2' } }] },
    ],
  }));

  assert.equal(payload.code, 'CROSS_SCOPE_FAILURE');
  assert.equal(payload.summary.succeeded, 0);
  assert.equal(payload.summary.failed, 2);
});

test('bulk update returns OK when all batches succeed', async () => {
  const client = createMockClient({
    bulkUpdate: async ({ scopeId }) => ({
      success: 1,
      failed: 0,
      createdIds: [scopeId === 'fs1_a' ? 'physical:11' : 'physical:22'],
      errors: [],
    }),
  });

  const payload = JSON.parse(await handleBulkUpdate(client, {
    scopeBatches: [
      { scopeId: 'fs1_a', operations: [{ type: 'delete', params: { objectId: 'physical:1' } }] },
      { scopeId: 'fs1_b', operations: [{ type: 'delete', params: { objectId: 'physical:2' } }] },
    ],
  }));

  assert.equal(payload.code, 'OK');
  assert.equal(payload.summary.succeeded, 2);
  assert.equal(payload.summary.failed, 0);
});

test('open_scene returns get_object-equivalent payload plus url', async () => {
  const rootObject = {
    id: 'physical:7',
    scopeId: 'fs1_scope',
    nodeUid: 'fs1_scope:physical:7',
    parentId: 'root',
    parentNodeUid: 'fs1_scope:root:1',
    name: 'Scene Root',
    transform: {
      position: { x: 1, y: 2, z: 3 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      scale: { x: 1, y: 1, z: 1 },
    },
    resourceReference: 'https://cdn.example.com/resources/scene.glb',
    resourceName: 'scene.glb',
    bound: { x: 10, y: 5, z: 10 },
    classId: 73,
    type: 0,
    subtype: 0,
    isAttachmentPoint: false,
    children: ['physical:8'],
    orbit: null,
    properties: null,
  };
  const client = createMockClient({
    listScopes: () => [{ scopeId: 'fs1_scope', parentScopeId: null }],
    openScene: async () => rootObject,
    getResourceRootUrl: () => 'https://cdn.example.com/resources/',
  });

  const payload = JSON.parse(await handleOpenScene(client, { scopeId: 'fs1_scope', sceneId: 'physical:7' }));

  assert.equal(payload.scopeId, 'fs1_scope');
  assert.equal(payload.id, 'physical:7');
  assert.equal(payload.nodeUid, 'fs1_scope:physical:7');
  assert.equal(payload.parentId, 'root');
  assert.equal(payload.parentNodeUid, 'fs1_scope:root:1');
  assert.equal(payload.name, 'Scene Root');
  assert.deepEqual(payload.position, { x: 1, y: 2, z: 3 });
  assert.deepEqual(payload.rotation, { x: 0, y: 0, z: 0, w: 1 });
  assert.deepEqual(payload.scale, { x: 1, y: 1, z: 1 });
  assert.equal(payload.resourceReference, 'https://cdn.example.com/resources/scene.glb');
  assert.equal(payload.resourceName, 'scene.glb');
  assert.deepEqual(payload.bound, { x: 10, y: 5, z: 10 });
  assert.equal(payload.childCount, 1);
  assert.deepEqual(payload.children, ['physical:8']);
  assert.equal(payload.objectType, 'physical:default');
  assert.equal(payload.url, 'https://cdn.example.com/resources/fabric/73/7');
});

test('open_scene does not return legacy root/children wrapper', async () => {
  const client = createMockClient({
    listScopes: () => [{ scopeId: 'fs1_scope', parentScopeId: null }],
    openScene: async () => ({
      id: 'physical:9',
      name: 'Legacy Check',
      scopeId: 'fs1_scope',
      parentId: 'root',
      transform: {
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0, w: 1 },
        scale: { x: 1, y: 1, z: 1 },
      },
      resourceReference: null,
      resourceName: null,
      bound: null,
      classId: 73,
      type: 0,
      subtype: 0,
      isAttachmentPoint: false,
      children: [],
    }),
    getResourceRootUrl: () => 'https://cdn.example.com/resources/',
  });

  const payload = JSON.parse(await handleOpenScene(client, { scopeId: 'fs1_scope', sceneId: 'physical:9' }));
  assert.equal(Object.prototype.hasOwnProperty.call(payload, 'root'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(payload, 'sceneId'), false);
});

test('serializeToolError preserves structured fields for non-ToolError errors', () => {
  const payload = serializeToolError({
    code: 'ATTACHMENT_CYCLE_DETECTED',
    message: 'cycle',
    scopeId: 'fs1_scope',
    nodeUid: 'fs1_scope:physical:10',
    details: {
      existingNodeUid: 'fs1_scope:physical:1',
      existingLabel: 'Existing',
    },
  });

  assert.deepEqual(payload, {
    code: 'ATTACHMENT_CYCLE_DETECTED',
    message: 'cycle',
    scopeId: 'fs1_scope',
    nodeUid: 'fs1_scope:physical:10',
    details: {
      existingNodeUid: 'fs1_scope:physical:1',
      existingLabel: 'Existing',
    },
  });
});

test('object and resource schemas enforce scope-native anchors/targets', () => {
  const listObjectsSchema = objectTools.list_objects.inputSchema;
  const parseMissingAnchor = listObjectsSchema.safeParse({ scopeId: 'fs1_a' });
  assert.equal(parseMissingAnchor.success, false);

  const uploadSchema = resourceTools.upload_resource.inputSchema;
  const parseWithConflictField = uploadSchema.safeParse({
    profile: 'default',
    localPath: '/tmp/demo.glb',
    scopeId: 'fs1_conflict',
  });
  assert.equal(parseWithConflictField.success, false);
});

test('parseObjectType handles base types without subtype', () => {
  assert.deepEqual(parseObjectType('celestial:star'), { classId: 71, type: 10, subtype: 0 });
  assert.deepEqual(parseObjectType('physical:default'), { classId: 73, type: 0, subtype: 0 });
  assert.deepEqual(parseObjectType('terrestrial:parcel'), { classId: 72, type: 11, subtype: 0 });
});

test('parseObjectType handles numeric subtype suffix', () => {
  assert.deepEqual(parseObjectType('celestial:star:5'), { classId: 71, type: 10, subtype: 5 });
  assert.deepEqual(parseObjectType('celestial:star_cluster:3'), { classId: 71, type: 7, subtype: 3 });
});

test('parseObjectType handles attachment suffix', () => {
  assert.deepEqual(parseObjectType('celestial:star:attachment'), { classId: 71, type: 10, subtype: 255 });
  assert.deepEqual(parseObjectType('celestial:surface:attachment'), { classId: 71, type: 17, subtype: 255 });
  assert.deepEqual(parseObjectType('physical:transport:attachment'), { classId: 73, type: 1, subtype: 255 });
});

test('parseObjectType rejects invalid types', () => {
  assert.throws(() => parseObjectType('invalid:type'), /Unknown objectType/);
  assert.throws(() => parseObjectType('celestial:star:abc'), /Invalid subtype/);
  assert.throws(() => parseObjectType('celestial:star:256'), /Invalid subtype/);
});

test('formatObjectType produces correct strings', () => {
  assert.equal(formatObjectType(71, 10, 0), 'celestial:star');
  assert.equal(formatObjectType(71, 10, 5), 'celestial:star:5');
  assert.equal(formatObjectType(71, 10, 255), 'celestial:star:attachment');
  assert.equal(formatObjectType(73, 0, 0), 'physical:default');
  assert.equal(formatObjectType(73, 1, 255), 'physical:transport:attachment');
});

test('shapeObjectResponse includes objectType field', () => {
  const obj = {
    id: 'physical:1',
    parentId: 'root',
    name: 'Test',
    transform: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 }, scale: { x: 1, y: 1, z: 1 } },
    resourceReference: null,
    resourceName: null,
    bound: null,
    classId: 73,
    type: 0,
    subtype: 0,
    isAttachmentPoint: false,
    children: [],
  };
  const shaped = shapeObjectResponse('fs1_scope', obj);
  assert.equal(shaped.objectType, 'physical:default');
  assert.equal(shaped.isAttachmentPoint, undefined);
});

test('shapeObjectResponse formats attachment objectType', () => {
  const obj = {
    id: 'celestial:5',
    parentId: 'celestial:1',
    name: 'Surface',
    transform: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 }, scale: { x: 1, y: 1, z: 1 } },
    resourceReference: 'https://example.com/fabric/73/1',
    resourceName: null,
    bound: null,
    classId: 71,
    type: 17,
    subtype: 255,
    isAttachmentPoint: true,
    children: null,
  };
  const shaped = shapeObjectResponse('fs1_scope', obj);
  assert.equal(shaped.objectType, 'celestial:surface:attachment');
});

test('open_scene response includes objectType', async () => {
  const rootObject = {
    id: 'physical:7',
    scopeId: 'fs1_scope',
    nodeUid: 'fs1_scope:physical:7',
    parentId: 'root',
    parentNodeUid: 'fs1_scope:root:1',
    name: 'Scene Root',
    transform: {
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      scale: { x: 1, y: 1, z: 1 },
    },
    resourceReference: null,
    resourceName: null,
    bound: null,
    classId: 73,
    type: 0,
    subtype: 0,
    isAttachmentPoint: false,
    children: [],
    orbit: null,
    properties: null,
  };
  const client = createMockClient({
    listScopes: () => [{ scopeId: 'fs1_scope', parentScopeId: null }],
    openScene: async () => rootObject,
    getResourceRootUrl: () => 'https://cdn.example.com/resources/',
  });
  const payload = JSON.parse(await handleOpenScene(client, { scopeId: 'fs1_scope', sceneId: 'physical:7' }));
  assert.equal(payload.objectType, 'physical:default');
  assert.equal(payload.isAttachmentPoint, undefined);
});
