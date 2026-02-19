# Integration Tests

`fabric-mcp` now includes opt-in live integration tests for `ManifolderClient`.

## Location

- `test/integration/ManifolderClient.integration.test.js`

## Enable Tests

Integration tests are skipped by default. Enable with:

```bash
FABRIC_IT_ENABLED=1 npm run test:integration
```

## Target Selection

Order of precedence:

1. Environment variables
2. Profile in `~/.config/fabric-mcp/config.json`

### Environment variables

- `FABRIC_IT_URL` (or `FABRIC_URL`)
- `FABRIC_IT_ADMIN_KEY` (or `FABRIC_ADMIN_KEY`, optional)

Example:

```bash
FABRIC_IT_ENABLED=1 \
FABRIC_IT_URL="https://your-host/path/fabric.msf" \
FABRIC_IT_ADMIN_KEY="your-admin-key" \
npm run test:integration
```

### Profile-based config

If no env URL is set, tests load:

- `~/.config/fabric-mcp/config.json`
- Profile name from `FABRIC_IT_PROFILE` (default: `default`)

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
