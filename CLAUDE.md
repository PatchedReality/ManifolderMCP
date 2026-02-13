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
- **Tools** (`src/tools/`): MCP tool implementations for connection, scenes, objects, bulk operations, resources, and action resources
- **Agent Guide** (`src/agent-guide.md`): Workflows and patterns for AI agents, exposed as MCP resource `fabric://guide`

### Vendor Libraries

MVMF libraries copied from SceneAssembler with minimal Node.js shims:
- `src/vendor/node-shim.js` - Provides XMLHttpRequest, navigator, screen, document stubs
- `src/vendor/mv/` - MVMF.js, MVSB.js, MVIO.js, MVRP.js, MVRP_Map.js, MVRest.js, MVXP.js, MVRP_Dev.js, index.js

To update vendor libs: copy from `~/dev/PatchedReality/SceneAssembler/site/js/vendor/mv/` and add `const MV = globalThis.MV;` at top of all files except MVMF.js (which defines MV).

### Storage

SCP/SSH-based storage for uploading resources (.glb, .png, etc.) via `ssh2-sftp-client`. Config fields: `scpHost`, `scpUser`, `scpRemotePath`, `scpKeyPath`, and `resourceUrlPrefix` (URL prefix for referencing uploads in scenes, e.g. `/objects/`).

### MCP Resources

The server exposes these MCP resources:
- `fabric://guide` - Agent guide with workflows and patterns (from `src/agent-guide.md`)
- `fabric://action-schema` - Full JSON schema for action resources (lights, text, rotators, video)

### MVMF Protocol

Key object category class IDs:
- 70 = RMRoot - The map-level root of everything contained in a map service like RP1
- 71 = RMCObject - Celestial Object - objects that group other objects in space
- 72 = RMTObject - Terrestrial Object - objects that map the outer skin of a celestial object like earth
- 73 = RMPObject - Physical Object - objects that have a 3D physical manifestation in the virtual world, like buildings, trees, etc

Celestial types (RMCObject bType):
| bType | Name |
|-------|------|
| 1 | Universe |
| 2 | Supercluster |
| 3 | GalaxyCluster |
| 4 | Galaxy |
| 5 | Sector |
| 6 | Nebula |
| 7 | StarCluster |
| 8 | BlackHole |
| 9 | StarSystem |
| 10 | Star |
| 11 | PlanetSystem |
| 12 | Planet |
| 13 | Moon |
| 14 | Debris |
| 15 | Satellite |
| 16 | Transport |
| 17 | Surface |

Terrestrial types (RMTObject bType):
| bType | Name |
|-------|------|
| 1 | Root |
| 2 | Water |
| 3 | Land |
| 4 | Country |
| 5 | Territory |
| 6 | State |
| 7 | County |
| 8 | City |
| 9 | Community |
| 10 | Parcel |

Physical types (RMPObject bType): Always 0 for now. No defined bTypes for physical objects.

Protocol actions (from `MVRP_Map.js`):
| Action | Event | Purpose |
|--------|-------|---------|
| UPDATE | `RMPObject:update` | Fetch object + children |
| TRANSFORM | `RMPObject:transform` | Update position/rotation/scale |
| RESOURCE | `RMPObject:resource` | Update model URL |
| RMPOBJECT_OPEN | `RMPObject:rmpobject_open` | Create Physical child object |
| RMTOBJECT_OPEN | `RMTObject:rmtobject_open` | Create Terrestrial child object (scenes, parcels) |
| RMPOBJECT_CLOSE | `RMPObject:rmpobject_close` | Delete object |
| PARENT | `RMPObject:parent` | Reparent object |

### Object Creation Types

When creating objects, use the appropriate object type based on what you're creating:

| Object Type | Class ID | bType | Protocol Action | Resource | Notes |
|-------------|----------|-------|-----------------|----------|-------|
| Scene | 72 (Terrestrial) | 1 (Root) | RMTOBJECT_OPEN | none | Top-level scene container |
| Parcel | 72 (Terrestrial) | 10 (Parcel) | RMTOBJECT_OPEN | none | Bounds = parcel dimensions |
| Container | 73 (Physical) | 0 | RMPOBJECT_OPEN | none | Empty grouping object |
| Model | 73 (Physical) | 0 | RMPOBJECT_OPEN | GLB file | Bounds = size encompassing the model |
| Action | 73 (Physical) | 0 | RMPOBJECT_OPEN | action:// URI + JSON | Lights, text, rotators, video |

**When to use each type:**
- **Scene**: Created via `create_scene` tool only
- **Parcel**: Use `objectType: 'parcel'` in `create_object` for land subdivisions within a scene
- **Container**: Empty objects for grouping, pivots, or organizational hierarchy
- **Model**: Objects with a `.glb` resource file
- **Action**: Objects with `action://` URI and accompanying JSON config file

**Bounds guidance:**
- **Parcel**: Set `bound` to the parcel's physical dimensions (e.g., `{x:100, y:100, z:50}` for a 100×100 land plot)
- **Model**: Set `bound` to a size that encompasses the GLB model geometry

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