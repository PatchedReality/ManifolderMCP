# Manifolder MCP

An [MCP server](https://modelcontextprotocol.io/) that lets Claude Code (and other MCP clients) directly edit spatial [Fabric](https://omb.wiki/en/spatial-fabric/architecture) scenes. Wraps the MVMF protocol libraries with a thin MCP tool layer.

## Setup

### Prerequisites

- Node.js >= 18
- Access to a Fabric server

### Install

```bash
npm install
npm run build
```

### Configure

Create `~/.config/manifolder-mcp/config.json`:

```json
{
  "default": {
    "fabricUrl": "https://example.com/fabric/fabric.msf",
    "adminKey": "your-admin-token"
  }
}
```

Optional fields for resource upload/download via SCP:

| Field | Description |
|-------|-------------|
| `scpHost` | SSH hostname for resource uploads |
| `scpUser` | SSH username |
| `scpRemotePath` | Server path where files are written (supports `~`) |
| `scpKeyPath` | Path to SSH private key (supports `~`) |
| `resourceUrlPrefix` | URL prefix for referencing uploads in scenes (e.g., `/objects/`) |

Multiple profiles can be defined (e.g., `"default"`, `"staging"`) and selected per-call via the `profile` parameter on any tool.

### Add to MCP Client

Build first (`npm run build`), then register using an absolute path to `dist/index.js`.

**Claude Code:**
```bash
claude mcp add --scope user manifolder -- node /absolute/path/to/ManifolderMCP/dist/index.js
```

**Codex:**
```bash
codex mcp add manifolder -- node /absolute/path/to/ManifolderMCP/dist/index.js
```

**Gemini CLI:**
```bash
gemini mcp add -s user manifolder node /absolute/path/to/ManifolderMCP/dist/index.js
```

**Manual config** (Claude Code `settings.json`, Gemini `settings.json`, etc.):
```json
{
  "mcpServers": {
    "manifolder": {
      "command": "node",
      "args": ["/absolute/path/to/ManifolderMCP/dist/index.js"]
    }
  }
}
```

## Tools

Every tool that touches a scope accepts one of `scopeId`, `profile`, or `url` to identify the target. Passing `profile` or `url` auto-connects if needed.

### Connection & Scopes

| Tool | Purpose |
|------|---------|
| `list_profiles` | List connection profiles from config |
| `fabric_status` | Get scope connection state and info |
| `list_scopes` | List active scopes and relationships |
| `follow_attachment` | Open a child scope from an attachment object |
| `close_scope` | Close a scope and optionally its descendants |

### Scenes

| Tool | Purpose |
|------|---------|
| `list_scenes` | List scenes (paginated) |
| `open_scene` | Load a scene and return root object details |
| `create_scene` | Create a new scene |
| `delete_scene` | Delete a scene and all children |

### Objects

| Tool | Purpose |
|------|---------|
| `get_object` | Get full object details |
| `list_objects` | List loaded objects under an anchor (shallow, paginated) |
| `find_objects` | Search by name, position radius, or resource URL (paginated) |
| `create_object` | Create object (3D model, container, or action resource) |
| `update_object` | Update name, transform, resource, bound, orbit, properties |
| `delete_object` | Delete object and children |
| `move_object` | Reparent object |
| `bulk_update` | Batch create/update/delete/move across scopes |

### Resources

| Tool | Purpose |
|------|---------|
| `upload_resource` | Upload a file (.glb, .png, .json, etc.) |
| `download_resource` | Download a file from the server |
| `list_resources` | List server files (supports path, recursive, glob filter) |
| `delete_resource` | Remove a file |
| `move_resource` | Move or rename a file |
| `bulk_upload_resources` | Upload multiple files |
| `bulk_download_resources` | Download multiple files |
| `bulk_delete_resources` | Delete multiple files |
| `bulk_move_resources` | Move/rename multiple files |

### Action Resources

| Tool | Purpose |
|------|---------|
| `get_action_resource_schema` | Get JSON schema for action resource types |
| `validate_action_resource` | Validate an action resource file |

Action types: `action://pointlight`, `action://showtext`, `action://rotator`, `action://video`.

## Usage Example

```
> List my fabric profiles
> List scenes using profile "default"
> Open scene Playground  
> Create an object named "Tree" under the Nature node
> Move it 5 meters north
```

## Development

```bash
npm run dev                      # TypeScript watch mode
npm test                         # Unit tests
npm run test:integration         # Integration tests (requires running server)
npm run test:record-fixtures     # Record test fixtures from live server
npm run sync:manifolder-client   # Sync ManifolderClient from ../Manifolder/
```

### Project Structure

```
src/
  index.ts              # MCP server entry point
  config.ts             # Connection profile loader
  output.ts             # Pagination helpers
  agent-guide.md        # Tool docs served to MCP clients
  client/               # ManifolderClient (synced from ../Manifolder/)
  tools/                # MCP tool implementations
  storage/              # SCP-based file storage
  vendor/               # MVMF protocol libraries (Node.js shimmed)
```

The `ManifolderClient` is shared with the sibling [Manifolder](https://github.com/PatchedReality/Manifolder) project. Edit there, then `npm run sync:manifolder-client` to pull changes here.

## License

Copyright Patched Reality, Inc. All rights reserved.

Uses MVMF libraries from Metaversal Corporation.
