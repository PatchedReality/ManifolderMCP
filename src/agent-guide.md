# Fabric MCP Agent Guide

## Object Identity

All object IDs use the format `"class:id"`:
- `"root"` — special-case shorthand for the server root object (not literally `class:id` format)
- `"celestial:1"` — celestial object 1
- `"terrestrial:3"` — terrestrial object 3
- `"physical:42"` — physical object 42

This format is used everywhere: `parentId`, `objectId`, `newParentId`, `scopeId`, and in all responses.

## Object Types

When creating objects, `objectType` specifies the class and subtype using `"class:subtype"` format:

| objectType | Description |
|---|---|
| `terrestrial:sector` | Sector |
| `terrestrial:parcel` | Parcel |
| `celestial:universe` | Universe |
| `celestial:planet` | Planet |
| `physical` | Default physical (models, containers, lights) |
| `physical:transport` | Transport |

When `objectType` is omitted, defaults to `physical`.

These are the most common types. The full enum includes additional celestial subtypes (e.g., `celestial:galaxy`, `celestial:star_system`) and terrestrial subtypes (e.g., `terrestrial:county`, `terrestrial:city`). See the `objectType` parameter on `create_object` for the complete list.

### Valid Parent/Child Combinations

Not all object types can be nested freely. The parent's class determines which child classes it can contain:

| Parent | Can create children |
|---|---|
| root | celestial, terrestrial, physical |
| celestial:surface | terrestrial |
| celestial (other) | celestial |
| terrestrial:parcel | terrestrial, physical |
| terrestrial (other) | terrestrial |
| physical | physical |

**Attachment points:** `celestial:surface` and `terrestrial:parcel` are special attachment point types that bridge between tiers. Surfaces are the only celestial type that can have terrestrial children (and cannot be children of other surfaces). Parcels are the only terrestrial type that can have physical children (and cannot be children of other parcels).

## Core Workflow

1. **Connect** to a Fabric server (one of):
   - **Scene tools auto-connect**: `list_scenes(profile: "earth")` — connects and lists in one call. All scene tools (`list_scenes`, `open_scene`, `create_scene`, `delete_scene`) accept optional `profile` or `url` params to auto-connect if not already connected.
   - **Explicit connect**: `fabric_connect(profile: "earth")` — uses a pre-configured profile with credentials
   - **By URL**: `fabric_connect(url: "https://example.com/fabric/72/1")` — anonymous read-only connection
   - Use `list_profiles` if you don't know which profiles are available
   - Auto-connect via `profile` or `url` establishes a persistent connection — subsequent tool calls don't need to repeat the profile. Only one connection at a time; passing a different profile switches the connection.
2. **List scenes**: `list_scenes` → returns all scenes on the server
3. **Open a scene**: `open_scene(sceneId: "physical:1")` → loads the scene tree and returns `{ sceneId, root: {id, name, childCount}, children }`
4. **Work with objects**: create, update, delete, move, search
5. **Check status**: `fabric_status` → current connection state and scene info
6. **Disconnect**: `fabric_disconnect` → close connection when done

## Object Manipulation

### Creating Objects

**3D model:**
```
create_object(parentId: "terrestrial:3", name: "Tree", resource: "/objects/Tree.glb")
```

**Empty container** (no `resource`, used for grouping/pivots):
```
create_object(parentId: "terrestrial:3", name: "Group", position: {x:0, y:5, z:0})
```

**Action resource** (lights, text, rotators, video):
```
create_object(parentId: "physical:123", name: "Light", resource: "action://pointlight", resourceName: "/objects/my-light.json")
```

**Terrestrial sector** (under root):
```
create_object(parentId: "root", name: "My Sector", objectType: "terrestrial:sector")
```

**Parcel under a sector:**
```
create_object(parentId: "terrestrial:3", name: "My Parcel", objectType: "terrestrial:parcel")
```

### Updating Objects

```
update_object(objectId: "physical:42", position: {x:10, y:0, z:5})
update_object(objectId: "physical:42", name: "New Name", scale: {x:2, y:2, z:2})
update_object(objectId: "terrestrial:3", resource: "/objects/NewModel.glb")
```

You can update `name`, `position`, `rotation`, `scale`, `resource`, `resourceName`, and `bound` — any combination in one call. `objectType` is set at creation time only.

### Deleting Objects

```
delete_object(objectId: "physical:42")
delete_object(objectId: "terrestrial:3")
```

The object class is derived from the prefixed ID — no need to load the object first.

### Moving Objects

```
move_object(objectId: "physical:42", newParentId: "terrestrial:5")
```

Reparents the object under a new parent.

### Inspecting Objects

- `get_object(objectId: "physical:42")` — returns full details: id, name, parentId, position, resource, children
- `list_objects(scopeId: "physical:1")` — shallow list of loaded objects under the scoped object. Supports optional `filter` with `namePattern` (regex) and `type`. `scopeId` is typically a scene root from `list_scenes`, but can be any object.
- `childCount: -1` means the object's children haven't been loaded from the server yet. Call `get_object` on it to load its children. After that, its children will appear in `list_objects`.

### Searching Objects

`find_objects` searches by name, position, or resource URL. `scopeId` is typically a scene root, but can be any object:

```
find_objects(scopeId: "physical:1", query: { namePattern: "Tree" })
find_objects(scopeId: "terrestrial:3", query: { positionRadius: { center: {x:0, y:0, z:0}, radius: 50 } })
find_objects(scopeId: "physical:1", query: { resourceUrl: "Forest.glb" })
```

**How `namePattern` works:** On celestial and terrestrial scopes, `namePattern` is sent to the server as a begins-with prefix match (case-insensitive, efficient). On physical scopes, server-side SEARCH is not available — `namePattern` falls back to loading the full subtree under the scoped object and applying a client-side regex filter. Non-text queries (`positionRadius`, `resourceUrl`) always use client-side filtering on the loaded subtree.

## Scenes

A scene is a top-level object directly under `"root"`. `list_scenes` returns all direct children of root. `create_scene` creates an object under root (physical by default, or specify `objectType`). The scene ID is the same as its root object's ID — you can manipulate the scene root with object tools like `update_object`.

- `list_scenes` — list all scenes (paginated). Accepts optional `profile` or `url` to auto-connect. Always show the `url` field when displaying results. The `url` field is the browser-viewable URL for the scene on the Fabric server.
- `open_scene(sceneId: "physical:1")` — load a scene and its direct children; returns root info and child summaries. After this call, `list_objects` will show the full first level immediately. Accepts optional `profile` or `url` to auto-connect.
- `create_scene(name: "My Scene")` — create a new empty scene. Accepts optional `profile` or `url` to auto-connect.
- `delete_scene(sceneId: "physical:1")` — delete a scene and all its children. Accepts optional `profile` or `url` to auto-connect.

## Resource Management

Resources are files on the server: 3D models (.glb), images (.png, .jpg), or action resource JSON files.

### Resource URLs

- Relative URLs (`/objects/Model.glb`) resolve against the fabric host
- Absolute URLs (`https://cdn.example.com/Model.glb`) used as-is
- Action URIs (`action://pointlight`) reference built-in action types

### Operations

| Tool | Purpose |
|------|---------|
| `upload_resource` | Upload a local file to the server |
| `download_resource` | Download a server file locally |
| `list_resources` | List files on the server |
| `delete_resource` | Remove a file from the server |
| `move_resource` | Move or rename a file on the server |

All operations that create files or directories handle directory creation automatically.

### Listing Resources

`list_resources` supports three optional parameters:

- **path**: Subdirectory to list (e.g., `"Forest/Trees"`). Defaults to root.
- **recursive**: Set `true` to scan all subdirectories.
- **filter**: Glob pattern with `*` wildcard (case-insensitive): `"*.glb"`, `"tree*"`, `"*forest*"`

Examples:
```
list_resources()                                        // root directory
list_resources(path: "Forest/Trees")                    // specific subdirectory
list_resources(recursive: true, filter: "*.glb")        // all .glb files everywhere
```

## Action Resources

Action resources are JSON files that define functional content — lights, text, rotators, video — attached to objects in scenes.

### Types

| Type | Action URI | Purpose |
|------|-----------|---------|
| `pointlight` | `action://pointlight` | Light sources |
| `showtext` | `action://showtext` | Text displays (supports `text` and `align` properties) |
| `rotator` | `action://rotator` | Rotating objects |
| `video` | `action://video` | Video players |

### Workflow

1. **Get the schema**: `get_action_resource_schema` returns the full schema with all field details.
2. **Create a JSON file** locally with the action definition
3. **Validate**: `validate_action_resource(localPath: "...", type: "pointlight")`
4. **Upload**: `upload_resource(localPath: "...")`
5. **Attach to an object**: `create_object` with `resource: "action://pointlight"` and `resourceName: "/objects/my-light.json"`

### JSON Structure

All action resources share this format:
```json
{
  "header": { "type": "DATA" },
  "body": { ... type-specific fields ... }
}
```

**Rotator body example:**
```json
{
  "header": { "type": "DATA" },
  "body": {
    "parent": 0,
    "rotSpeed": 20,
    "axis": [0, 1, 0]
  }
}
```

### The Pivot Pattern (Rotators)

Rotators rotate their **parent container**. To make objects spin, use the pivot pattern:

1. Create an **empty pivot container** (no `resource`)
2. Place visual elements as **children** of the pivot
3. Place the **rotator** as a **sibling** of the visual elements (also a child of the pivot)
4. The rotator spins the pivot, which spins all its children together

**Example: Rotating label above a tree (MCP tool calls):**
```
// 1. Tree at scene root
create_object(parentId: "terrestrial:3", name: "Tree", resource: "/objects/Tree.glb")
// returns { id: "physical:100" }

// 2. Empty pivot container above the tree
create_object(parentId: "terrestrial:3", name: "label-pivot", position: {x:0, y:15, z:0}, bound: {x:3, y:3, z:3})
// returns { id: "physical:101" }

// 3. Text label as child of pivot
create_object(parentId: "physical:101", name: "Label", resource: "action://showtext", resourceName: "/objects/my-label.json", scale: {x:1.5, y:1.5, z:1.5})

// 4. Rotator as sibling of label (also child of pivot)
create_object(parentId: "physical:101", name: "Rotator", resource: "action://rotator", resourceName: "/objects/my-rotator.json", bound: {x:1, y:1, z:1})
```

The pivot has no `resource` — it's just a container. The showtext and rotator are siblings inside the pivot. The rotator spins the pivot, which spins the label.

### Parameter Clarifications

**`bound`**: Sets the bounding box size of an object. Use it for:
- Empty containers (pivots) to define their spatial extent
- Action resources (rotators, text) that have no inherent geometry
- Defaults to `{x:1, y:1, z:1}` if omitted

**`resourceName`**: Its meaning depends on context:
- **With an action `resource`** (e.g., `resource: "action://pointlight"`): path to the action's JSON config file on the server (e.g., `"/objects/my-light.json"`)
- If `resource` is omitted, `resourceName` is ignored and the object is an empty container

## Bulk Operations

### Bulk Object Operations

`bulk_update` executes multiple object operations in a single batch. Operations execute sequentially; failures are collected but don't stop subsequent operations. Operations cannot reference IDs created by earlier operations in the same batch.

```
bulk_update(operations: [
  { type: "create", params: { parentId: "terrestrial:3", name: "Obj1", resource: "/objects/Model.glb" } },
  { type: "update", params: { objectId: "physical:42", position: {x:10, y:0, z:0} } },
  { type: "delete", params: { objectId: "physical:99" } },
  { type: "move",   params: { objectId: "physical:50", newParentId: "terrestrial:3" } }
])
```

Returns `createdIds` for any created objects (prefixed, e.g., `"physical:200"`). On partial failure, continues executing and reports errors in the `errors` array — check `failed > 0`.

### Bulk Resource Operations

For efficiency when working with multiple files, use the bulk variants:

- `bulk_upload_resources(files: [...])` — upload multiple files in one connection
- `bulk_download_resources(downloads: [...])` — download multiple files in one connection
- `bulk_delete_resources(resourceNames: [...])` — delete multiple files in one connection
- `bulk_move_resources(moves: [...])` — move/rename multiple files in one connection

Bulk resource operations report failures in a `failedItems` array.

## Pagination and Data Volume

Tools that return lists (`list_scenes`, `list_objects`, `find_objects`, `list_resources`) support pagination with optional `offset` and `limit` parameters:

```
list_scenes(offset: 0, limit: 20)                      // first 20 scenes
list_scenes(offset: 20, limit: 20)                      // next 20 scenes
list_objects(scopeId: "physical:1", limit: 50)           // first 50 objects
```

Default page size is 10. Use `total` to determine if more pages exist.

### Managing Response Size

Fabric scenes and resource libraries can be large — hundreds of objects per scene and hundreds of resource files on the server. Pulling full, unfiltered datasets wastes tokens and context. Follow these principles:

**Prefer filtered queries over full listings:**
- `list_resources(path: "Forest/Trees", filter: "Oak*")` instead of `list_resources(recursive: true)`
- `find_objects(query: { namePattern: "Birch" })` instead of `find_objects(scopeId: ..., query: {})` — an empty or overly broad query loads the full subtree
- `list_objects(filter: { namePattern: "Tree" })` instead of `list_objects(limit: 1000)`

**Use small page sizes when exploring:**
- Start with the default limit (10) to understand the data shape before requesting more
- Use `total` from the first response to decide whether a larger page is needed
- Only increase `limit` when you know you need the full dataset (e.g., bulk updates)

**Heaviest responses by tool:**
- `list_resources(recursive: true)` — returns every file on the server, each with name and URL
- `find_objects` — returns position and resource URL per object; scales with scene size
- `list_objects` — returns parent/child structure per object; scales with scene size
- `open_scene` — loads and returns the full first-level children of a scene

**Lightweight alternatives:**
- Use `get_object` to inspect a single object instead of listing all
- Use `list_resources(path: "...")` to scope to a subdirectory
- Use `find_objects` with `namePattern` for server-side filtering (begins-with matching) rather than loading everything client-side

## Response Formats

Key response shapes by tool:

- `create_object` → `{ id, name, parentId }`
- `get_object` → `{ id, name, parentId, position, rotation, scale, resource, resourceName, childCount, children }`
- `list_objects` items → `{ id, name, parentId, childCount, hasResource }`
- `find_objects` items → `{ id, name, position, resource }`
- `open_scene` → `{ sceneId, root: { id, name, childCount }, children: [{ id, name, hasResource }] }`
- `list_scenes` items → `{ id, name, url }`
- All paginated tools → `{ total, offset, limit, items }`

## Error Handling

- If a tool call fails, `isError` is `true` and the text starts with `"Error: "`
- Common errors:
  - `"Not connected"` — pass a `profile` or `url` param (scene tools auto-connect), or call `fabric_connect` first
  - `"Invalid object reference"` — ensure IDs use the `"class:id"` format (e.g., `"physical:42"`, not `"42"`)
  - `"Unknown class prefix"` — valid prefixes are `root`, `celestial`, `terrestrial`, `physical`
- `bulk_update` continues on individual failures and reports them in the `errors` array
- Bulk resource operations report failures in `failedItems`
