# Object Protocol

## Object Identity

Every object in the Spatial Fabric has a **class** and a **numeric ID**. IDs are only unique within a class — different classes can reuse the same numeric ID (e.g., RMRoot 70/1, RMCObject 71/1, and RMPObject 73/1 can all coexist on the same server).

### Classes

| Class ID | Name | Prefix | Description |
|----------|------|--------|-------------|
| 70 | RMRoot | `root` | Single root per server, always ID 1 |
| 71 | RMCObject | `celestial` | Celestial objects (planets, stars, galaxies) |
| 72 | RMTObject | `terrestrial` | Terrestrial objects (sectors, parcels, cities) |
| 73 | RMPObject | `physical` | Physical objects (3D models, containers, lights) |

### Object Reference Format

All object references in the MCP tools use the format `"<prefix>:<id>"`:

```
"root"              — RMRoot (always ID 1, no numeric ID needed)
"celestial:1"       — RMCObject with ID 1
"terrestrial:3"     — RMTObject with ID 3
"physical:42"       — RMPObject with ID 42
```

This format is used everywhere: `parentId`, `objectId`, `newParentId`, and in all responses.

## Object Types (Subtypes)

Each class has a `bType` field that further specifies the object. The MCP tools use friendly names in the format `"<class>:<subtype>"`.

### Celestial Subtypes (class 71)

| objectType | bType | Description |
|---|---|---|
| `celestial:universe` | 1 | Universe |
| `celestial:supercluster` | 2 | Supercluster |
| `celestial:galaxy_cluster` | 3 | Galaxy Cluster |
| `celestial:galaxy` | 4 | Galaxy |
| `celestial:black_hole` | 5 | Black Hole |
| `celestial:nebula` | 6 | Nebula |
| `celestial:star_cluster` | 7 | Star Cluster |
| `celestial:constellation` | 8 | Constellation |
| `celestial:star_system` | 9 | Star System |
| `celestial:star` | 10 | Star |
| `celestial:planet_system` | 11 | Planet System |
| `celestial:planet` | 12 | Planet |
| `celestial:moon` | 13 | Moon |
| `celestial:debris` | 14 | Debris |
| `celestial:satellite` | 15 | Satellite |
| `celestial:transport` | 16 | Transport |
| `celestial:surface` | 17 | Surface |

### Terrestrial Subtypes (class 72)

| objectType | bType | Description |
|---|---|---|
| `terrestrial:root` | 1 | Terrestrial Root |
| `terrestrial:water` | 2 | Water |
| `terrestrial:land` | 3 | Land |
| `terrestrial:country` | 4 | Country |
| `terrestrial:territory` | 5 | Territory |
| `terrestrial:state` | 6 | State |
| `terrestrial:county` | 7 | County |
| `terrestrial:city` | 8 | City |
| `terrestrial:community` | 9 | Community |
| `terrestrial:sector` | 10 | Sector |
| `terrestrial:parcel` | 11 | Parcel |

### Physical Subtypes (class 73)

| objectType | bType | Description |
|---|---|---|
| `physical` | 0 | Default (models, containers, actions) |
| `physical:transport` | 1 | Transport |

## Protocol Mapping

### Action Routing

The **parent's class** determines which server handler processes the request.
The **child's class** determines the action name.

| Child class | Action name |
|---|---|
| Celestial (71) | `RMCOBJECT_OPEN` |
| Terrestrial (72) | `RMTOBJECT_OPEN` |
| Physical (73) | `RMPOBJECT_OPEN` |

The combination produces a wire event like `"RMRoot:rmtobject_open"` or `"RMTObject:rmpobject_open"`, which maps to a stored procedure like `set_RMRoot_RMTObject_Open` or `set_RMTObject_RMPObject_Open`.

### Valid Parent/Child Combinations

| Parent class | Can create children of class |
|---|---|
| root (70) | celestial, terrestrial, physical |
| celestial (71) | celestial, terrestrial |
| terrestrial (72) | terrestrial, physical |
| physical (73) | physical |

### Payload by Child Class

**All classes** include:

| Group | Field | Type | Description |
|---|---|---|---|
| pName | wsRM*ObjectId | string(48) | Object name |
| pType | bType | uint8 | Subtype (see tables above) |
| pType | bSubtype | uint8 | Further subtype |
| pType | bFiction | uint8 | Unknown |
| pOwner | twRPersonaIx | int64 | Owner persona ID |
| pResource | qwResource | int64 | Numeric resource ID |
| pResource | sName | string(48) | Action resource config URL (empty for regular models/images) |
| pResource | sReference | string(128) | Resource URL — the asset the renderer fetches |
| pTransform | vPosition (dX, dY, dZ) | double×3 | World position |
| pTransform | qRotation (dX, dY, dZ, dW) | double×4 | Rotation quaternion |
| pTransform | vScale (dX, dY, dZ) | double×3 | Scale |
| pBound | dX, dY, dZ | double×3 | Bounding box size |

**Celestial** also includes:

| Group | Field | Type | Description |
|---|---|---|---|
| pOrbit_Spin | tmPeriod | int64 | Orbit period in 1/64-second ticks (days × 86400 × 64) |
| pOrbit_Spin | tmStart | int64 | Orbit start time in 1/64-second ticks |
| pOrbit_Spin | dA, dB | double×2 | Semi-major/semi-minor axis in meters (km × 1000) |
| pProperties | fMass | float | Mass |
| pProperties | fGravity | float | Gravity |
| pProperties | fColor | float | Color |
| pProperties | fBrightness | float | Brightness |
| pProperties | fReflectivity | float | Reflectivity |

**Terrestrial** also includes:

| Group | Field | Type | Description |
|---|---|---|---|
| pProperties | bLockToGround | uint8 | Snap to terrain |
| pProperties | bYouth | uint8 | Unknown |
| pProperties | bAdult | uint8 | Unknown |
| pProperties | bAvatar | uint8 | Unknown |
| pCoord | bCoord | uint8 | Coordinate system (see below) |
| pCoord | dA, dB, dC | double×3 | Coordinate values |

**Physical** also includes:

| Group | Field | Type | Description |
|---|---|---|---|
| pType | bMovable | uint8 | Whether object can be moved |

### Actions

Beyond OPEN (create), each class supports these actions:

| Action | Description |
|---|---|
| UPDATE | Fetch object and children |
| NAME | Rename object |
| TYPE | Change type |
| OWNER | Change owner |
| RESOURCE | Change resource URL |
| TRANSFORM | Update position/rotation/scale |
| PROPERTIES | Update class-specific properties |
| PARENT | Reparent to new parent |
| *_CLOSE | Delete child object (takes bDeleteAll flag) |
| CAPTURE / RELEASE | Lock/unlock object (RMTObject, RMPObject) |
| SEARCH | Server-side name search (REST only) |

### Object URLs

Direct URL format: `https://<host>/fabric/<classId>/<objectId>`

Examples:
- `https://spatial.patchedreality.com/fabric/73/1` — Physical object 1
- `https://spatial.patchedreality.com/fabric/72/1` — Terrestrial object 1

### Orbital Plane Orientation (Celestial qRotation)

For celestial objects with orbits, the rotation quaternion encodes the orbital plane orientation — not the object's visual spin. The coordinate system is Y-up.

The quaternion is computed from three Keplerian angles:

```
q = Qy(Ω) × Qx(i) × Qy(ω)
```

Where:
- **Ω** (longitude of ascending node) — rotates around Y to set where the orbit crosses the reference plane
- **i** (inclination) — tilts the orbital plane out of the reference plane (rotation around X)
- **ω** (argument of perihelion) — rotates within the orbital plane to orient the closest-approach point

For planet systems orbiting a star, the reference plane is the ecliptic. For moons, the reference plane is typically the parent planet's equatorial plane (regular moons) or the ecliptic (irregular moons).

**Quaternion helpers:**

```
Qx(θ) = { x: sin(θ/2), y: 0, z: 0, w: cos(θ/2) }
Qy(θ) = { x: 0, y: sin(θ/2), z: 0, w: cos(θ/2) }
```

**Important:** After computing the quaternion, normalize so `w > 0` — if `w < 0`, negate all four components (`q` and `-q` represent the same rotation, but the renderer uses the sign of `w` for orbit traversal direction).

**Examples from RP1 reference data:**

| Object | i | Ω | ω | Rotation quaternion |
|---|---|---|---|---|
| Earth System | 0° | — | 102.9° | (0, 0.782, 0, 0.623) — pure Y rotation |
| Mercury System | 7.0° | 48.3° | 29.1° | (0.060, 0.625, -0.010, 0.779) |
| Moon | 5.145° | ~0° | ~0° | (0.045, 0, 0, 0.999) — pure X tilt |

### Coordinate Systems (Terrestrial pCoord)

| bCoord | Name | Description |
|---|---|---|
| 0 | GEO | Geographic (lat/lon/alt) |
| 1 | CYL | Cylindrical |
| 2 | CAR | Cartesian |
| 3 | NUL | None — use raw transform values |

Default is NUL (3) when no geo-positioning is needed.

## Hierarchy Examples

### rp1-enter (Full Metaverse)

```
root
  └─ Universe (celestial:universe)
       └─ Milky Way (celestial:galaxy)
            └─ Solar System (celestial:star_system)
                 └─ Earth System (celestial:planet_system)
                      └─ Earth (celestial:planet)
                           └─ Earth Surface (celestial:surface)
                                └─ Earth Attachment Point (terrestrial)
                                     resourceReference: "earth.msf", resourceName: "metaversal"
```

### rp1-earth (Terrestrial Fabric)

```
root
  ├─ Africa (terrestrial)
  │    └─ campuses, sectors, parcels...
  ├─ Asia (terrestrial)
  ├─ Europe (terrestrial)
  ├─ North America (terrestrial)
  └─ ...
```

### Campus Fabric (e.g., spatial.patchedreality.com)

```
root
  ├─ Sector (terrestrial:sector)
  │    └─ Parcel (terrestrial:parcel)
  │         └─ Physical objects (physical)
  └─ Scene (physical) — legacy physical-root scenes
```

## Defaults

| Field | Default value |
|---|---|
| pOwner.twRPersonaIx | 1 |
| pType.bSubtype | 0 |
| pType.bFiction | 0 |
| pType.bMovable | 0 (physical only) |
| pCoord.bCoord | 3 / NUL (terrestrial only) |
| pOrbit fields | 0 (celestial only) |
| pProperties fields | 0 |
| position | {x:0, y:0, z:0} |
| rotation | {x:0, y:0, z:0, w:1} |
| scale | {x:1, y:1, z:1} |
| bound | {x:1, y:1, z:1} |
