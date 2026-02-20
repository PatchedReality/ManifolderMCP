# Manifolder MCP Server

## Project Location
**New standalone project:** `~/dev/PatchedReality/ManifolderMCP/`
(Sibling to SceneAssembler)

## Goal
Create an MCP server that allows Claude Code (and other MCP clients) to directly edit spatial Fabric scenes on a server.

## Approach
**Wrap the MVMF libraries** with a thin MCP layer. Node.js-compatible MVMF libraries are on the horizon, so we'll follow the existing `MVClient` pattern from `docs/SampleClient/js/rp1.js` closely. This keeps us aligned with the official SDK and avoids protocol drift.

## Config
`~/.config/manifolder-mcp/config.json`:
```json
{
  "default": {
    "fabricUrl": "https://example.com/fabric/fabric.msf",
    "adminKey": "your-admin-token",
    "storage": {
      "type": "scp",
      "host": "spatial.example.com",
      "user": "deploy",
      "remotePath": "/var/www/objects/",
      "keyPath": "~/.ssh/id_rsa",
      "baseUrl": "https://spatial.example.com/objects/"
    }
  }
}
```

### Storage backends (pluggable)
| Type | Config | Description |
|------|--------|-------------|
| `scp` | host, user, remotePath, keyPath, baseUrl | Default: SCP files via SSH |
| `http` | uploadUrl, baseUrl | POST files to HTTP endpoint |
| `s3` | bucket, region, prefix, baseUrl | Upload to S3 bucket |
| `local` | directory, baseUrl | Copy to local path (for self-hosted) |

## MCP Tools (v1)

### Connection
| Tool | Parameters | Description |
|------|------------|-------------|
| `fabric_connect` | `profile?` | Connect using config profile (default: "default") |
| `fabric_disconnect` | - | Close connection |
| `fabric_status` | - | Connection state + current scene info |

### Scenes
| Tool | Parameters | Description |
|------|------------|-------------|
| `list_scenes` | - | List all scenes in the Fabric |
| `open_scene` | `sceneId` | Load scene, return object tree summary |
| `create_scene` | `name` | Create new empty scene |
| `delete_scene` | `sceneId` | Delete scene and children |

### Objects
| Tool | Parameters | Description |
|------|------------|-------------|
| `list_objects` | `sceneId`, `filter?` | List objects (optional name/type filter) |
| `get_object` | `objectId` | Get full object details |
| `create_object` | `parentId`, `name`, `position?`, `rotation?`, `scale?`, `resource?` | Create object |
| `update_object` | `objectId`, `name?`, `position?`, `rotation?`, `scale?`, `resource?` | Update properties |
| `delete_object` | `objectId` | Delete object and children |
| `move_object` | `objectId`, `newParentId` | Reparent object |

### Bulk Operations
| Tool | Parameters | Description |
|------|------------|-------------|
| `bulk_update` | `operations[]` | Batch multiple updates atomically |
| `find_objects` | `sceneId`, `query` | Search by name pattern, position radius, resource URL |

### Resources
| Tool | Parameters | Description |
|------|------------|-------------|
| `upload_resource` | `filePath`, `targetName?` | Upload .glb, .png, etc. to Fabric server's `/objects/` directory |
| `list_resources` | `filter?` | List available resources on the server |
| `delete_resource` | `resourceName` | Remove a resource file |

Resources are uploaded to a directory on the Fabric server (e.g., `https://spatial.patchedreality.com/objects/Model.glb`) and then referenced by URL in scene objects.

## Project Structure
```
ManifolderMCP/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts              # MCP server entry
│   ├── config.ts             # Config loader
│   ├── FabricMCPClient.ts    # Extends MVClient pattern from SampleClient
│   ├── tools/
│   │   ├── connection.ts
│   │   ├── scenes.ts
│   │   ├── objects.ts
│   │   ├── bulk.ts
│   │   └── resources.ts      # upload_resource, list_resources, delete_resource
│   ├── storage/
│   │   ├── IStorageBackend.ts
│   │   ├── ScpStorage.ts     # Default: SCP via ssh2-sftp-client
│   │   ├── HttpStorage.ts    # POST to HTTP endpoint
│   │   └── S3Storage.ts      # AWS S3 uploads
│   └── vendor/mv/            # MVMF libraries (Node.js compatible versions)
│       └── ...
```

## Core Pattern (from SampleClient)
The `FabricMCPClient` follows the `MVClient` pattern:
```javascript
class FabricMCPClient extends MV.MVMF.NOTIFICATION {
   // Connection: new MV.MVRP.MSF(url) → GetLnG("map") → Login() → Model_Open()
   // Promisified actions via _sendAction() wrapper
   // Notifications: onInserted, onUpdated, onChanged, onDeleting, onReadyState
}
```

Class IDs: 70=RMRoot, 71=RMCObject, 72=RMTObject, 73=RMPObject

## Key Protocol Details
From `MVRP_Map.js` lines 2638-2791:

| Action | Socket Event | Purpose |
|--------|--------------|---------|
| UPDATE | `RMPObject:update` | Fetch object + children |
| NAME | `RMPObject:name` | Update name |
| TRANSFORM | `RMPObject:transform` | Update position/rotation/scale |
| RESOURCE | `RMPObject:resource` | Update model URL |
| BOUND | `RMPObject:bound` | Update bounding box |
| RMPOBJECT_OPEN | `RMPObject:rmpobject_open` | Create child object |
| RMPOBJECT_CLOSE | `RMPObject:rmpobject_close` | Delete object |
| PARENT | `RMPObject:parent` | Reparent object |

## Implementation Steps

### Phase 0: Project Setup ✓
1. Create `~/dev/PatchedReality/ManifolderMCP/` directory
2. Copy this plan to new project as `PLAN.md`
3. Initialize git repo
4. User continues in new project session

### Phase 1: Scaffold (can start now)
1. Set up Node.js project with MCP SDK (`@modelcontextprotocol/sdk`)
2. Implement config loading from `~/.config/manifolder-mcp/config.json` (including storage config)
3. Define TypeScript interfaces for RMPObject, Transform, IStorageBackend, etc.
4. Create `IFabricClient` interface matching MVClient pattern
5. Create stub `MockFabricClient` with hardcoded test data
6. Implement `ScpStorage` backend (default) using `ssh2-sftp-client`
7. Wire up MCP server with all tool stubs returning mock data

### Phase 2: Real MVMF Integration (when libs available)
8. Drop in Node.js MVMF libraries
9. Create `FabricMCPClient` implementing `IFabricClient`, extending `MV.MVMF.NOTIFICATION`
10. Implement connection flow: MSF load → GetLnG("map") → Login → Model_Open(RMRoot)
11. Implement read operations: Child_Enum, Model_Open, data extraction
12. Implement mutations: Request('RMPOBJECT_OPEN'), Request('NAME'), etc.

### Phase 3: Bulk & Polish
13. Implement `bulk_update`, `find_objects` (SEARCH action)
14. Error handling, reconnection logic
15. Integration tests against real Fabric

## Critical Source Files (in SceneAssembler repo)
Reference these from `~/dev/PatchedReality/SceneAssembler/`:
- `docs/SampleClient/js/rp1.js` - **Primary reference**: MVClient pattern, _sendAction, connection flow
- `site/js/vendor/mv/MVRP_Map.js:2638-2791` - Protocol actions (IO_RMPOBJECT.apAction)
- `site/js/rp1.js` - Full CRUD implementation reference
- `site/js/maputil.js` - Field mapping helpers (RMCopy_* functions)

## Verification
1. Start MCP server: `node dist/index.js`
2. Configure in Claude Code settings
3. Test connection: `fabric_connect` should return success
4. Test read: `list_scenes` should show available scenes
5. Test mutation: `create_object` in a test scene, verify in SceneAssembler UI
6. Test bulk: `bulk_update` multiple objects, verify positions changed
7. Test upload: `upload_resource` a .glb file, verify accessible at baseUrl + filename

## Dependencies
- **Node.js MVMF libraries**: Timeline unclear. We'll scaffold with a stub/interface layer that will be swapped for real MVMF when available.

## Phased Delivery

### Immediate (scaffold)
- Project structure, config loading, MCP server shell
- Tool definitions with TypeScript interfaces
- Stub `FabricMCPClient` with hardcoded test responses

### When MVMF Node.js ready
- Drop in MVMF libraries
- Implement real `FabricMCPClient` following MVClient pattern
- Integration testing

## Risks
| Risk | Mitigation |
|------|------------|
| MVMF timeline unclear | Stub layer allows progress; clean interface for swap |
| Auth token expiry | Re-auth on connection errors |
| Large scenes (800+ objects) | Pagination in `list_objects`, SEARCH for filtering |