# AGENTS.md

## What this repo is

`linear-gsuite` is a calendar automation engine that syncs Linear issues and
recurring events into Google Calendar. It is a library and CLI, not a
business-data repo. Consumer repos (e.g. `finances`) provide manifests;
this repo provides the engine.

## Dev setup

```bash
pnpm install
pnpm run typecheck   # type check src + tests
pnpm test            # vitest
pnpm run build       # compile to dist/
```

Or via nix: `nix develop` gives you node 22, pnpm 9, bazel, and just.

`just build`, `just typecheck` and `just test` use pnpm. Set
`LINEAR_GSUITE_BUILD=bazel` to run the same steps on local Bazel. That run is
local and non-qualifying (no flywheel lane is enrolled), and `.bazelrc` stops
its server after 120 s idle.

## Architecture

```
src/
  cli.ts       CLI entrypoint — parses args, dispatches to google/launchd/config
  config.ts    Manifest loading, source resolution, config discovery
  google.ts    Google Calendar API — OAuth, sync loop, reconciliation, dedup
  linear.ts    Linear GraphQL — issue fetching, filtering, calendar projection
  launchd.ts   macOS launchd plist generation and lifecycle
  types.ts     All public types — CalendarPackageManifest, SyncOptions, etc.
  utils.ts     File I/O, env hydration (_FILE pattern), error constructors
  version.ts   Build identity from package.json + build-info.json
```

Key patterns:
- **Effect.ts** for all async/error flows — `Effect.gen`, `Effect.fail`, `yield*`
- **Stateless sync** — no local database; GCal is the source of truth
- **Extended properties** on GCal events: `source=linear-gsuite`, `sync_id`, `source_id`, `google_event_id`
- **Deterministic IDs** via `stableGoogleEventId(identityKey)` = `lgs<SHA1>`
- **Source adapters** — `json-recurring-events` and `linear-issues` today; the pattern is extensible

## Extending with new source types

To add a new source adapter (e.g. `linear-projects`, `linear-initiatives`):

1. Add the source interface to `types.ts` (see `LinearIssuesSource`)
2. Add a resolver function in a new or existing module (see `resolveLinearIssuesSource`)
3. Register the source type in `config.ts` `loadCalendarDefinition` (see the `linear-issues` branch)
4. The resolver must return `ResolvedCalendarEvent[]` — the sync loop handles the rest

The sync loop in `google.ts` `syncCalendar` is source-agnostic. It operates
on `ResolvedCalendarEvent` regardless of origin. New adapters only need to
produce that type.

## Sync lifecycle

1. `resolveRuntime` loads config, resolves all sources into `ResolvedCalendarEvent[]`
2. For each event: GET canonical GCal event by stable ID → PUT (update) or POST (create)
3. `pruneSyncIdDuplicates` cleans up duplicate events per identity
4. `reconcileStaleEvents` queries GCal per active source, deletes orphans not in the current set

## Testing

Tests are in `tests/` using vitest. The established pattern mocks `fetch` globally:

```typescript
vi.stubGlobal("fetch", fetchMock);
await Effect.runPromise(syncCalendar(options, tempDir));
```

`mapLinearIssuesToEvents` is a pure function — test it directly without mocks.

## Conventions

- Prefer `Effect.gen` + `yield*` over `.pipe` chains
- Tab-separated stdout for machine-readable sync output (e.g. `updated\tTIN-452`)
- Errors go through `fail()` → `CliError` → `Effect.fail`
- `_FILE` env var pattern for secrets (never log secret values)
- No comments unless the WHY is non-obvious
- Run `pnpm run typecheck && pnpm test` before committing

## CI

GitHub Actions runs on every PR to main: typecheck, test, build, publint.

## Manifest schema

See `examples/` for complete working manifests. The canonical type is
`CalendarPackageManifest` in `types.ts`.
