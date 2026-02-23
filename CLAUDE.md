# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Manifolder MCP Server - an MCP server enabling Claude Code (and other MCP clients) to directly edit spatial Fabric scenes. Wraps MVMF libraries with a thin MCP layer. The client (`ManifolderClient`) is shared with the sibling `../Manifolder/` project and synced from there.

## Commands

```bash
npm install                      # Install dependencies
npm run build                    # Build TypeScript + copy vendor & client to dist/
npm run dev                      # TypeScript watch mode
npm start                        # Run the MCP server
npm test                         # Run ManifolderClient unit tests
npm run test:integration         # Run integration tests (requires server)
npm run test:record-fixtures     # Record test fixtures from live server
npm run sync:manifolder-client   # Sync ManifolderClient from ../Manifolder/
npm run check:manifolder-client-sync  # Check if client is in sync
```

## Architecture

### Core Components

- **ManifolderClient** (`src/client/ManifolderClient.js`): Shared client synced from `../Manifolder/client/js/`. Exports `createManifolderSubscriptionClient` and `createManifolderPromiseClient` via `src/client/index.ts`.
- **Config** (`src/config.ts`): Loads `~/.config/manifolder-mcp/config.json` for connection profiles and storage backends
- **Tools** (`src/tools/`): MCP tool implementations:
  - `connection.ts` — connect/disconnect/status
  - `scenes.ts` — list/open/create/delete scenes
  - `objects.ts` — CRUD, move, search for objects
  - `bulk.ts` — batch object operations
  - `resources.ts` — upload/download/list/delete/move files
  - `actionResources.ts` — validate/schema for action resources (lights, text, rotators, video)
  - `schemas.ts` — shared Zod schemas for tool parameters
- **Output** (`src/output.ts`): Pagination helper for list responses
- **Storage** (`src/storage/ScpStorage.ts`): SCP/SSH-based file storage via `ssh2-sftp-client`
- **Agent Guide** (`src/agent-guide.md`): Tool usage documentation served to MCP clients

### Vendor Libraries

MVMF libraries synced from SceneAssembler via `scripts/sync-vendor.sh`:
- `src/vendor/node-shim.js` — XMLHttpRequest, navigator, screen, document stubs
- `src/vendor/mv/index.js` — loader that imports all MVMF modules in dependency order, redirects console.log to stderr
- `src/vendor/mv/` — MVMF.js, MVSB.js, MVXP.js, MVIO.js, MVRP.js, MVRest.js, MVRP_Dev.js, MVRP_Fabric.js, MVRP_Map.js

To update vendor libs: `./scripts/sync-vendor.sh [path-to-SceneAssembler]` (defaults to `../../RP1/SceneAssembler`).

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

These files in the sibling SceneAssembler repo are the authoritative references:
- `docs/SampleClient/js/rp1.js` — MVClient pattern, _sendAction, connection flow
- `site/js/vendor/mv/MVRP_Map.js:2638-2791` — Protocol actions
- `site/js/rp1.js` — Full CRUD implementation
- `site/js/maputil.js` — Field mapping helpers (RMCopy_* functions)

## Configuration

Server config lives at `~/.config/manifolder-mcp/config.json`:
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

- **ManifolderClient** is the canonical client, shared with `../Manifolder/`. Edit there, then `npm run sync:manifolder-client` to pull changes here.
- For large scenes (800+ objects), use pagination in list operations and SEARCH for filtering