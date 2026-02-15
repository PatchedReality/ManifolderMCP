# Plan: Unified Fabric Client

## Context

`fabric-mcp/MVFabricClient.ts` (1279 lines, TypeScript, Node.js) and `Manifolder/mv-client.js` (662 lines, JavaScript, browser) both extend `MV.MVMF.NOTIFICATION` and implement nearly identical connection, lifecycle, and protocol logic. They serve two consumption patterns:

- **Subscription-based async**: Subscribe to events, data pushes to you. Manifolder uses this today and will extend it with fire-and-forget editing.
- **Promise-based sync**: Call a method, await a typed result. fabric-mcp uses this for MCP tool request-response.

These patterns are orthogonal — a single class can implement both, exposing two TypeScript interfaces. Each consumer types its reference to the interface it needs.

## Design: Single Class, Two Interfaces

```
┌─────────────────────────────────────────────┐
│  MVFabricClient                             │
│  extends MV.MVMF.NOTIFICATION              │
│  implements IFabricSubscription,            │
│             IFabricDirect                   │
│                                             │
│  Connection, auth, attach/detach lifecycle  │
│  Object cache, sendAction, search           │
│  Event emitter (on/off)                     │
│  CRUD methods (create/update/delete/move)   │
│  Scene management, bulk operations          │
└─────────────────────────────────────────────┘

IFabricSubscription          IFabricDirect
(Manifolder uses this)       (fabric-mcp uses this)
─────────────────────        ─────────────────────
on(event, handler)           listScenes()
off(event, handler)          openScene(id)
connect(url, options?)       createScene(name)
disconnect()                 deleteScene(id)
openModel(opts)              getObject(id)
closeModel(opts)             createObject(params)
subscribe(opts)              updateObject(params)
searchNodes(text)            deleteObject(id)
enumerateChildren(model)     moveObject(id, newParentId)
connected (getter)           findObjects(sceneId, query)
getResourceRootUrl()         bulkUpdate(operations)
                             getStatus()
```

Both interfaces share: `connect`, `disconnect`, `connected`, `getResourceRootUrl`.

## Package: `mv-fabric-client`

**Location:** `../mv-fabric-client/` (sibling to fabric-mcp and Manifolder under `Metaverse/`)

### Structure
```
mv-fabric-client/
  package.json            # type: module, main: dist/index.js
  tsconfig.json           # target: ES2022, module: NodeNext, declaration: true
  src/
    index.ts              # Re-exports class, interfaces, types, constants
    MVFabricClient.ts     # Single unified class
    interfaces.ts         # IFabricSubscription, IFabricDirect
    types.ts              # Vector3, Quaternion, Transform, FabricObject, Scene, etc.
    constants.ts          # ClassIds, OBJECT_TYPES, CLASS_ID_TO_TYPE, ObjectTypeMap
```

### MVMF Vendor Libraries — Stay in Each Project

The vendor libs stay where they are. Each project loads them its own way:
- fabric-mcp: Node.js shims (`node-shim.js`) + ESM imports
- Manifolder: `<script>` tags in HTML

The shared package assumes `globalThis.MV` is already set up. It declares `declare const MV: any`.

### interfaces.ts

```typescript
export type FabricEventMap = {
  connected: void;
  disconnected: void;
  status: string;
  mapData: any;                          // root MVMF model
  nodeInserted: { mvmfModel: any; parentType: string; parentId: number };
  nodeUpdated: { id: number; type: string; mvmfModel: any };
  nodeDeleted: { id: number; type: string; sourceParentType: string; sourceParentId: number };
  modelReady: { mvmfModel: any };
};

export interface IFabricSubscription {
  connect(url: string, options?: ConnectOptions): Promise<any>;
  disconnect(): Promise<void>;
  readonly connected: boolean;
  getResourceRootUrl(): string;

  on<K extends keyof FabricEventMap>(event: K, handler: (data: FabricEventMap[K]) => void): void;
  off<K extends keyof FabricEventMap>(event: K, handler: (data: FabricEventMap[K]) => void): void;

  openModel(opts: { sID: string; twObjectIx: number; mvmfModel?: any }): void;
  closeModel(opts: { sID: string; twObjectIx: number }): void;
  subscribe(opts: { sID: string; twObjectIx: number }): void;
  enumerateChildren(model: any): any[];
  searchNodes(searchText: string): Promise<SearchResults>;
}

export interface IFabricDirect {
  connect(url: string, options?: ConnectOptions): Promise<void>;
  disconnect(): Promise<void>;
  readonly connected: boolean;
  getResourceRootUrl(): string;
  getStatus(): ConnectionStatus;

  listScenes(): Promise<Scene[]>;
  openScene(sceneId: string): Promise<FabricObject>;
  createScene(name: string): Promise<Scene>;
  deleteScene(sceneId: string): Promise<void>;

  listObjects(sceneId: string, filter?: ObjectFilter): Promise<FabricObject[]>;
  getObject(objectId: string): Promise<FabricObject>;
  createObject(params: CreateObjectParams): Promise<FabricObject>;
  updateObject(params: UpdateObjectParams): Promise<FabricObject>;
  deleteObject(objectId: string, allowUnknownType?: boolean): Promise<void>;
  moveObject(objectId: string, newParentId: string, skipRefetch?: boolean): Promise<FabricObject>;

  findObjects(sceneId: string, query: SearchQuery): Promise<FabricObject[]>;
  bulkUpdate(operations: BulkOperation[]): Promise<BulkResult>;
}
```

### types.ts

Move shared types from `fabric-mcp/src/types.ts`:
- `Vector3`, `Quaternion`, `Transform`, `BoundingBox`
- `FabricObject` (currently `RMPObject` in fabric-mcp — rename)
- `Scene`, `ObjectFilter`, `SearchQuery`
- `CreateObjectParams`, `UpdateObjectParams`, `BulkOperation`
- `ConnectionStatus`, `ConnectOptions`
- `ClassIds`, `ClassPrefixes`, `ClassIdToPrefix`, `ObjectTypeMap`
- `parseObjectRef`, `formatObjectRef`

### MVFabricClient.ts — What's In It

Everything from both current clients, merged:

**From both (deduplicated):**
| Functionality | Current source |
|---|---|
| MSF→LnG→auth→root model connection flow | MVFabricClient:201-308, MVClient:131-324 |
| Disconnect + cleanup | MVFabricClient:375-425, MVClient:90-125 |
| Attach/detach lifecycle tracking | MVFabricClient:152-178, MVClient:403-419 |
| `sendAction()` promise wrapper | MVFabricClient:1183-1209, MVClient:645-656 |
| Child enumeration across all types | MVFabricClient:369-373, MVClient:347-356 |
| Class ID ↔ type name mapping | MVFabricClient:342-348, MVClient:393-401 |
| MVMF notification handlers (onReadyState, onInserted, onUpdated, onChanged, onDeleting) | Both |

**From MVFabricClient (CRUD / IFabricDirect):**
- Object cache (`Map<string, any>`), pending-ready, pending-updates
- Scene management: `listScenes`, `openScene`, `createScene`, `deleteScene`
- Object CRUD: `createObject`, `updateObject`, `deleteObject`, `moveObject`
- `bulkUpdate` with batching and concurrency
- `findObjects`, `serverSearch`, `loadFullTree`, `loadDirectChildren`
- `rmxToFabricObject()` (renamed from `rmxToRMPObject`)
- `getObjectName()`, `getResourceRootUrl()`, `resolveResourceName()`
- Connection generation tracking, `ensureConnected()`

**From MVClient (Events / IFabricSubscription):**
- Event emitter: `on()`, `off()`, `_emit()`, `callbacks` map
- `openModel()`, `closeModel()`, `subscribe()`
- `searchNodes()` with multi-root aggregation
- `_collectSearchableIndices()`, searchable index tracking
- `_isChildOf()` for parent-child verification in `onChanged`
- `_handleModelReadyState()`, pending model open tracking

**Notification handler merge strategy:**
The MVMF `onInserted`/`onUpdated`/`onChanged`/`onDeleting` handlers do both:
1. Update the object cache (from MVFabricClient)
2. Emit events (from MVClient)

Example merged `onInserted`:
```typescript
onInserted(pNotice: any) {
  const child = pNotice.pData?.pChild;
  const parent = pNotice.pCreator;
  // Cache update (from MVFabricClient)
  if (child?.twObjectIx) {
    this.objectCache.set(child.twObjectIx.toString(), child);
  }
  // Event emission (from MVClient)
  if (this._connected && child) {
    this._emit('nodeInserted', {
      mvmfModel: child,
      parentType: parent.sID,
      parentId: parent.twObjectIx
    });
  }
}
```

**Connection flow merge:**
The `connect()` method supports both modes via `ConnectOptions`:
- With `adminKey`: login flow → opens `RMRoot(1)` → `listScenes` etc. available
- Without `adminKey` (or with `sceneWClass`/`sceneObjectIx`): anonymous → opens specific scene root from MSF config → emits `mapData`
- Both modes: emit `connected` event, populate searchable indices

## Changes to Consuming Projects

### fabric-mcp

1. Remove `src/client/MVFabricClient.ts` entirely
2. Remove `src/types.ts` (moved to shared package)
3. Add dependency: `"mv-fabric-client": "file:../mv-fabric-client"`
4. Update all imports in `src/tools/*.ts` and `src/index.ts`:
   - `import { MVFabricClient, type IFabricDirect, type FabricObject, ... } from 'mv-fabric-client'`
   - Rename `RMPObject` → `FabricObject` throughout
5. Keep: vendor shims (`src/vendor/`), MCP tool layer, config, storage
6. The tool layer continues to call `client.createObject(...)`, `client.getObject(...)`, etc. — same API, just imported from the shared package

### Manifolder

1. Remove `client/js/mv-client.js` entirely
2. Copy compiled `mv-fabric-client/dist/` into `client/lib/mv-fabric-client/`
3. Update `client/js/app.js`:
   - `import { MVFabricClient } from '../lib/mv-fabric-client/index.js'`
   - Constructor: `this.client = new MVFabricClient()`
   - Type reference (JSDoc): `/** @type {import('../lib/mv-fabric-client').IFabricSubscription} */`
4. `loadMap(url)` call becomes `client.connect(url)` — the client reads wClass/twObjectIx from MSF config and emits `mapData` when ready
5. Keep: model.js, node-adapter.js, views, node-helpers.js (resource URL resolution is Manifolder-specific)
6. `model.js` continues subscribing via `client.on('nodeInserted', ...)` etc. — same event contract

## Implementation Order

1. Create `mv-fabric-client/` package skeleton (package.json, tsconfig.json)
2. Write `types.ts` and `constants.ts` (move from fabric-mcp/src/types.ts)
3. Write `interfaces.ts` (IFabricSubscription, IFabricDirect, FabricEventMap)
4. Write `MVFabricClient.ts` — merge both current clients into one class
5. Build, verify compilation
6. Wire up fabric-mcp: update imports, remove old client/types, test with MCP tools
7. Wire up Manifolder: copy compiled output, update imports, test in browser

## Verification

- **fabric-mcp**: `fabric_connect` (earth profile) → `list_scenes` → `open_scene` → `create_object` → `update_object` → `delete_object` → `find_objects` → `bulk_update` → `fabric_disconnect`
- **Manifolder**: Open in browser → load MSF URL → hierarchy tree populates → search returns results → clicking nodes loads children → live updates render
- **Both**: `disconnect` tears down cleanly without errors or leaked listeners