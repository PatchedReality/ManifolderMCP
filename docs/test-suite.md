# Manifolder MCP Test Suite

A manual test suite covering all MCP tools. Run against the `default` profile. All created objects should be cleaned up at the end.

## 1. Connection

| # | Action | Expected |
|---|--------|----------|
| 1.1 | `list_profiles` | Returns available profiles including `default` |
| 1.2 | `fabric_connect(profile: "default")` | Success, returns fabricUrl |
| 1.3 | `fabric_status` | Connected, shows server info |
| 1.4 | `fabric_disconnect` | Success |
| 1.5 | `fabric_status` | Not connected |
| 1.6 | `fabric_connect(profile: "nonexistent")` | Error: profile not found |

## 2. Scenes

| # | Action | Expected |
|---|--------|----------|
| 2.1 | `list_scenes(profile: "default")` | Auto-connects, returns scene list with `url` field |
| 2.2 | `create_scene(name: "TestPhysical")` | Creates physical scene, returns id `physical:N` |
| 2.3 | `create_scene(name: "TestCelestial", objectType: "celestial:planet")` | Returns id `celestial:N` |
| 2.4 | `create_scene(name: "TestTerrestrial", objectType: "terrestrial:sector")` | Returns id `terrestrial:N` |
| 2.5 | `open_scene(sceneId: <2.2>)` | Returns root with childCount, children array |
| 2.6 | `list_scenes` | All three test scenes appear |

## 3. Object Creation — Full Hierarchy

Build a complete celestial → terrestrial → physical tree.

| # | Action | Expected |
|---|--------|----------|
| 3.1 | `create_object(parentId: <2.3>, name: "Moon", objectType: "celestial:moon")` | `celestial:N` |
| 3.1b | `create_object(parentId: <2.3>, name: "Moon2", objectType: "celestial:moon", orbit: {period:27.3, start:0, a:384400, b:383000}, properties: {mass:7.34e22, gravity:1.62, color:0, brightness:0, reflectivity:0})` | Created with orbital data |
| 3.2 | `create_object(parentId: <3.1>, name: "Surface", objectType: "celestial:surface")` | `celestial:N` |
| 3.3 | `create_object(parentId: <3.2>, name: "Country", objectType: "terrestrial:country")` | `terrestrial:N` |
| 3.4 | `create_object(parentId: <3.3>, name: "Sector", objectType: "terrestrial:sector")` | `terrestrial:N` |
| 3.5 | `create_object(parentId: <3.4>, name: "Parcel", objectType: "terrestrial:parcel")` | `terrestrial:N` |
| 3.6 | `create_object(parentId: <3.5>, name: "Building", objectType: "physical")` | `physical:N` |
| 3.7 | `create_object(parentId: <3.6>, name: "Furniture", objectType: "physical")` | `physical:N` — physical under physical |

Create objects under the physical and terrestrial test scenes too.

| # | Action | Expected |
|---|--------|----------|
| 3.8 | `create_object(parentId: <2.2>, name: "Tree", objectType: "physical")` | `physical:N` — physical under physical scene |
| 3.9 | `create_object(parentId: <2.4>, name: "Parcel", objectType: "terrestrial:parcel")` | `terrestrial:N` |
| 3.10 | `create_object(parentId: <3.9>, name: "Bench", objectType: "physical")` | `physical:N` — physical under parcel |

## 4. Object Creation — Illegal Parenting

All should fail with translated error messages.

| # | Action | Expected Error |
|---|--------|----------------|
| 4.1 | `create_object(parentId: <2.3>, objectType: "terrestrial:sector")` | celestial:surface is the only celestial type that accepts terrestrial children |
| 4.2 | `create_object(parentId: <2.3>, objectType: "physical")` | Cannot create physical child under this parent type |
| 4.3 | `create_object(parentId: <2.3>, objectType: "celestial:galaxy")` | objectType must be greater than or equal to its parent's objectType |
| 4.4 | `create_object(parentId: <3.2>, objectType: "celestial:surface")` | objectSubtype must be greater than its parent's objectType |
| 4.5 | `create_object(parentId: <2.4>, objectType: "physical")` | terrestrial:parcel is the only terrestrial type that accepts physical children |
| 4.6 | `create_object(parentId: <2.4>, objectType: "terrestrial:city")` | objectType must be greater than or equal to its parent's objectType |
| 4.7 | `create_object(parentId: <3.5>, objectType: "terrestrial:parcel")` | objectSubtype must be greater than its parent's objectType |
| 4.8 | `create_object(parentId: <3.5>, objectType: "celestial:planet")` | Cannot create celestial child under this parent type |
| 4.9 | `create_object(parentId: <3.6>, objectType: "terrestrial:sector")` | Cannot create terrestrial child under this parent type |
| 4.10 | `create_object(parentId: <3.6>, objectType: "celestial:planet")` | Cannot create celestial child under this parent type |

## 5. Object Inspection

| # | Action | Expected |
|---|--------|----------|
| 5.1 | `get_object(objectId: <3.6>)` | Returns full details: id, name, parentId, position, rotation, scale, resourceReference, bound, childCount, children |
| 5.2 | `list_objects(scopeId: <2.3>, limit: 10)` | Lists celestial children under the planet scene |
| 5.3 | `list_objects(scopeId: <2.3>, filter: {type: "celestial:surface"})` | Only surface objects |
| 5.4 | `list_objects(scopeId: <2.3>, filter: {namePattern: "Moon"})` | Only the moon |
| 5.5 | `find_objects(scopeId: <2.4>, query: {namePattern: "Bench"})` | Finds the bench from 3.10 |

## 6. Object Updates

Test all updatable fields on the physical object from 3.6.

| # | Action | Expected |
|---|--------|----------|
| 6.1 | `update_object(objectId: <3.6>, name: "Renamed Building")` | Name updated |
| 6.2 | `update_object(objectId: <3.6>, position: {x:10, y:5, z:3})` | Position updated |
| 6.3 | `update_object(objectId: <3.6>, rotation: {x:0, y:0.707, z:0, w:0.707})` | Rotation updated |
| 6.4 | `update_object(objectId: <3.6>, scale: {x:2, y:2, z:2})` | Scale updated |
| 6.5 | `update_object(objectId: <3.6>, bound: {x:5, y:10, z:5})` | Bound updated |
| 6.6 | `update_object(objectId: <3.6>, resourceReference: "<url from upload_resource>")` | Resource updated |
| 6.7 | `update_object(objectId: <3.6>, resourceName: "<url from upload_resource>")` | ResourceName updated |
| 6.8 | `get_object(objectId: <3.6>)` | Verify all fields reflect updates including bound `{x:5, y:10, z:5}` |
| 6.9 | `update_object(objectId: <3.6>, name: "Building", position: {x:0,y:0,z:0}, rotation: {x:0,y:0,z:0,w:1}, scale: {x:1,y:1,z:1})` | Multiple fields in one call |

## 6b. Celestial Object Updates

Test orbit and properties fields on the celestial object from 3.1.

| # | Action | Expected |
|---|--------|----------|
| 6b.1 | `update_object(objectId: <3.1>, orbit: {period:27.3, start:0, a:384400, b:383000})` | Orbit updated |
| 6b.2 | `update_object(objectId: <3.1>, properties: {mass:7.34e22, gravity:1.62, color:0.8, brightness:0.1, reflectivity:0.12})` | Properties updated |
| 6b.3 | `get_object(objectId: <3.1>)` | Response includes orbit and properties fields with correct values |
| 6b.4 | `update_object(objectId: <3.1>, orbit: {period:0, start:0, a:0, b:0}, properties: {mass:0, gravity:0, color:0, brightness:0, reflectivity:0})` | Both updated in one call |

## 6c. Terrestrial Object Updates

Test position/rotation/scale on terrestrial objects to verify pCoord handling. Without the bCoord=3 (NUL) fix, the default bCoord=0 (GEO) with dC=0 fails server-side geo validation and the transform silently fails.

| # | Action | Expected |
|---|--------|----------|
| 6c.1 | `update_object(objectId: <3.3>, position: {x:100, y:50, z:25})` | Position updated |
| 6c.2 | `get_object(objectId: <3.3>)` | Position reflects {x:100, y:50, z:25} |
| 6c.3 | `update_object(objectId: <3.3>, rotation: {x:0, y:0.707, z:0, w:0.707})` | Rotation updated |
| 6c.4 | `update_object(objectId: <3.5>, position: {x:10, y:0, z:10}, scale: {x:2, y:2, z:2})` | Multiple fields on parcel |
| 6c.5 | `get_object(objectId: <3.5>)` | Position and scale reflect updates |
| 6c.6 | `update_object(objectId: <3.3>, position: {x:0, y:0, z:0}, rotation: {x:0, y:0, z:0, w:1}, scale: {x:1, y:1, z:1})` | Reset to defaults |

## 7. Move Object

| # | Action | Expected |
|---|--------|----------|
| 7.1 | `create_object(parentId: <3.5>, name: "Movable", objectType: "physical")` | `physical:N` |
| 7.2 | `move_object(objectId: <7.1>, newParentId: <3.6>)` | Object reparented, returns updated object |
| 7.3 | `get_object(objectId: <7.1>)` | parentId is now <3.6> |

## 8. Bulk Object Operations

| # | Action | Expected |
|---|--------|----------|
| 8.1 | `bulk_update(operations: [{type:"create", params:{parentId:<2.2>, name:"Bulk1"}}, {type:"create", params:{parentId:<2.2>, name:"Bulk2"}}, {type:"create", params:{parentId:<2.2>, name:"Bulk3"}}])` | 3 objects created, returns createdIds |
| 8.2 | `bulk_update(operations: [{type:"update", params:{objectId:<8.1[0]>, name:"BulkRenamed"}}])` | Name updated |
| 8.3 | `bulk_update(operations: [{type:"delete", params:{objectId:<8.1[0]>}}, {type:"delete", params:{objectId:<8.1[1]>}}, {type:"delete", params:{objectId:<8.1[2]>}}])` | All 3 deleted |

## 9. Resources

Requires a local test file. Create `/tmp/test-resource.json` with `{"header":{"type":"DATA"},"body":{"parent":0,"rotSpeed":20,"axis":[0,1,0]}}`.

| # | Action | Expected |
|---|--------|----------|
| 9.1 | `get_action_resource_schema` | Returns schema for all action types |
| 9.2 | `validate_action_resource(localPath: "/tmp/test-resource.json", type: "rotator")` | Validation passes |
| 9.3 | `upload_resource(localPath: "/tmp/test-resource.json", targetName: "test/test-rotator.json")` | Upload succeeds |
| 9.4 | `list_resources(path: "test")` | Shows test-rotator.json |
| 9.5 | `list_resources(recursive: true, filter: "*.json")` | Includes test/test-rotator.json |
| 9.6 | `download_resource(resourceName: "test/test-rotator.json", localPath: "/tmp/test-download.json")` | Download succeeds, file matches |
| 9.7 | `move_resource(sourceName: "test/test-rotator.json", destName: "test/test-renamed.json")` | Rename succeeds |
| 9.8 | `list_resources(path: "test")` | Shows test-renamed.json, not test-rotator.json |
| 9.9 | `delete_resource(resourceName: "test/test-renamed.json")` | Delete succeeds |
| 9.10 | `list_resources(path: "test")` | Empty or no test-renamed.json |

## 10. Bulk Resource Operations

Create `/tmp/bulk-a.json` and `/tmp/bulk-b.json` with valid action resource content.

| # | Action | Expected |
|---|--------|----------|
| 10.1 | `bulk_upload_resources(files: [{localPath:"/tmp/bulk-a.json", targetName:"test/bulk-a.json"}, {localPath:"/tmp/bulk-b.json", targetName:"test/bulk-b.json"}])` | Both uploaded |
| 10.2 | `bulk_download_resources(downloads: [{resourceName:"test/bulk-a.json", localPath:"/tmp/dl-a.json"}, {resourceName:"test/bulk-b.json", localPath:"/tmp/dl-b.json"}])` | Both downloaded |
| 10.3 | `bulk_move_resources(moves: [{sourceName:"test/bulk-a.json", destName:"test/moved-a.json"}, {sourceName:"test/bulk-b.json", destName:"test/moved-b.json"}])` | Both renamed |
| 10.4 | `bulk_delete_resources(resourceNames: ["test/moved-a.json", "test/moved-b.json"])` | Both deleted |

## 11. Cleanup

Delete all test scenes in reverse order. Scene deletion cascades to all children.

| # | Action | Expected |
|---|--------|----------|
| 11.1 | `delete_scene(sceneId: <2.4>)` | Terrestrial scene deleted |
| 11.2 | `delete_scene(sceneId: <2.3>)` | Celestial scene deleted (cascades through full hierarchy) |
| 11.3 | `delete_scene(sceneId: <2.2>)` | Physical scene deleted |
| 11.4 | `list_scenes` | No test scenes remain |
| 11.5 | `fabric_disconnect` | Disconnected |
| 11.6 | Clean up local temp files | `/tmp/test-resource.json`, `/tmp/test-download.json`, `/tmp/bulk-*.json`, `/tmp/dl-*.json` |
