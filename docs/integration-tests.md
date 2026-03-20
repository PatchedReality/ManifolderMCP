# Integration Tests

`ManifolderMCP` now includes opt-in live integration tests for `ManifolderClient`.

## Location

- `test/integration/ManifolderClient.integration.test.js`
- `test/integration/mcp-tools-e2e.integration.test.js` (non-live MCP tool-path integration; runs in `npm test`)

## Enable Tests

Integration tests are skipped by default. Enable the standard live suite with:

```bash
FABRIC_IT_ENABLED=1 npm run test:integration
```

When `FABRIC_IT_ENABLED` is not set, the integration test files print an explicit skip diagnostic to stderr so CI logs clearly show that live coverage did not run.

Earth attachment coverage is gated separately. Enable it with:

```bash
EARTH_IT_ENABLED=1 npm run test:integration
```

## Target Selection

Order of precedence:

1. Environment variables
2. Profile in `~/.config/manifolder-mcp/config.json`

### Environment variables

- `FABRIC_IT_URL` (or `FABRIC_URL`)
- `FABRIC_IT_ADMIN_KEY` (or `FABRIC_ADMIN_KEY`, optional)
- `EARTH_IT_ENABLED` to enable only the earth-attachment live tests
- `EARTH_IT_URL` for read-only Earth fabric coverage in earth-attachment tests
- `EARTH_IT_PROFILE` to resolve the Earth fabric target from config when `EARTH_IT_URL` is not set
- `EARTH_IT_TIMEOUT_MS` to cap Earth connection attempts (default: `15000`)
- `EARTH_IT_UNSAFE_HOSTS` comma-separated websocket hosts that should bypass TLS verification for Earth-only live tests

Example:

```bash
FABRIC_IT_ENABLED=1 \
FABRIC_IT_URL="https://your-host/path/fabric.msf" \
FABRIC_IT_ADMIN_KEY="your-admin-key" \
npm run test:integration
```

Earth-only example:

```bash
EARTH_IT_ENABLED=1 \
EARTH_IT_URL="https://cdn2.rp1.com/config/earth.msf" \
EARTH_IT_UNSAFE_HOSTS="prod-map-earth.rp1.com" \
npm run test:integration
```

Or using a profile (e.g., `rp1-earth`) that already has `unsafeHosts` configured:

```bash
EARTH_IT_ENABLED=1 \
EARTH_IT_PROFILE=rp1-earth \
EARTH_IT_UNSAFE_HOSTS="prod-map-earth.rp1.com" \
npm run test:integration
```

**Note:** `EARTH_IT_UNSAFE_HOSTS` is required for servers with self-signed or mismatched TLS certificates. The value is a comma-separated list of websocket hostnames to bypass TLS verification for. This is the equivalent of `NODE_TLS_REJECT_UNAUTHORIZED=0` but scoped to specific hosts.

### Profile-based config

If no env URL is set, tests load:

- `~/.config/manifolder-mcp/config.json`
- Profile name from `FABRIC_IT_PROFILE` (default: `default`)
- Profile name from `EARTH_IT_PROFILE` for the optional Earth attachment integration coverage

## Optional Destructive Write Test

Create/delete scene integration test is disabled by default.

Enable with:

```bash
FABRIC_IT_ENABLED=1 FABRIC_IT_WRITE=1 npm run test:integration
```

Optional:

- `FABRIC_IT_SCENE_TYPE` to force a specific scene type for `createScene`.

## Manual Live Fixture Recording

Record real action payloads/responses and notifications for unit-test fixture validation:

```bash
FABRIC_IT_PROFILE=default npm run test:record-fixtures
```

Optional overrides:

- `FABRIC_IT_URL` / `FABRIC_IT_ADMIN_KEY` (use env target instead of profile)
- `FABRIC_IT_RECORD_DIR` (default: `test/fixtures/manifolder/live`)
- `FABRIC_IT_RECORD_FILE` (explicit output file)
- `FABRIC_IT_SCENE_PREFIX` (default: `it-owned`)
- `FABRIC_IT_SCENE_TYPE` (scene object type for `createScene`)

Output:

- Timestamped fixture: `test/fixtures/manifolder/live/manifolder-live-<runId>.json`
- Latest snapshot: `test/fixtures/manifolder/live/latest.json`

Safety guarantees in recorder:

- Requires admin connection.
- Refuses write operations outside run-owned scene/object IDs.
- Uses run-unique names (`it-owned-<runId>-...`).
- Performs best-effort cleanup in `finally`.

Notes:

- Recorder currently skips `findObjects(namePattern)` capture because SEARCH availability is server/scope dependent.
