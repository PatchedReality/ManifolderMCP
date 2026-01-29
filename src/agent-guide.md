# Fabric MCP Agent Guide

## Core Workflow

1. `fabric_connect` (with profile name) → establishes connection
2. `list_scenes` → find available scenes
3. `open_scene` → load a scene to work with
4. Manipulate objects: `create_object`, `update_object`, `delete_object`, `move_object`

## Template Resources (Reusable Scene Fragments)

Template resources define reusable arrangements of objects (e.g., a cluster of trees, a furniture set).

### Workflow

1. **Get the schema**: `get_template_resource_schema` → understand the JSON structure
2. **Create JSON file** locally with the template definition
3. **Validate**: `validate_template_resource(filePath, type)` → catches errors before upload
4. **Upload**: `upload_resource(filePath)` → pushes to server
5. **Instantiate**: `create_object` with `resource: "action://scene"` and `resourceName: "/objects/myTemplate.json"`

### Template Types

- `scene` - Reusable object arrangements (most common)
- `pointlight` - Light sources
- `showtext` - Text displays (supports `text` and `align` properties only, no color)
- `rotator` - Rotating objects
- `video` - Video players

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

### Example: Tree Cluster Template

```json
{
  "header": { "type": "DATA" },
  "body": {
    "blueprint": {
      "blueprintType": "physical",
      "pos": [0, 0, 0],
      "objectBounds": [10, 10, 10],
      "maxBounds": [10, 10, 10],
      "children": [
        {
          "blueprintType": "physical",
          "resourceReference": "/objects/pine.glb",
          "pos": [0, 0, 0]
        },
        {
          "blueprintType": "physical",
          "resourceReference": "/objects/pine.glb",
          "pos": [2.5, 0, 1.2],
          "scale": [0.8, 0.9, 0.8]
        }
      ]
    }
  }
}
```

## Resource Management

Resources can be: 3D models (.glb), images (.png, .jpg), or template resource JSON files.

- `upload_resource` - Upload a file (creates directories automatically if targetName includes a path)
- `list_resources` - List available resources (supports filter patterns like `*.glb`)
- `delete_resource` - Remove a resource
- `move_resource` - Move/rename a resource (creates destination directories automatically)

## Resource URLs

- Relative URLs (`/objects/Model.glb`) resolve against the fabric host
- Absolute URLs (`https://cdn.example.com/Model.glb`) used as-is
- For template resources, use `resource: "action://scene"` with `resourceName: "/objects/template.json"`

### Creating Objects

**Regular .glb model:**
```
create_object(parentId: "123", name: "Cube", resource: "/objects/Cube.glb")
```

**Template resource (scene):**
```
create_object(parentId: "123", name: "Forest", resource: "action://scene", resourceName: "/objects/forest.json")
```

## Object Deletion

- `delete_object` - Use when object is in cache (was fetched via `get_object` or `list_objects`)
- `delete_object_unknown_type` - Use when object type is unknown (queries server to find type)

## Bulk Operations

`bulk_update` executes multiple operations atomically:
- Operations: `create`, `update`, `delete`, `move`
- Useful for complex scene modifications that should succeed or fail together
