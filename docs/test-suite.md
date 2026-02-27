# Manifolder MCP Manual Test Suite

Manual, agent-runnable suite for scope-aware MCP behavior. This is intended to catch contract and usability gaps during exploratory runs.

This suite is not a replacement for automated integration tests. It is a comprehensive manual flow.

## Conventions

- Use a unique run suffix: `<RUN>` (example: `20260221a`).
- Prefer explicit scope targeting for CUD operations.
- For read/status operations, also test implicit fallback behavior where applicable.
- Record IDs from responses and reuse them in later steps.

Track these values as you run:

- `<ROOT_SCOPE_A>`
- `<SECTOR_SCENE_ID>`
- `<SECTOR_SCENE_URL>`
- `<PARCEL_ID>`
- `<ATTACHMENT_ID>`
- `<CHILD_SCENE_ID>`
- `<CHILD_SCENE_URL>`
- `<CHILD_SCOPE_ID>`
- `<CHILD_ROOT_ID>`
- `<HOUSE_ID>`

---

## 1. Preflight and Scope Target Semantics

| # | Action | Expected |
|---|--------|----------|
| 1.1 | `list_profiles` | Returns configured profiles including the one you will use (example: `default`). |
| 1.2 | `fabric_status(profile: "default")` | Auto-connects root scope and returns connected status with `scopeId`. Save as `<ROOT_SCOPE_A>`. |
| 1.3 | `list_scopes` | Includes `<ROOT_SCOPE_A>` with `parentScopeId: null`. |
| 1.4 | `fabric_status(scopeId: "<ROOT_SCOPE_A>")` | Returns same connected scope status. |
| 1.5 | `fabric_status(scopeId: "<ROOT_SCOPE_A>", profile: "default")` | Fails `SCOPE_TARGET_CONFLICT` (mutually exclusive target inputs). |
| 1.6 | `create_scene(name: "ts-should-fail-<RUN>")` | Fails `SCOPE_TARGET_MISSING` (CUD requires explicit target). |
| 1.7 | `list_scenes` | With exactly one connected root scope, succeeds via implicit fallback. |

Optional ambiguity check (only if you have a second profile):

| # | Action | Expected |
|---|--------|----------|
| 1.8 | `fabric_status(profile: "secondProfile")` | Opens second root scope. |
| 1.9 | `list_scenes` | Fails `SCOPE_TARGET_AMBIGUOUS` (multiple connected root scopes). |

---

## 2. Scene Lifecycle and `open_scene` Contract

`open_scene` output contract in this manual suite:

- Returns the same payload shape as `get_object` for the opened scene root.
- Includes `url` for that scene.
- Does not require child fan-out calls for summaries.

| # | Action | Expected |
|---|--------|----------|
| 2.1 | `create_scene(scopeId: "<ROOT_SCOPE_A>", name: "ts-sector-<RUN>", objectType: "terrestrial:sector")` | Returns scene with `scopeId`, `id`, `name`, `rootObjectId`, `url`. Save `id` as `<SECTOR_SCENE_ID>`, `url` as `<SECTOR_SCENE_URL>`. |
| 2.2 | `open_scene(scopeId: "<ROOT_SCOPE_A>", sceneId: "<SECTOR_SCENE_ID>")` | Returns root object payload (same shape as `get_object`) plus `url`. |
| 2.3 | `get_object(scopeId: "<ROOT_SCOPE_A>", objectId: "<SECTOR_SCENE_ID>")` | Returns same root object fields as 2.2 (except `url` if only on `open_scene`). |
| 2.4 | `list_scenes(scopeId: "<ROOT_SCOPE_A>")` | Includes `<SECTOR_SCENE_ID>` and matching `url`. |

---

## 3. Object CRUD, List, and Find

| # | Action | Expected |
|---|--------|----------|
| 3.1 | `create_object(scopeId: "<ROOT_SCOPE_A>", parentId: "<SECTOR_SCENE_ID>", name: "ts-parcel-<RUN>", objectType: "terrestrial:parcel")` | Returns object with `scopeId`, `nodeUid`, `parentId`, `parentNodeUid`. Save `id` as `<PARCEL_ID>`. |
| 3.2 | `get_object(scopeId: "<ROOT_SCOPE_A>", objectId: "<PARCEL_ID>")` | Returns full object details including `resourceReference`, `resourceName`, `childCount`, `children`. |
| 3.3 | `list_objects(scopeId: "<ROOT_SCOPE_A>", anchorObjectId: "<SECTOR_SCENE_ID>")` | Returns loaded subtree under anchor (not strict direct-children only). |
| 3.4 | `find_objects(scopeId: "<ROOT_SCOPE_A>", anchorObjectId: "<SECTOR_SCENE_ID>", query: { namePattern: "ts-parcel-" })` | Finds `<PARCEL_ID>`. |
| 3.5 | `update_object(scopeId: "<ROOT_SCOPE_A>", objectId: "<PARCEL_ID>", name: "ts-parcel-renamed-<RUN>")` | Update succeeds and returns updated object payload. |
| 3.6 | `move_object(scopeId: "<ROOT_SCOPE_A>", objectId: "<PARCEL_ID>", newParentId: "<SECTOR_SCENE_ID>")` | Fails — server rejects same-parent reparent. |

---

## 4. Attachment Traversal and Child Scope

| # | Action | Expected |
|---|--------|----------|
| 4.1 | `create_scene(scopeId: "<ROOT_SCOPE_A>", name: "ts-child-<RUN>", objectType: "physical")` | Returns child scene; save `id` as `<CHILD_SCENE_ID>`, `url` as `<CHILD_SCENE_URL>`. |
| 4.2 | `create_object(scopeId: "<ROOT_SCOPE_A>", parentId: "<PARCEL_ID>", name: "ts-attach-<RUN>", objectType: "physical", resourceReference: "<CHILD_SCENE_URL>")` | Creates attachment object. Save `id` as `<ATTACHMENT_ID>`. |
| 4.3 | `follow_attachment(scopeId: "<ROOT_SCOPE_A>", objectId: "<ATTACHMENT_ID>")` | Returns `parentScopeId`, `attachmentNodeUid`, `childScopeId`, `childFabricUrl`, `associatedProfile`, `reused`, and `root` (default `autoOpenRoot=true`). Save `childScopeId` as `<CHILD_SCOPE_ID>`, `root.id` as `<CHILD_ROOT_ID>`. |
| 4.4 | `list_scopes` | Includes child scope with `parentScopeId: "<ROOT_SCOPE_A>"` and `attachmentNodeUid`. |
| 4.5 | `create_object(scopeId: "<CHILD_SCOPE_ID>", parentId: "<CHILD_ROOT_ID>", name: "ts-house-<RUN>", objectType: "physical")` | Child-scope object creation succeeds. Save `id` as `<HOUSE_ID>`. |
| 4.6 | `get_object(scopeId: "<CHILD_SCOPE_ID>", objectId: "<HOUSE_ID>")` | Returns object payload with `nodeUid` rooted in `<CHILD_SCOPE_ID>`. |
| 4.7 | `follow_attachment(scopeId: "<ROOT_SCOPE_A>", objectId: "<PARCEL_ID>")` | Fails `ATTACHMENT_REFERENCE_INVALID` because parcel is not an attachment reference. |
| 4.8 | `follow_attachment(scopeId: "<ROOT_SCOPE_A>", objectId: "<ATTACHMENT_ID>", autoOpenRoot: false)` | Succeeds without `root` in response; confirms optional root-open behavior. |

---

## 5. `bulk_update` with `scopeBatches`

| # | Action | Expected |
|---|--------|----------|
| 5.1 | `bulk_update(scopeBatches: [{ scopeId: "<ROOT_SCOPE_A>", operations: [{ type: "update", params: { objectId: "<PARCEL_ID>", name: "ts-parcel-bulk-<RUN>" } }] }, { scopeId: "<CHILD_SCOPE_ID>", operations: [{ type: "update", params: { objectId: "<HOUSE_ID>", name: "ts-house-bulk-<RUN>" } }] }])` | Both batches succeed; response includes per-batch outcomes and summary totals. |
| 5.2 | `bulk_update(scopeBatches: [{ scopeId: "<ROOT_SCOPE_A>", operations: [{ type: "update", params: { objectId: "physical:999999999", name: "missing" } }] }, { scopeId: "<CHILD_SCOPE_ID>", operations: [{ type: "update", params: { objectId: "<HOUSE_ID>", name: "ts-house-mixed-<RUN>" } }] }])` | Mixed outcome returns `code: CROSS_SCOPE_PARTIAL_FAILURE`. |
| 5.3 | `bulk_update(scopeBatches: [{ scopeId: "<ROOT_SCOPE_A>", operations: [] }, { scopeId: "<ROOT_SCOPE_A>", operations: [] }])` | Fails `SCOPE_TARGET_CONFLICT` (duplicate scope in one request). |

---

## 6. Resource Tools (Profile-Only Targeting)

Create local files:

- `/tmp/ts-rotator-<RUN>.json` with valid rotator action JSON.
- `/tmp/ts-a-<RUN>.json` and `/tmp/ts-b-<RUN>.json` for bulk tests.

| # | Action | Expected |
|---|--------|----------|
| 6.1 | `get_action_resource_schema` | Returns supported action resource schemas. |
| 6.2 | `validate_action_resource(localPath: "/tmp/ts-rotator-<RUN>.json", type: "rotator")` | Validation passes. |
| 6.3 | `upload_resource(profile: "default", localPath: "/tmp/ts-rotator-<RUN>.json", targetName: "ts/rotator-<RUN>.json")` | Upload succeeds and returns `profile` + `url`. |
| 6.4 | `list_resources(profile: "default", path: "ts")` | Shows uploaded file with URL. |
| 6.5 | `upload_resource(profile: "default", scopeId: "<ROOT_SCOPE_A>", localPath: "/tmp/ts-rotator-<RUN>.json")` | Fails target conflict/validation (resource tools are profile-only). |
| 6.6 | `upload_resource(localPath: "/tmp/ts-rotator-<RUN>.json")` | Fails (missing required `profile`). |
| 6.7 | `upload_resource(profile: "nonexistent", localPath: "/tmp/ts-rotator-<RUN>.json")` | Fails `SCOPE_NOT_FOUND` / profile-not-found equivalent. |
| 6.8 | `download_resource(profile: "default", resourceName: "ts/rotator-<RUN>.json", localPath: "/tmp/ts-rotator-dl-<RUN>.json")` | Download succeeds. |
| 6.9 | `move_resource(profile: "default", sourceName: "ts/rotator-<RUN>.json", destName: "ts/rotator-renamed-<RUN>.json")` | Move succeeds. |
| 6.10 | `delete_resource(profile: "default", resourceName: "ts/rotator-renamed-<RUN>.json")` | Delete succeeds. |
| 6.11 | `bulk_upload_resources(profile: "default", files: [{ localPath: "/tmp/ts-a-<RUN>.json", targetName: "ts/bulk-a-<RUN>.json" }, { localPath: "/tmp/ts-b-<RUN>.json", targetName: "ts/bulk-b-<RUN>.json" }])` | Bulk upload succeeds. |
| 6.12 | `bulk_download_resources(profile: "default", downloads: [{ resourceName: "ts/bulk-a-<RUN>.json", localPath: "/tmp/ts-bulk-a-dl-<RUN>.json" }, { resourceName: "ts/bulk-b-<RUN>.json", localPath: "/tmp/ts-bulk-b-dl-<RUN>.json" }])` | Bulk download succeeds. |
| 6.13 | `bulk_move_resources(profile: "default", moves: [{ sourceName: "ts/bulk-a-<RUN>.json", destName: "ts/bulk-a-moved-<RUN>.json" }, { sourceName: "ts/bulk-b-<RUN>.json", destName: "ts/bulk-b-moved-<RUN>.json" }])` | Bulk move succeeds. |
| 6.14 | `bulk_delete_resources(profile: "default", resourceNames: ["ts/bulk-a-moved-<RUN>.json", "ts/bulk-b-moved-<RUN>.json"])` | Bulk delete succeeds. |

---

## 7. Scope Closing and Cleanup

| # | Action | Expected |
|---|--------|----------|
| 7.1 | `close_scope(scopeId: "<CHILD_SCOPE_ID>")` | Closes child scope; response includes `closedScopeIds`. |
| 7.2 | `list_scopes` | Child scope no longer listed. Root scope remains. |
| 7.3 | `delete_scene(scopeId: "<ROOT_SCOPE_A>", sceneId: "<CHILD_SCENE_ID>")` | Deletes child scene object in root scope. |
| 7.4 | `delete_scene(scopeId: "<ROOT_SCOPE_A>", sceneId: "<SECTOR_SCENE_ID>")` | Deletes sector scene and descendants created under it. |
| 7.5 | `list_scenes(scopeId: "<ROOT_SCOPE_A>")` | No `ts-*<RUN>` scenes remain. |
| 7.6 | `close_scope(scopeId: "<ROOT_SCOPE_A>")` | Root scope closed. |
| 7.7 | `list_scopes` | Empty or no scopes related to this run. |
| 7.8 | Remove local temp files | Delete `/tmp/ts-*-<RUN>.json` and `/tmp/ts-*-dl-<RUN>.json`. |

---

## 8. Optional High-Value Regression Checks

Run these when you want deeper validation of edge behavior:

| # | Action | Expected |
|---|--------|----------|
| 8.1 | Re-open same attachment twice via `follow_attachment` | Deterministic same `childScopeId`; `reused: true` on second call. |
| 8.2 | `close_scope(scopeId: "<ROOT_SCOPE_A>", cascade: true)` with descendants open | Returns child-first closure order in `closedScopeIds`. |
| 8.3 | `fabric_status` with no target and no connected roots | Fails implicit fallback (`SCOPE_TARGET_AMBIGUOUS` equivalent for zero roots). |
| 8.4 | `find_objects` with `positionRadius` and `resourceUrl` filters | Returns stable filtered results and scope-tagged object payloads. |

---

## Notes for Reviewers

- If any step fails due to mismatched tool schema or unclear error semantics, record:
  - tool name
  - input payload
  - actual result
  - expected result from this suite
- Treat that as a contract/usability bug, even if the backend operation itself eventually succeeds with retries.
