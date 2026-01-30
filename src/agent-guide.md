# Fabric MCP Agent Guide

## Core Workflow

1. `fabric_connect` → establishes connection
   - **By profile**: `fabric_connect(profile: "earth")` — uses a pre-configured profile with credentials
   - **By URL**: `fabric_connect(url: "https://example.com/fabric/72/1")` — anonymous read-only connection to any fabric server
2. `list_scenes` → find available scenes
3. `open_scene` → load a scene to work with
4. Manipulate objects: `create_object`, `update_object`, `delete_object`, `move_object`

## Action Resources

Action resources are JSON files that define functional content (lights, text, rotators, video) that can be attached to objects in scenes.

### Workflow

1. **Get the schema**: `get_action_resource_schema` → understand the JSON structure
2. **Create JSON file** locally with the action definition
3. **Validate**: `validate_action_resource(localPath: "...", type: "pointlight")` → catches errors before upload
4. **Upload**: `upload_resource(localPath: "...")` → pushes to server
5. **Instantiate**: `create_object` with `resource: "action://pointlight"` and `resourceName: "/objects/my-light.json"`

### Action Types

- `pointlight` - Light sources (`action://pointlight`)
- `showtext` - Text displays (`action://showtext`, supports `text` and `align` properties only, no color)
- `rotator` - Rotating objects (`action://rotator`)
- `video` - Video players (`action://video`)

### Rotators (The Pivot Pattern)

Rotators work by rotating their **parent container**. To make objects rotate, use the "pivot pattern":

1. Create a **pivot container** - an object with just `resourceName` (no `resourceReference`)
2. Place visual elements as **children** of the pivot
3. Place the **rotator** as a **sibling** of the visual elements (also a child of the pivot)
4. The rotator rotates the pivot, which rotates all its children together

**Rotator JSON structure:**
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

**Example: Rotating label above a tree:**
```json
{
  "blueprintType": "physical",
  "resourceReference": "/objects/Tree.glb",
  "pos": [0, 0, 0]
},
{
  "blueprintType": "physical",
  "resourceName": "label-pivot",
  "pos": [0, 15, 0],
  "objectBounds": [3, 3, 3],
  "maxBounds": [3, 3, 3],
  "children": [
    {
      "blueprintType": "physical",
      "resourceReference": "action://showtext",
      "resourceName": "/objects/my-label.json",
      "pos": [0, 0, 0],
      "scale": [1.5, 1.5, 1.5]
    },
    {
      "blueprintType": "physical",
      "resourceReference": "action://rotator",
      "resourceName": "/objects/my-rotator.json",
      "objectBounds": [1, 1, 1],
      "maxBounds": [1, 1, 1]
    }
  ]
}
```

The pivot container (`label-pivot`) has no `resourceReference`, only a `resourceName`. The showtext and rotator are siblings inside the pivot. The rotator spins the pivot, which spins the label.

## Resource Management

Resources can be: 3D models (.glb), images (.png, .jpg), or action resource JSON files.

### Single Operations
- `upload_resource` - Upload a file (creates directories automatically if targetName includes a path)
- `download_resource` - Download a file (creates local directories automatically)
- `list_resources` - List available resources
- `delete_resource` - Remove a resource
- `move_resource` - Move/rename a resource (creates destination directories automatically)

### Bulk Operations
- `bulk_upload_resources` - Upload multiple files in one connection
- `bulk_download_resources` - Download multiple files in one connection
- `bulk_delete_resources` - Delete multiple resources in one connection
- `bulk_move_resources` - Move/rename multiple resources in one connection

### list_resources Options

**path**: Subdirectory to list (e.g., `Forest/Trees`). Defaults to root.

**recursive**: Set to `true` to scan all subdirectories.

**filter**: Glob pattern with `*` as wildcard (case-insensitive):
- `*.glb` - files ending in .glb
- `*.json` - files ending in .json
- `tree*` - files starting with "tree"
- `*forest*` - files containing "forest"

**Examples:**
- `list_resources()` - list root directory
- `list_resources(path: "Forest/Trees")` - list specific subdirectory
- `list_resources(recursive: true, filter: "*.glb")` - find all .glb files recursively

## Resource URLs

- Relative URLs (`/objects/Model.glb`) resolve against the fabric host
- Absolute URLs (`https://cdn.example.com/Model.glb`) used as-is
- For action resources, use `resource: "action://pointlight"` (or other action type) with `resourceName: "/objects/my-action.json"`

### Creating Objects

**Regular .glb model:**
```
create_object(parentId: "123", name: "Cube", resource: "/objects/Cube.glb")
```

**Action resource (pointlight):**
```
create_object(parentId: "123", name: "Light", resource: "action://pointlight", resourceName: "/objects/my-light.json")
```

## Object Deletion

- `delete_object` - Use when object is in cache (was fetched via `get_object` or `list_objects`)
- `delete_object_unknown_type` - Use when object type is unknown (queries server to find type)

## Bulk Operations

`bulk_update` executes multiple operations atomically:
- Operations: `create`, `update`, `delete`, `move`
- Useful for complex scene modifications that should succeed or fail together
