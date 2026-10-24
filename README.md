# linear-gsuite

Calendar automation engine that syncs [Linear](https://linear.app) issues and
recurring events into Google Calendar.

- Syncs Linear issues with due dates as all-day calendar events
- Syncs recurring operational events from JSON definitions
- Automatically removes calendar events when issues are completed or canceled
- Runs as a macOS `launchd` background agent or one-shot CLI
- Declarative setup via Home Manager (NixOS / nix-darwin)

## Quick start

```bash
# Install
pnpm install && pnpm build

# Authenticate with Google Calendar
linear-gsuite auth login --client-secrets-file ~/Downloads/client_secret_*.json

# Create a manifest (or use an example)
linear-gsuite doctor --config examples/tinyland-business-ops/linear-gsuite.package.json

# Sync
linear-gsuite calendar sync --config examples/tinyland-business-ops/linear-gsuite.package.json
```

Or via nix:

```bash
nix run github:tinyland-inc/linear-gsuite -- version
```

## Documentation

| Guide | Description |
|-------|-------------|
| [Getting Started](docs/guides/getting-started.md) | Install, authenticate, first sync |
| [Authentication](docs/guides/authentication.md) | OAuth desktop flow, service accounts, `_FILE` secret pattern |
| [Configuration](docs/guides/configuration.md) | Manifest schema, source types, identity keys |
| [CLI Reference](docs/guides/cli-reference.md) | All commands, flags, output format |
| [Home Manager](docs/guides/home-manager.md) | Declarative NixOS/nix-darwin setup |
| [Extending](docs/guides/extending.md) | Adding new source adapters |
| [Troubleshooting](docs/guides/troubleshooting.md) | Common issues and diagnostics |

## Source types

| Type | Description |
|------|-------------|
| `json-recurring-events` | Static recurring events from a JSON file |
| `linear-issues` | Linear issues with due dates, auto-removed on completion |

## Install surfaces

| Method | Command |
|--------|---------|
| **pnpm** | `pnpm install && pnpm build && pnpm link --global` |
| **nix run** | `nix run github:tinyland-inc/linear-gsuite -- <args>` |
| **nix develop** | `nix develop` for dev shell with all tooling |
| **Home Manager** | Import `homeManagerModules.default` ([guide](docs/guides/home-manager.md)) |

## Architecture

This repo is the **engine**. Consumer repos provide **manifests**.

```
Consumer repo                    linear-gsuite engine
├── linear-gsuite.package.json   → Source resolution
├── events.json                  → Google Calendar API (OAuth + service account)
└── business data                → Reconciliation, dedup, launchd lifecycle
```

The engine is source-agnostic: it syncs any `ResolvedCalendarEvent[]`
regardless of origin. New source adapters only need to produce that type.
See the [Extending guide](docs/guides/extending.md).

## Example manifest

```json
{
  "name": "my-calendar",
  "timezone": "America/New_York",
  "sources": [
    {
      "id": "recurring",
      "type": "json-recurring-events",
      "path": "./events.json"
    },
    {
      "id": "linear-due-soon",
      "type": "linear-issues",
      "apiKeyEnv": "LINEAR_API_KEY",
      "assignee": "me",
      "teamKey": "ENG",
      "dueWithinDays": 7
    }
  ]
}
```

## Development

```bash
pnpm install
pnpm run typecheck   # type check
pnpm test            # vitest (13 tests)
pnpm run build       # compile to dist/
just status          # toolchain overview
```

CI runs typecheck, test, build, and publint on every PR.

## License

MIT


### Private assistant calendar adapter

`createGoogleCalendarProvider` exposes Effect-backed `get`, `list`, `freeBusy`,
`createPrivate`, and `reschedule` operations for a caller-supplied calendar
allowlist. Supply `accessToken: () => Effect.Effect<string, CliError>` and
`jessEmail`; existing `refreshUserAccessToken` can resolve the token. No CLI
command or background service activates these operations automatically.

Reads require explicit offset timestamps, with windows of at most 31 days and
at most 1,000 events. Incomplete availability responses fail rather than implying
free time. Results retain provider identity, ETag and iCalUID when present.

`createPrivate` takes `calendarId`, `idempotencyKey`, `summary`, optional
`description`, `start`, `end`, and `timeZone`. It uses a stable provider identity
from `privateGoogleEventId(idempotencyKey)` and verifies duplicate-request
payloads. Calendar projection and assistant creation both set actual Google
`visibility: private`; private extended properties alone do not provide privacy.

`reschedule` takes `calendarId`, `eventId`, the last observed `etag`, `start`,
`end`, and `timeZone`. It fetches the latest event, then patches times with
`If-Match`. Only events created and organized by the configured Jess identity
can move automatically. Explicit `cadeCreatorEmails` additionally admit those
service identities only with matching Cade event ownership metadata. All-day
events, changes of duration, and missing or changed original timezone require
review. Events with attendees, locations, travel/appointment
wording, recurrence, non-default types, or another projection owner need review.
The caller must supply that review workflow; this adapter never bypasses it.

`CalendarProviderError.code` distinguishes conflicts, missing events, rejected
requests, read failures and unknown write outcomes. An unknown write outcome
must be reconciled with `get(calendarId, privateGoogleEventId(key))` (creation)
or the existing event ID (rescheduling) before another write. The adapter never
automatically retries ambiguous writes. Provider errors do not include response
bodies or credentials. Existing source projections retain their source ownership
and reconciliation behavior; assistant events use a separate `source: cade`.
