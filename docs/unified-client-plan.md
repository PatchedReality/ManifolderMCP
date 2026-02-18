# Plan: Unified Fabric Client

## Context

`fabric-mcp/MVFabricClient.ts` (1279 lines, TypeScript, Node.js) and `Manifolder/mv-client.js` (662 lines, JavaScript, browser) both extend `MV.MVMF.NOTIFICATION` and interact with Fabric scenes. They serve two consumption patterns:

- **Subscription-based (push)**: Attach to models, receive notifications. Manifolder uses this for live scene rendering, and will extend it with fire-and-forget editing.
- **Promise-based (pull)**: Call a method, await a typed result. fabric-mcp uses this for MCP tool request-response.

These patterns are orthogonal — a single class can implement both, exposing two TypeScript interfaces.

## Architecture: Model Layer First

Both clients already use the MVMF model layer (`Model_Open`, `model.Request(action)`, `pIAction.Send`). Neither hits raw IO protocol directly. The difference is:

- **Manifolder** uses the model layer idiomatically: open models, attach, receive notifications via `onInserted`/`onUpdated`/`onChanged`/`onDeleting`. The MVMF model graph *is* the cache.
- **fabric-mcp** uses the model layer for action sending, but reimplements everything else: maintains its own `objectCache: Map`, manually constructs `FabricObject` from model fields, manually tracks what's open and ready.

**The unified client uses Manifolder's model-layer approach as the foundation.** The MVMF model graph is the single source of truth.

### Gap: MVMF has no write abstraction

MVMF model objects (`RMCOBJECT`, `RMTOBJECT`, `RMPOBJECT`) are passive data containers. The read side is well-abstracted:

```
model = Model_Open(sID, twObjectIx)   // open + subscribe
children = model.Child_Enum(type)      // enumerate children
search = model.Search(vPosition)       // typeahead search via Input()
model.IsReady()                        // state query
model.Attach(listener)                 // subscribe to notifications
```

But **there are no write methods on the model objects**. Every write — create, update, delete, move — requires dropping to:

```
pIAction = model.Request('ACTION_NAME')   // get action handle
pIAction.pRequest.field = value           // manually fill payload fields
pIAction.Send(this, callback)             // send + await callback
```

This is the only write API in the entire MVMF stack. rp1.js (SceneAssembler) uses the same `Request`/`Send` pattern. There is no `model.Create(...)`, `model.Update(...)`, etc.

### Solution: CRUD methods in the unified client

The unified client adds write methods that encapsulate `Request`/`Send` + payload construction, so neither consumer ever touches the action protocol directly. These methods are shared by both interfaces:

- **IFabricDirect** calls them and awaits the promise
- **IFabricSubscription** calls them fire-and-forget (for future editing support in Manifolder)

```
┌──────────────────────────────────────────────────────────────────┐
│  MVFabricClient extends MV.MVMF.NOTIFICATION                     │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  Core (from MVClient)                                      │  │
│  │  Connection: MSF → LnG → auth → root model                 │  │
│  │  Model lifecycle: Model_Open, Attach, Detach                │  │
│  │  Notifications: onInserted, onUpdated, onChanged, ...       │  │
│  │  Events: on/off/emit                                        │  │
│  │  Child enumeration: Child_Enum across types                 │  │
│  │  Search: model.Search() / searchNodes()                     │  │
│  └────────────────────────────────────────────────────────────┘  │
│                              │                                   │
│  ┌───────────────────────────┴────────────────────────────────┐  │
│  │  CRUD layer (new — fills the MVMF gap)                     │  │
│  │  Encapsulates Request/Send + payload construction          │  │
│  │                                                            │  │
│  │  _createChild(parent, params) → Promise<model>             │  │
│  │  _updateFields(model, fields) → Promise<void>              │  │
│  │  _deleteChild(parent, child) → Promise<void>               │  │
│  │  _reparent(model, newParent) → Promise<void>               │  │
│  │  _sendAction(pIAction) → Promise<response>  (internal)     │  │
│  └────────────────────────────────────────────────────────────┘  │
│                              │                                   │
│              ┌───────────────┴───────────────┐                   │
│              ▼                               ▼                   │
│  ┌──────────────────────┐  ┌──────────────────────────────────┐ │
│  │  IFabricSubscription │  │  IFabricDirect                   │ │
│  │  (Manifolder)        │  │  (fabric-mcp)                    │ │
│  │                      │  │                                  │ │
│  │  openModel()         │  │  getObject()                     │ │
│  │  closeModel()        │  │  createObject() ─→ _createChild  │ │
│  │  subscribe()         │  │  updateObject() ─→ _updateFields │ │
│  │  enumerateChildren() │  │  deleteObject() ─→ _deleteChild  │ │
│  │  searchNodes()       │  │  moveObject()   ─→ _reparent     │ │
│  │  on/off events       │  │  listScenes()                    │ │
│  │                      │  │  findObjects()                   │ │
│  │  Direct model-layer  │  │  bulkUpdate()                    │ │
│  │  access + fire-and-  │  │                                  │ │
│  │  forget CRUD         │  │  Promise wrappers +              │ │
│  │                      │  │  _toFabricObject serialization   │ │
│  └──────────────────────┘  └──────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────┘
```

### CRUD layer details

These internal methods own all `Request`/`Send` interaction. No code outside this layer touches the action protocol.

**`_createChild(parent, params)`** — creates a child object on a parent model
- Determines action name from parent/child types: `RMCOBJECT_OPEN`, `RMTOBJECT_OPEN`, `RMPOBJECT_OPEN`
- Fills payload: `pName`, `pType`, `pOwner`, `pResource`, `pTransform`, `pBound`
- Type-specific fields: `pCoord` (terrestrial), `pOrbit_Spin`/`pProperties` (celestial)
- Returns the new model (opened via `Model_Open` after receiving the new ID from `response.aResultSet`)

**`_updateFields(model, fields)`** — updates one or more field groups on a model
- Sends discrete actions sequentially, only for fields that changed:
  - `NAME` → `pName`
  - `TRANSFORM` → `pTransform` (+ `pCoord` for terrestrial)
  - `RESOURCE` → `pResource`
  - `BOUND` → `pBound`
  - `ORBIT_SPIN` / `ORBIT` → `pOrbit_Spin` (celestial)
  - `PROPERTIES` → `pProperties` (celestial)
- Mirrors SceneAssembler's `RMPEditAll` pattern from `maputil.js`

**`_deleteChild(parent, child)`** — removes a child from its parent
- Determines action: `RMCOBJECT_CLOSE`, `RMTOBJECT_CLOSE`, `RMPOBJECT_CLOSE`
- Fills `twRMxObjectIx_Close` and `bDeleteAll`

**`_reparent(model, newParent)`** — moves an object to a new parent
- Sends `PARENT` action on the object being moved
- Fills `wClass` and `twObjectIx` for the new parent

**`_sendAction(pIAction)`** — the only place `pIAction.Send()` is called
- Wraps `Send(this, callback)` in a promise with timeout
- All CRUD methods and search delegate here

### What goes away from fabric-mcp

fabric-mcp's `MVFabricClient.ts` reimplements several things the model layer provides:

| fabric-mcp reimplements | Model layer provides |
|---|---|
| `objectCache: Map<string, any>` + manual insert/evict | MVMF model graph — opened models stay live, updated via notifications |
| `openAndWait()` / `waitForReady()` polling | `Model_Open` + `onReadyState` notification |
| `pendingReady`, `pendingUpdates` tracking | `model.IsReady()` + notification callbacks |
| Manual `Attach`/`Detach` tracking via `attachedObjects: Set` | MVClient's `_safeAttach`/`_safeDetach` pattern |
| `rmxToFabricObject()` field-by-field extraction | Still needed as `_toFabricObject` (model → plain object for JSON transport), but reads from live model state |
| `loadDirectChildren` / `loadFullTree` recursive open | `enumerateChildren` via `Child_Enum` + `openModel` for deeper loads |
| Raw `Request`/`Send` calls throughout CRUD methods | CRUD layer encapsulates all action protocol interaction |

## Design: Single Class, Two Interfaces

```
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

### MVFabricClient.ts — Layered Architecture

**Layer 1: Core (from MVClient — the foundation)**

MVClient's model-layer code becomes the base class or core section:

| Functionality | Source |
|---|---|
| MSF → LnG → auth → root model connection flow | MVClient:127-324 |
| Disconnect + cleanup | MVClient:90-125 |
| Model lifecycle: `Model_Open`, `_safeAttach`, `_safeDetach` | MVClient:175-216 |
| Notification handlers: `onReadyState`, `onInserted`, `onUpdated`, `onChanged`, `onDeleting` | MVClient:202-460 |
| `_isChildOf` for insert/delete disambiguation in `onChanged` | MVClient:160 |
| Event emitter: `on()`, `off()`, `_emit()` | MVClient:61-85 |
| Child enumeration via `Child_Enum` | MVClient:326-356 |
| `_collectSearchableIndices` + `searchNodes` | MVClient:470-590 |
| `_handleModelReadyState`, pending model tracking | MVClient:358-386 |

**Layer 2: CRUD layer (new — fills the MVMF write gap)**

Encapsulates all `Request`/`Send` interaction. No code outside this layer touches the action protocol.

| Internal method | What it encapsulates |
|---|---|
| `_createChild(parent, params)` | `parent.Request(OPEN_ACTION)` → fill `pName`/`pType`/`pOwner`/`pResource`/`pTransform`/`pBound`/`pCoord`/`pOrbit_Spin`/`pProperties` → `_sendAction` → `Model_Open` new child |
| `_updateFields(model, fields)` | Sequential `model.Request(NAME/TRANSFORM/RESOURCE/BOUND/ORBIT_SPIN/PROPERTIES)` → fill payload → `_sendAction` each (only changed fields) |
| `_deleteChild(parent, child)` | `parent.Request(CLOSE_ACTION)` → fill `twRMxObjectIx_Close`/`bDeleteAll` → `_sendAction` |
| `_reparent(model, newParent)` | `model.Request('PARENT')` → fill `wClass`/`twObjectIx` → `_sendAction` |
| `_sendAction(pIAction)` | Wraps `pIAction.Send(this, callback)` in a promise with timeout. The **only** place `Send` is called. |

Both interfaces use these methods:
- **IFabricDirect**: `createObject()` calls `_createChild()`, awaits the result, serializes via `_toFabricObject()`
- **IFabricSubscription**: Manifolder's future editing calls `_createChild()` fire-and-forget, relying on `onInserted` notification to update the UI

**Layer 3: Public interface methods**

| Method | How it delegates |
|---|---|
| `getObject(id)` | `_openAndReady(classId, numericId)` → `_toFabricObject(model)` |
| `listScenes()` | Wait for root model ready → `enumerateChildren(pRMRoot)` → map to `Scene[]` |
| `openScene(id)` | `_openAndReady` on scene → enumerate + open direct children → `_toFabricObject` |
| `createObject(params)` | `_openAndReady` parent → `_createChild(parent, params)` → `_toFabricObject` |
| `updateObject(params)` | `_openAndReady` object → `_updateFields(model, params)` → `_toFabricObject` |
| `deleteObject(id)` | `_openAndReady` object → read parent → `_openAndReady` parent → `_deleteChild(parent, child)` |
| `moveObject(id, newParent)` | `_openAndReady` object → `_openAndReady` new parent → `_reparent(model, newParent)` → `_toFabricObject` |
| `findObjects(sceneId, query)` | Uses `searchNodes` (model-layer search) → `_toFabricObject` each result |
| `bulkUpdate(ops)` | Batched calls to `createObject`/`updateObject`/`deleteObject`/`moveObject` with concurrency control |

**`_openAndReady` helper**: calls `Model_Open`, attaches if needed, returns a promise that resolves when `onReadyState` fires with `READY`. This replaces fabric-mcp's `openAndWait`/`waitForReady` polling with the notification-driven pattern MVClient already uses.

**Notification handlers do double duty:**
```typescript
onInserted(pNotice: any) {
  const child = pNotice.pData?.pChild;
  const parent = pNotice.pCreator;
  // Event emission (IFabricSubscription consumers)
  if (this._connected && child) {
    this._emit('nodeInserted', {
      mvmfModel: child,
      parentType: parent.sID,
      parentId: parent.twObjectIx
    });
  }
  // No separate object cache — the MVMF model graph IS the cache
}
```

**Connection flow supports both modes via `ConnectOptions`:**
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
5. Keep: vendor shims (`src/vendor/`), MCP tool layer, config, storage, error translation
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
4. Port MVClient (Manifolder) to TypeScript as Layer 1 core of `MVFabricClient.ts`
5. Add Layer 2 CRUD methods (`_createChild`, `_updateFields`, `_deleteChild`, `_reparent`, `_sendAction`) — encapsulate all `Request`/`Send` + payload construction
6. Add Layer 3 public interface methods + `_toFabricObject` serialization
7. Build, verify compilation
8. Wire up fabric-mcp: update imports, remove old client/types, test with MCP tools
9. Wire up Manifolder: copy compiled output, update imports, test in browser

## Verification

- **fabric-mcp**: `fabric_connect` (earth profile) → `list_scenes` → `open_scene` → `create_object` → `update_object` → `delete_object` → `find_objects` → `bulk_update` → `fabric_disconnect`
- **Manifolder**: Open in browser → load MSF URL → hierarchy tree populates → search returns results → clicking nodes loads children → live updates render
- **Both**: `disconnect` tears down cleanly without errors or leaked listeners
