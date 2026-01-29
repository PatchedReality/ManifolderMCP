# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Fabric MCP Server - an MCP server enabling Claude Code (and other MCP clients) to directly edit spatial Fabric scenes. Wraps MVMF libraries with a thin MCP layer, following the `MVClient` pattern from the SceneAssembler sibling project.

## Commands

```bash
# Install dependencies
npm install

# Build TypeScript
npm run build

# Run the MCP server
node dist/index.js

# Run in development mode (if configured)
npm run dev
```

## Architecture

### Core Components

- **MVFabricClient** (`src/client/MVFabricClient.ts`): Fabric client using MVMF libraries with Node.js shims
- **Config** (`src/config.ts`): Loads `~/.config/fabric-mcp/config.json` for connection profiles and storage backends
- **Tools** (`src/tools/`): MCP tool implementations for connection, scenes, objects, bulk operations, and resources

### Vendor Libraries

MVMF libraries copied from SceneAssembler with minimal Node.js shims:
- `src/vendor/node-shim.js` - Provides XMLHttpRequest, navigator, screen, document stubs
- `src/vendor/mv/` - MVMF.js, MVSB.js, MVIO.js, MVRP.js, MVRP_Map.js

To update vendor libs: copy from `~/dev/PatchedReality/SceneAssembler/site/js/vendor/mv/` and add `const MV = globalThis.MV;` at top of MVSB, MVIO, MVRP, MVRP_Map files.

### Storage

SCP/SSH-based storage for uploading resources (.glb, .png, etc.) via `ssh2-sftp-client`. Config fields: `scpHost`, `scpUser`, `scpRemotePath`, `scpKeyPath`, and `resourceUrlPrefix` (URL prefix for referencing uploads in scenes, e.g. `/objects/`).

### MVMF Protocol

Key class IDs: 70=RMRoot, 71=RMCObject, 72=RMTObject, 73=RMPObject

Protocol actions (from `MVRP_Map.js`):
| Action | Event | Purpose |
|--------|-------|---------|
| UPDATE | `RMPObject:update` | Fetch object + children |
| TRANSFORM | `RMPObject:transform` | Update position/rotation/scale |
| RESOURCE | `RMPObject:resource` | Update model URL |
| RMPOBJECT_OPEN | `RMPObject:rmpobject_open` | Create child object |
| RMPOBJECT_CLOSE | `RMPObject:rmpobject_close` | Delete object |
| PARENT | `RMPObject:parent` | Reparent object |

### Reference Sources

These files in the sibling `~/dev/PatchedReality/SceneAssembler/` repo are the authoritative references:
- `docs/SampleClient/js/rp1.js` - MVClient pattern, _sendAction, connection flow
- `site/js/vendor/mv/MVRP_Map.js:2638-2791` - Protocol actions
- `site/js/rp1.js` - Full CRUD implementation
- `site/js/maputil.js` - Field mapping helpers (RMCopy_* functions)

## Configuration

Server config lives at `~/.config/fabric-mcp/config.json`:
```json
{
  "default": {
    "fabricUrl": "https://example.com/fabric/fabric.msf",
    "adminKey": "your-admin-token",
    "scpHost": "spatial.example.com",
    "scpUser": "deploy",
    "scpRemotePath": "/var/www/objects/",
    "scpKeyPath": "~/.ssh/id_rsa",
    "resourceUrlPrefix": "/objects/"
  }
}
```

## Development Notes

- **MVFabricClient**: Uses actual MVMF libraries - fully API-compatible with SceneAssembler
- For large scenes (800+ objects), use pagination in list operations and SEARCH for filtering