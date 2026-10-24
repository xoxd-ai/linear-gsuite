# TIN-7126: typed partial availability and minimal listing

repo | worktree/branch | integration | active machine | owner
linear-gsuite | /srv/fast-local/jess/git/linear-gsuite-worktrees/calendar-partial-availability-20261024 / feat/calendar-partial-availability-20261024 | reviewed source PR pending | Sting | calendar_integrations/native_provider_9eab

Root authorized a typed partial-error contract and minimal-field fallback source
under R-HOOK-CONVERGENCE-20261004. This lane performs no actual API calls and
contains no real calendar identifiers. Parent owns any later authorized probes.

CalendarAvailabilityPartialError extends CalendarProviderError(read-failed),
kind calendar-availability-partial, with validated partialAvailability and
unresolvedCalendarIds. Only syntactically valid per-calendar API error rows
qualify; all requested rows validate before throwing, and missing/malformed rows
or intervals stay generic failures. No raw API body or IDs enter the message.
freeBusy always rejects when any requested row remains unresolved.

listAvailability uses the existing detail allowlist and exact minimal fields:
nextPageToken,items(id,status,start,end,transparency,recurringEventId,originalStartTime).
No ETag required; duplicate IDs/tokens, malformed pages and bounded pagination
fail closed. Projected calendarId/eventId and temporal/status/transparency/series
fields preserve all-day/floating/unresolved data for consumer normalization.
No titles, attendees or descriptions returned; get/list remain unchanged.

Validation through fresh SHA-verified qualified heavy helper with default queue,
unchanged caps and 256MiB Node heap: typecheck, all92 tests, build and publint.
No dependency/config/service/OAuth/event changes. Independent source review and
root guarded merge precede native artifact and parent-only live acceptance.

Independent review caught HTTP200 top-level error bodies being treated as empty
availability. Added an explicit error/errors guard before absent-items handling
and two regression cases; valid empty responses without items remain supported.
