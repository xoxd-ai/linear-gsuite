# TIN-7126: scoped calendar availability provider

repo | worktree/branch | integration | active machine | owner
linear-gsuite | /srv/fast-local/jess/git/linear-gsuite-worktrees/calendar-availability-projection-20261024 / fix/calendar-availability-projection-20261024 | canonical PR pending, root retains merge | Sting | calendar_integrations/native_provider_9eab

Root explicitly authorized source for all-16 availability, 15 detail-calendar
reads and primary-owner-only writes, under R-HOOK-CONVERGENCE-20261004. This
provider lane contains no real IDs, credentials, API calls or deployment.

Exported ProviderBusyInterval and ProviderAvailability project only requested
calendar IDs and busy start/end intervals, plus response time bounds if present.
Availability has an independent optional allowlist defaulting to the detail
allowlist; get/list/write remain scoped to calendarIds. Duplicate/foreign IDs,
missing or malformed rows, API errors, invalid explicit timestamps, nonpositive
or out-of-window intervals and mismatched returned bounds fail closed.

Validation: fresh SHA-verified existing tinyland-heavy helper, default caps/queue,
Node heap 256 MiB; typecheck, all 80 tests, build and publint passed. Existing
node_modules was linked from the qualified provider lane; no dependency change.
No repeated suite needed for documentation-only followup. Source review and
root's guarded merge precede native packaging/activation. No live API, OAuth,
config, event or service changes; read-only43128 remains untouched.
