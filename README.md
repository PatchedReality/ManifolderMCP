# Fabric MCP Server

MCP server for editing Fabric spatial scenes from Claude Code and other MCP clients.

## Installation

```bash
npm install
npm run build
```

Requires Node.js >= 18.

## Configuration

Create `~/.config/fabric-mcp/config.json` with your fabric server settings:

```json
{
  "default": {
    "fabricUrl": "https://spatial.example.com/fabric/fabric.msf",
    "adminKey": "your-admin-token",
    "scpHost": "spatial.example.com",
    "scpUser": "deploy",
    "scpRemotePath": "~/MSF_Map_Svc/dist/web/objects/",
    "scpKeyPath": "~/.ssh/id_rsa",
    "resourceUrlPrefix": "/objects/"
  }
}
```

| Field | Description |
|-------|-------------|
| `fabricUrl` | URL to the fabric's MSF config file |
| `adminKey` | Authentication token for admin operations |
| `scpHost` | SSH hostname for resource uploads |
| `scpUser` | SSH username |
| `scpRemotePath` | Path on server where files are written (supports `~`) |
| `scpKeyPath` | Path to SSH private key (supports `~`) |
| `resourceUrlPrefix` | URL prefix for referencing uploads in scenes |

### How Resource URLs Work

When you upload a file like `Model.glb`, the MCP returns `resourceUrlPrefix + filename` as the resource reference. Fabric clients resolve URLs like this:

- **Relative URLs** (no `http://` or `https://`) resolve against the fabric host
- **Absolute URLs** are used as-is

Example with fabric at `https://spatial.example.com/fabric/fabric.msf`:

| resourceUrlPrefix | Uploaded file | Resource reference | Resolves to |
|-------------------|---------------|-------------------|-------------|
| `/objects/` | `Model.glb` | `/objects/Model.glb` | `https://spatial.example.com/objects/Model.glb` |
| `https://cdn.example.com/` | `Model.glb` | `https://cdn.example.com/Model.glb` | `https://cdn.example.com/Model.glb` |

**Recommended:** Use `/objects/` when resources are hosted on the same server as the fabric.

### Multiple Profiles

You can define multiple profiles for different environments:

```json
{
  "default": {
    "fabricUrl": "https://spatial.example.com/fabric/fabric.msf",
    "adminKey": "prod-token",
    "scpHost": "spatial.example.com",
    "scpUser": "deploy",
    "scpRemotePath": "~/MSF_Map_Svc/dist/web/objects/",
    "scpKeyPath": "~/.ssh/id_rsa",
    "resourceUrlPrefix": "/objects/"
  },
  "staging": {
    "fabricUrl": "https://staging.example.com/fabric/fabric.msf",
    "adminKey": "staging-token",
    "scpHost": "staging.example.com",
    "scpUser": "deploy",
    "scpRemotePath": "~/MSF_Map_Svc/dist/web/objects/",
    "scpKeyPath": "~/.ssh/id_rsa",
    "resourceUrlPrefix": "/objects/"
  }
}
```

Use `list_profiles` to see available profiles, then `fabric_connect` with the profile name:
- `fabric_connect profile:"default"` → uses "default"
- `fabric_connect profile:"staging"` → uses "staging"

## Claude Code Setup

1. Add the MCP server to Claude Code:

```bash
# Global (available in all projects)
claude mcp add -s user fabric node ~/fabric-mcp/dist/index.js

# Or project-only
claude mcp add fabric node ~/fabric-mcp/dist/index.js
```

2. Create the config file at `~/.config/fabric-mcp/config.json` (see Configuration above).

## Available Tools

### Connection
- `list_profiles` - List available connection profiles from config
- `fabric_connect` - Connect using a config profile (required parameter)
- `fabric_disconnect` - Disconnect from server
- `fabric_status` - Get connection state and current scene info

### Scenes
- `list_scenes` - List all scenes
- `open_scene` - Load a scene
- `create_scene` - Create new scene
- `delete_scene` - Delete scene and children

### Objects
- `list_objects` - List objects in a scene with optional filtering
- `get_object` - Get object details
- `create_object` - Create new object (supports GLB models and template resources)
- `update_object` - Update object properties (name, position, rotation, scale, resource)
- `delete_object` - Delete object and children (must be in cache)
- `delete_object_unknown_type` - Delete object when type is unknown (queries server)
- `move_object` - Reparent object

### Bulk Operations
- `bulk_update` - Execute multiple create/update/delete/move operations
- `find_objects` - Search by name pattern, position radius, or resource URL

### Resources
- `upload_resource` - Upload .glb, .png, .json, etc. to server
- `download_resource` - Download a resource file from the server
- `list_resources` - List available resources
- `delete_resource` - Remove a resource
- `move_resource` - Rename or move a resource on the server
- `bulk_upload_resources` - Upload multiple files in one operation
- `bulk_download_resources` - Download multiple files in one operation
- `bulk_delete_resources` - Delete multiple resources in one operation
- `bulk_move_resources` - Move/rename multiple resources in one operation

### Template Resources
- `get_template_resource_schema` - Get the JSON schema for template resources
- `validate_template_resource` - Validate a template resource file

Template resources are JSON files that define reusable content:
- `action://scene` - Reusable scene fragments (clusters of objects)
- `action://pointlight` - Point lights
- `action://showtext` - Text displays
- `action://rotator` - Rotating objects
- `action://video` - Video screens

## Usage Example

After connecting Claude Code to the MCP:

```
> List my fabric profiles
> Connect to the default profile
> List all scenes
> Open scene 42
> Create an object called "Cube" at position (0, 1, 0) with resource /objects/Cube.glb
> Move it to (5, 1, 0)
```

## License

Copyright Patched Reality, Inc. All rights reserved.

## Attributions

Uses MVMF libraries from Metaversal Corporation.
