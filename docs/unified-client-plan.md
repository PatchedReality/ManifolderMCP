# Plan: Unified Manifolder Client

## Status

Legacy/historical document retained for context. It is not the normative contract for current multi-scope behavior.

Normative sources:
- `ATTACHMENT_POINT_CROSS_STACK_PLAN.md`
- `MANIFOLDERCLIENT_SCOPE_NATIVE_API_DIFF_CHECKLIST.md`
- `ManifolderMCP/docs/attachment-multiscope-api-spec.md`

## Context

`ManifolderMCP/src/client/ManifolderClient.js` (Node.js) and `Manifolder/client/js/ManifolderClient.js` (browser) both extend `MV.MVMF.NOTIFICATION` and interact with Fabric scenes. They serve two consumption patterns:

- **Subscription-based (push)**: Attach to models, receive notifications. Manifolder uses this for live scene rendering, and will extend it with fire-and-forget editing.
- **Promise-based (pull)**: Call a method, await a typed result. ManifolderMCP uses this for MCP tool request-response.

These patterns are orthogonal — a single class can implement both, exposing two contract surfaces (`IManifolderSubscriptionClient` and `IManifolderPromiseClient`) documented via JSDoc typedefs in one JavaScript file.

## Current Progress (2026-02-19)

### Completed in `ManifolderMCP`

- Unified client implemented at `src/client/ManifolderClient.js` with both contract surfaces:
  - `IManifolderSubscriptionClient`
  - `IManifolderPromiseClient`
- Naming aligned to current decision:
  - `ManifolderClient`
  - `IManifolderSubscriptionClient`
  - `IManifolderPromiseClient`
- MCP handlers now consume the promise interface only (`src/tools/*.ts` import `IManifolderPromiseClient`).
- Legacy TS client replaced in this repo by JS client copy + typings (`src/client/ManifolderClient.d.ts`).
- Unit test suite added and passing (`src/client/ManifolderClient.test.js`).
- Integration test suite added (`test/integration/ManifolderClient.integration.test.js`).
- Public factory exports added:
  - `createManifolderSubscriptionClient()`
  - `createManifolderPromiseClient()`
- MCP bootstrap now instantiates via promise factory (`src/index.ts`) instead of direct class + view wrapping.
- `loadMap` removed from subscription interface contract (`src/client/ManifolderClient.d.ts`) and subscription view method list (`src/client/ManifolderClient.js`).
- Unit tests now include factory-surface checks and full interface-method invocation coverage through interface views.
- Write confirmation now uses strict notification-first behavior:
  - CUD waits for model notifications to confirm mutation success.
  - No refresh fallback is used in CUD paths.
- Canonical sync executed: `../Manifolder/client/js/ManifolderClient.js` and `src/client/ManifolderClient.js` are currently identical.
- Cross-repo client tests currently pass in both repos (`npm test` in `ManifolderMCP` and `Manifolder/client`).
- Manifolder app consumption updated to subscription factory + `connect`:
  - `../Manifolder/client/js/app.js` imports `createManifolderSubscriptionClient()`
  - map load path now calls `client.connect(url)` (no `loadMap`).
- Integration write tests now enforce owned-ID safety boundaries for CUD.
- Manual live fixture recorder added:
  - Command: `npm run test:record-fixtures`
  - Script: `test/integration/record-manifolder-fixtures.js`
  - Output: `test/fixtures/manifolder/live/*.json` (gitignored)
- First live fixture snapshot captured on `default` profile:
  - `test/fixtures/manifolder/live/latest.json`
  - Includes action request/response payloads and raw notice shapes.
- Live integration validation completed on default server profile:
  - Command: `FABRIC_IT_ENABLED=1 FABRIC_IT_WRITE=1 npm run test:integration`
  - Result: 3/3 passing (`connect/disconnect`, `scene browse`, `optional write path create/delete scene`).
- Move/delete notification race fixed:
  - Root cause: moved object cache entry could retain stale parent metadata when child models are not auto-attached from parent notifications.
  - Fix: `moveObject` evicts moved object cache entry after successful confirmation so later CUD reloads authoritative state.
  - Regression coverage: unit test `moveObject evicts moved object cache entry so later operations reload authoritative parent`.
- Parent-notification behavior aligned with requirement:
  - Child models are cached but not auto-attached when seen via parent notifications.
- Integration teardown stability hardened:
  - Non-concurrent integration tests and graceful disconnect flow prevent post-test async teardown faults.
- Temporary delete-trace instrumentation used for diagnosis was removed after validation.

### Open TODOs

- **Test depth for notification-first writes:** add explicit tests for create/update/delete/move notification confirmation paths and timeout fallback behavior.
- **Factory-only public API hardening:** remove/retire direct class exports from public consumption once compatibility impact is resolved.
- **Cross-repo verification:** run Manifolder browser smoke/compat tests (not just Node client tests) against the same client revision.
- **CI gates:** enforce drift check + tests in both repos as required by this plan.
- **Operational tuning:** evaluate whether to keep current per-step integration diagnostics or reduce log verbosity now that core flows are stable.

### Locked Test Policy

1. **Live fixture scope is full:** record real payloads for the full interface surface (including CUD, move, bulk, and notification paths).
2. **Fixture refresh is manual-only:** capture/update fixtures via explicit operator command; no automatic refresh.
3. **Unit tests must adhere to real payload shapes:** interface-surface tests use captured payload fixtures for equivalent operations/events. Any synthetic fixture must be explicitly marked and justified.
4. **Safety boundary for writes:** tests may only mutate run-created scenes/objects tracked as test-owned IDs; never touch pre-existing fabric content.
5. **Target fabric for recording:** use `default` profile for now.
6. **CI policy (Option A):** CI runs unit tests + drift checks only. Live integration/recording/write tests remain manual and opt-in.

### Session Handoff Notes

- Canonical source remains `../Manifolder/client/js/ManifolderClient.js`; `ManifolderMCP/src/client/ManifolderClient.js` is a synced copy.
- Preferred write-confirmation strategy is **notification-first**; targeted refresh is currently fallback-only on notification timeout.
- `list_objects` behavior should remain unchanged: list loaded subtree under `scopeId` (including `scopeId`) without forcing deep loads.
- Global Codex MCP server `fabric` is configured via `~/.codex/config.toml` (`[mcp_servers.fabric]`).
- To resume in a new session quickly: read this section plus `Current Progress` and `Open TODOs` in this file first.

## Architecture: Model Layer First

Both clients already use the MVMF model layer (`Model_Open`, `model.Request(action)`, `pIAction.Send`). Neither hits raw IO protocol directly. The difference is:

- **Manifolder** uses the model layer idiomatically: open models, attach, receive notifications via `onInserted`/`onUpdated`/`onChanged`/`onDeleting`. The MVMF model graph *is* the cache.
- **ManifolderMCP** uses the model layer for action sending, but reimplements everything else: maintains its own `objectCache: Map`, manually constructs `FabricObject` from model fields, manually tracks what's open and ready.

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

- **IManifolderPromiseClient** calls them and awaits the promise
- **IManifolderSubscriptionClient** calls them fire-and-forget (for future editing support in Manifolder)

```
┌──────────────────────────────────────────────────────────────────┐
│  ManifolderClient extends MV.MVMF.NOTIFICATION                     │
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
│  │  IManifolderSubscriptionClient │  │  IManifolderPromiseClient                   │ │
│  │  (Manifolder)        │  │  (ManifolderMCP)                    │ │
│  │                      │  │                                  │ │
│  │  openModel()         │  │  getObject()                     │ │
│  │  closeModel()        │  │  listObjects()                   │ │
│  │  subscribe()         │  │  createObject() ─→ _createChild  │ │
│  │  enumerateChildren() │  │  updateObject() ─→ _updateFields │ │
│  │  searchNodes()       │  │  deleteObject() ─→ _deleteChild  │ │
│  │  on/off events       │  │  moveObject()   ─→ _reparent     │ │
│  │                      │  │  list/create/deleteScene()       │ │
│  │  Direct model-layer  │  │  findObjects(), bulkUpdate()     │ │
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
- All CRUD methods and SEARCH actions delegate here

### What goes away from ManifolderMCP

ManifolderMCP's former `MVFabricClient.ts` implementation reimplements several things the model layer provides:

| ManifolderMCP reimplements | Model layer provides |
|---|---|
| `objectCache: Map<string, any>` + manual insert/evict | MVMF model graph — opened models stay live, updated via notifications |
| `openAndWait()` / `waitForReady()` polling | `Model_Open` + `onReadyState` notification |
| `pendingReady`, `pendingUpdates` tracking | `model.IsReady()` + notification callbacks |
| Manual `Attach`/`Detach` tracking via `attachedObjects: Set` | MVClient's `_safeAttach`/`_safeDetach` pattern |
| `rmxToFabricObject()` field-by-field extraction | Still needed as `_toFabricObject` (model → plain object for JSON transport), but reads from live model state |
| `loadDirectChildren` / `loadFullTree` recursive open | `enumerateChildren` via `Child_Enum` + `openModel` for deeper loads |
| Raw `Request`/`Send` calls throughout CRUD methods | CRUD layer encapsulates all action protocol interaction |

## Design: Single Implementation, Two Public Interfaces

Internal implementation remains one class, but public construction is factory-based so each consumer chooses exactly one interface surface:

```
createManifolderSubscriptionClient(): IManifolderSubscriptionClient
createManifolderPromiseClient(): IManifolderPromiseClient
```

`ManifolderClient` remains internal implementation detail (not part of public API contract).

```
IManifolderSubscriptionClient          IManifolderPromiseClient
(Manifolder uses this)       (ManifolderMCP uses this)
─────────────────────        ─────────────────────
on(event, handler)           listScenes()
off(event, handler)          openScene(id)
connect(url, options?)       createScene(name, objectType?)
disconnect()                 deleteScene(id)
openModel(opts)              listObjects(scopeId, filter?)
closeModel(opts)             createObject(params)
subscribe(opts)              updateObject(params)
searchNodes(text)            deleteObject(id)
enumerateChildren(model)     moveObject(id, newParentId)
connected (getter)           findObjects(sceneId, query)
getResourceRootUrl()         bulkUpdate(operations)
                             getStatus()
```

Both interfaces share: `connect`, `disconnect`, `connected`, `getResourceRootUrl`.

### Locked behavior decisions

The unified implementation must preserve these behaviors from current consumers:

1. **Scene APIs remain in `IManifolderPromiseClient`**: `createScene` and `deleteScene` stay as first-class methods (thin wrappers over object CRUD under root).
2. **Single `connect` return type for both interfaces**: `connect` resolves to a typed `ConnectResult` that includes the connected root model; direct consumers can ignore it.
3. **Factory-only public API**: consumers construct clients only through `createManifolderSubscriptionClient()` or `createManifolderPromiseClient()`; `ManifolderClient` is internal.
4. **One consumer, one surface**: Manifolder exclusively uses `IManifolderSubscriptionClient`; MCP exclusively uses `IManifolderPromiseClient`.
5. **Drop `loadMap` from the interface contract**: Manifolder uses `connect` directly for map loading.
6. **Per-repo copies with one canonical owner**: both repos keep their own `ManifolderClient.js` copy, but the canonical source is Manifolder (for now). ManifolderMCP syncs from that canonical file.
7. **No client-side admin gate on CRUD**: connection without `adminKey` (MSF scene-root mode) may still call CRUD APIs; authorization is enforced by the Fabric server.
8. **`listObjects` is part of Layer 3**: it remains a first-class direct API method.
9. **`_sendAction` is the only `Send()` call site**: this includes SEARCH action dispatch.
10. **`bulkUpdate` is best-effort, non-transactional**: partial success is expected and reported; no rollback.

## Shared Source Layout

**Canonical location (for now):** `../Manifolder/client/js/ManifolderClient.js`

### Structure
```
Manifolder/
  client/js/ManifolderClient.js          # Canonical unified client source (class + constants + helpers + JSDoc typedefs)
  client/js/ManifolderClient.test.js     # Canonical unit/integration tests for unified client

ManifolderMCP/
  src/client/ManifolderClient.js         # Synced copy of canonical source
  src/client/ManifolderClient.d.ts       # Generated typings for TS consumers
```

### MVMF Vendor Libraries — Stay in Each Project

The vendor libs stay where they are. Each project loads them its own way:
- ManifolderMCP: Node.js shims (`node-shim.js`) + ESM imports
- Manifolder: `<script>` tags in HTML

The shared file assumes `globalThis.MV` is already set up.

### API Contracts (JSDoc in canonical `ManifolderClient.js`)

The canonical source file declares JSDoc typedefs for:
- `FabricEventMap`
- `IManifolderSubscriptionClient`
- `IManifolderPromiseClient`
- `createManifolderSubscriptionClient`, `createManifolderPromiseClient`
- `FabricObject`, `Scene`, `SearchQuery`, `ObjectFilter`, `BulkOperation`
- `ConnectOptions`, `ConnectResult`, `ConnectionStatus`

`src/client/ManifolderClient.d.ts` in ManifolderMCP is generated from the canonical JSDoc and is not hand-edited.

### Unified Client Class — Layered Architecture

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

Encapsulates all `Request`/`Send` interaction (including SEARCH). No code outside this layer touches the action protocol.

| Internal method | What it encapsulates |
|---|---|
| `_createChild(parent, params)` | `parent.Request(OPEN_ACTION)` → fill `pName`/`pType`/`pOwner`/`pResource`/`pTransform`/`pBound`/`pCoord`/`pOrbit_Spin`/`pProperties` → `_sendAction` → `Model_Open` new child |
| `_updateFields(model, fields)` | Sequential `model.Request(NAME/TRANSFORM/RESOURCE/BOUND/ORBIT_SPIN/PROPERTIES)` → fill payload → `_sendAction` each (only changed fields) |
| `_deleteChild(parent, child)` | `parent.Request(CLOSE_ACTION)` → fill `twRMxObjectIx_Close`/`bDeleteAll` → `_sendAction` |
| `_reparent(model, newParent)` | `model.Request('PARENT')` → fill `wClass`/`twObjectIx` → `_sendAction` |
| `_sendAction(pIAction)` | Wraps `pIAction.Send(this, callback)` in a promise with timeout. The **only** place `Send` is called. |

Both interfaces use these methods:
- **IManifolderPromiseClient**: `createObject()` calls `_createChild()`, awaits the result, serializes via `_toFabricObject()`
- **IManifolderSubscriptionClient**: Manifolder's future editing calls `_createChild()` fire-and-forget, relying on `onInserted` notification to update the UI

**Layer 3: Public interface methods**

| Method | How it delegates |
|---|---|
| `getObject(id)` | `_openAndReady(classId, numericId)` → `_toFabricObject(model)` |
| `listScenes()` | Wait for root model ready → `enumerateChildren(pRMRoot)` → map to `Scene[]` |
| `openScene(id)` | `_openAndReady` on scene → enumerate + open direct children → `_toFabricObject` |
| `createScene(name, objectType?)` | `createObject({ parentId: 'root', ... })` wrapper that returns `Scene` |
| `deleteScene(sceneId)` | `_openAndReady` root → `_deleteChild(root, sceneRoot)` with `bDeleteAll=1` |
| `listObjects(scopeId, filter?)` | Enumerates currently loaded subtree from scope via `enumerateChildren`; applies optional client-side filters |
| `createObject(params)` | `_openAndReady` parent → `_createChild(parent, params)` → `_toFabricObject` |
| `updateObject(params)` | `_openAndReady` object → `_updateFields(model, params)` → `_toFabricObject` |
| `deleteObject(id)` | `_openAndReady` object → read parent → `_openAndReady` parent → `_deleteChild(parent, child)` |
| `moveObject(id, newParent)` | `_openAndReady` object → `_openAndReady` new parent → `_reparent(model, newParent)` → `_toFabricObject` |
| `findObjects(sceneId, query)` | Uses `searchNodes` (model-layer search) → `_toFabricObject` each result |
| `bulkUpdate(ops)` | Batched calls to `createObject`/`updateObject`/`deleteObject`/`moveObject` with concurrency control; best-effort partial success, no rollback |

**`_openAndReady` helper**: calls `Model_Open`, attaches if needed, returns a promise that resolves when `onReadyState` fires with `READY`. This replaces ManifolderMCP's `openAndWait`/`waitForReady` polling with the notification-driven pattern MVClient already uses.

**Notification handlers do double duty:**
```javascript
onInserted(pNotice) {
  const child = pNotice.pData?.pChild;
  const parent = pNotice.pCreator;
  // Event emission (IManifolderSubscriptionClient consumers)
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
- In anonymous mode, CRUD APIs are still callable; permission decisions are server-enforced (no artificial client-side admin gate)
- Both modes: emit `connected` event, populate searchable indices

## Changes to Consuming Projects

### ManifolderMCP

1. Replace `src/client/MVFabricClient.ts` with `src/client/ManifolderClient.js` (synced copy from canonical Manifolder source).
2. Generate `src/client/ManifolderClient.d.ts` from canonical JSDoc for TypeScript tooling.
3. Update imports in `src/tools/*.ts` and `src/index.ts` to import from local JS client module:
   - `import { createManifolderPromiseClient } from './client/ManifolderClient.js'` (or `./client/index.js`)
   - instantiate once: `const client = createManifolderPromiseClient()`
4. Remove duplicate local constants/helpers/types that are now exported from `src/client/ManifolderClient.js`.
5. Keep ManifolderMCP-specific code: vendor shims (`src/vendor/`), MCP tool handlers, config, storage, and error translation.
6. Keep existing MCP tool API surface unchanged (`list_scenes`, `open_scene`, `create_object`, etc.); only the underlying client implementation is swapped.

### Manifolder

1. Keep `client/js/ManifolderClient.js` as the canonical source file and replace its internals with unified client implementation.
2. Update `client/js/app.js` to import `createManifolderSubscriptionClient()` and use that surface only.
3. Remove direct class construction from Manifolder app code.
4. Update map loading flow:
   - `const { rootModel } = await client.connect(url)` and pass `rootModel` to `model.setTree(...)`
   - keep handling `mapData` event for compatibility if needed
5. Keep Manifolder-specific code: `model.js`, `node-adapter.js`, views, `node-helpers.js`.
6. Keep event contract unchanged (`nodeInserted`, `nodeUpdated`, `nodeDeleted`, `modelReady`, `disconnected`).

### Source Synchronization Rule

Only `../Manifolder/client/js/ManifolderClient.js` is edited manually (canonical source). `ManifolderMCP/src/client/ManifolderClient.js` is synced from it via script. Add sync scripts in both repos and fail CI if files drift.

## Implementation Order

1. Replace `../Manifolder/client/js/ManifolderClient.js` with the unified implementation (canonical source).
2. Add CRUD/action layer (`_createChild`, `_updateFields`, `_deleteChild`, `_reparent`, `_sendAction`) in canonical source.
3. Add direct API wrappers (`listScenes`, `openScene`, `createScene`, `listObjects`, `bulkUpdate`, etc.) and `_toFabricObject`.
4. Add JSDoc typedef contracts (`IManifolderSubscriptionClient`, `IManifolderPromiseClient`, data shapes) in canonical source.
5. Refactor to factory-only public API and remove `loadMap` from subscription contract (`connect` only).
6. Update Manifolder app to consume only `IManifolderSubscriptionClient` via `createManifolderSubscriptionClient()`.
7. Update MCP bootstrap to consume only `IManifolderPromiseClient` via `createManifolderPromiseClient()`.
8. Add/verify canonical tests in Manifolder against this source.
9. Expand unit tests to cover full `IManifolder*` surface through interface contracts.
10. Add record/replay fixture flow for live response capture and mock-shape validation.
11. Sync canonical source into `ManifolderMCP/src/client/ManifolderClient.js`.
12. Generate/update `ManifolderMCP/src/client/ManifolderClient.d.ts` from canonical JSDoc.
13. Wire `ManifolderMCP` imports to local synced JS module and remove old TS client implementation.
14. Add drift-check + test steps in CI for both repos.

## Automated Test Suite

### Canonical Client Tests (in Manifolder)

- **Unit tests** (Vitest):
  - object ref helpers: `parseObjectRef`, `formatObjectRef`
  - type/class maps and validation behavior
  - event emitter behavior (`on`/`off`/emit ordering and isolation)
  - error translation and formatting helpers
- **Integration tests** (mocked MVMF objects):
  - connection lifecycle: `connect`, `disconnect`, reconnect, teardown cleanup
  - ready-state flow via notifications (`onReadyState`-driven resolution)
  - CRUD payload construction for create/update/delete/move
  - `_sendAction` timeout and error paths; verify all `Send()` calls go through `_sendAction`
  - anonymous-mode behavior (client does not artificially block CRUD; permission failures come from server responses)
  - `bulkUpdate` partial-success semantics and aggregated error reporting
  - search behavior (supported vs unavailable SEARCH actions)

### ManifolderMCP Compatibility Tests

- Tool-handler contract tests with mocked client transport:
  - `connection`, `scene`, `object`, and `bulk` handlers preserve current JSON response shapes
  - scene/object IDs remain in prefixed format (`physical:`, `terrestrial:`, `celestial:`)
- Smoke test with real client instance (when env/profile provided):
  - `fabric_connect` → `list_scenes` → `open_scene` → CRUD path → `fabric_disconnect`

### Manifolder Compatibility Tests

- Browser-side tests (Vitest + jsdom or existing harness):
  - `connect(url)` returns root model and `Model.setTree(...)` still works
  - hierarchy updates on `nodeInserted`/`nodeUpdated`/`nodeDeleted`
  - `searchNodes` integration remains functional
  - `closeModel`/`subscribe` behavior preserves expansion/live-update logic

### CI Gates

- Canonical Manifolder client tests must pass before syncing to ManifolderMCP.
- Drift check (`Manifolder canonical` vs `ManifolderMCP synced copy`) must pass before merge.
- ManifolderMCP compatibility/unit tests must pass before merge.
- Manifolder compatibility/unit tests (or smoke test) must pass before merge.
- Live integration/recording/write tests are excluded from CI and run manually only.

## Verification

- **ManifolderMCP**: `fabric_connect` (earth profile) → `list_scenes` → `create_scene` → `open_scene` → `create_object` → `update_object` → `delete_object` → `find_objects` → `bulk_update` → `delete_scene` → `fabric_disconnect`
- **Manifolder**: Open in browser → load MSF URL → hierarchy tree populates → search returns results → clicking nodes loads children → live updates render
- **Both**: `disconnect` tears down cleanly without errors or leaked listeners
- **Automated**: all shared + consumer compatibility tests pass in CI
