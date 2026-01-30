# Fabric MCP Agent Guide

## Core Workflow

1. **Connect** to a Fabric server
   - **By profile**: `fabric_connect(profile: "earth")` — uses a pre-configured profile with credentials
   - **By URL**: `fabric_connect(url: "https://example.com/fabric/72/1")` — anonymous read-only connection
   - Use `list_profiles` if you don't know which profiles are available
2. **List scenes**: `list_scenes` → returns all scenes on the server
3. **Open a scene**: `open_scene(sceneId: "...")` → loads the scene tree and returns `{ sceneId, root: {id, name, childCount}, children }`
4. **Work with objects**: create, update, delete, move, search
5. **Check status**: `fabric_status` → current connection state and scene info
6. **Disconnect**: `fabric_disconnect` → close connection when done

## Object Manipulation

### Creating Objects

**3D model:**
```
create_object(parentId: "123", name: "Tree", resource: "/objects/Tree.glb")
```

**Empty container** (no `resource`, used for grouping/pivots):
```
create_object(parentId: "123", name: "Group", position: {x:0, y:5, z:0})
```

**Action resource** (lights, text, rotators, video):
```
create_object(parentId: "123", name: "Light", resource: "action://pointlight", resourceName: "/objects/my-light.json")
```

### Updating Objects

```
update_object(objectId: "456", position: {x:10, y:0, z:5})
update_object(objectId: "456", name: "New Name", scale: {x:2, y:2, z:2})
update_object(objectId: "456", resource: "/objects/NewModel.glb")
```

You can update `name`, `position`, `rotation`, `scale`, and `resource` — any combination in one call.

### Deleting Objects

- `delete_object(objectId: "456")` — use when the object is in cache (loaded via `get_object` or `list_objects`)
- `delete_object_unknown_type(objectId: "456")` — use when the object hasn't been loaded; queries the server to find its type

### Moving Objects

```
move_object(objectId: "456", newParentId: "789")
```

Reparents the object under a new parent.

### Inspecting Objects

- `get_object(objectId: "456")` — returns full details: id, name, parentId, position, resource, children
- `list_objects(sceneId: "...")` — shallow list of loaded objects in a scene. Supports optional `filter` with `namePattern` (regex) and `type`

### Searching Objects

`find_objects` searches by name, position, or resource URL:

```
find_objects(sceneId: "...", query: { namePattern: "Tree" })
find_objects(sceneId: "...", query: { positionRadius: { center: {x:0, y:0, z:0}, radius: 50 } })
find_objects(sceneId: "...", query: { resourceUrl: "Forest.glb" })
```

Name queries use server-side begins-with matching. Position and resource queries load the full scene tree.

## Scenes

- `list_scenes` — list all scenes (paginated)
- `open_scene(sceneId: "...")` — load a scene and its direct children; returns root info and child summaries. After this call, `list_objects` will show the full first level immediately.
- `create_scene(name: "My Scene")` — create a new empty scene
- `delete_scene(sceneId: "...")` — delete a scene and all its children

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
create_object(parentId: "<sceneId>", name: "Tree", resource: "/objects/Tree.glb")
// returns { id: "100" }

// 2. Empty pivot container above the tree
create_object(parentId: "<sceneId>", name: "label-pivot", position: {x:0, y:15, z:0}, bound: {x:3, y:3, z:3})
// returns { id: "101" }

// 3. Text label as child of pivot
create_object(parentId: "101", name: "Label", resource: "action://showtext", resourceName: "/objects/my-label.json", scale: {x:1.5, y:1.5, z:1.5})

// 4. Rotator as sibling of label (also child of pivot)
create_object(parentId: "101", name: "Rotator", resource: "action://rotator", resourceName: "/objects/my-rotator.json", bound: {x:1, y:1, z:1})
```

The pivot has no `resource` — it's just a container. The showtext and rotator are siblings inside the pivot. The rotator spins the pivot, which spins the label.

### Parameter Clarifications

**`bound`**: Sets the bounding box size of an object. Use it for:
- Empty containers (pivots) to define their spatial extent
- Action resources (rotators, text) that have no inherent geometry
- Defaults to `{x:1, y:1, z:1}` if omitted

**`resourceName`**: Its meaning depends on context:
- **With an action `resource`** (e.g., `resource: "action://pointlight"`): path to the action's JSON config file on the server (e.g., `"/objects/my-light.json"`)
- **Without a `resource`**: the object is an empty container; `name` is just a label

## Bulk Operations

### Bulk Object Operations

`bulk_update` executes multiple object operations atomically:

```
bulk_update(operations: [
  { type: "create", params: { parentId: "123", name: "Obj1", resource: "/objects/Model.glb" } },
  { type: "update", params: { objectId: "456", position: {x:10, y:0, z:0} } },
  { type: "delete", params: { objectId: "789" } },
  { type: "move",   params: { objectId: "101", newParentId: "123" } }
])
```

Returns `createdIds` for any created objects. On partial failure, continues executing and reports errors in the `errors` array — check `failed > 0`.

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
list_scenes(offset: 0, limit: 20)        // first 20 scenes
list_scenes(offset: 20, limit: 20)       // next 20 scenes
list_objects(sceneId: "...", limit: 50)   // first 50 objects
```

Response format: `{ total, offset, limit, items }`. Default page size is 10. Use `total` to determine if more pages exist.

### Managing Response Size

Fabric scenes and resource libraries can be large — hundreds of objects per scene and hundreds of resource files on the server. Pulling full, unfiltered datasets wastes tokens and context. Follow these principles:

**Prefer filtered queries over full listings:**
- `list_resources(path: "Forest/Trees", filter: "Oak*")` instead of `list_resources(recursive: true)`
- `find_objects(query: { namePattern: "Birch" })` instead of `find_objects(query: { namePattern: ".*" })`
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

## Error Handling

- If a tool call fails, `isError` is `true` and the text starts with `"Error: "`
- Common errors:
  - `"Not connected"` — call `fabric_connect` first
  - `"Object not in cache"` — use `get_object` to load it, or use `delete_object_unknown_type`
- `bulk_update` continues on individual failures and reports them in the `errors` array
- Bulk resource operations report failures in `failedItems`
