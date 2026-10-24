# TIN-7126 private calendar provider source receipt

repo | worktree/branch | integration | active machine | owner
linear-gsuite | /srv/fast-local/jess/git/linear-gsuite-worktrees/cade-private-calendar-20261024 / feat/cade-private-calendar-20261024 | xoxd-ai/linear-gsuite main | sting | calendar_integrations

Authority: Jess approved the Cade execution plan; root delegated provider-only
source implementation. R-HOOK-CONVERGENCE-20261004 preserves advisory hook
behavior. TIN-7126: https://linear.app/tinyland/issue/TIN-7126.

The root checkout was clean at b5e1672 and was preserved. The isolated worktree
started from fetched origin/main 7f2c15c. Jesssullivan fork lookup returned not
found; root authorized continuing the named existing origin branch without
changing remotes. All implementation commits are signed with sting's own key.

Reviewed source history: f09e3ed introduced the provider; review found timed-event
semantics and cancelled-idempotency bugs. 64a4b2c and 2c96c27 corrected those;
independent review approved exact 2c96c272f2ed7e8ab853b9f7764a832d6977025e
with 37 tests independently passing. The subsequent bounded-reminder delta
requires its own independent review before live acceptance.

Capabilities: private projection serialization; allowlisted bounded event reads
and freebusy; stable assistant-event IDs; private creation with optional bounded
popup/email reminders; ETag-protected rescheduling. Movement preserves duration,
timed type and original explicit timezone, and refuses attendees, locations,
travel/appointment wording, recurring instances and foreign projections. Cade
service creators require explicit configured identity plus exact ownership
metadata. Unknown write outcomes never automatically replay.

Validation uses existing just typecheck/test/build recipes with
LINEAR_GSUITE_BUILD=pnpm and tinyland-heavy, plus pnpm check:package. No new test
runner was introduced; regressions extend tests/google.test.ts. Build artifacts
remain untracked. No live calendar calls, runtime deployment, merge or OAuth
configuration changes were made by this provider lane.

Runtime and acceptance ownership stay with Cade and the root's
calendar_live_acceptance lane. Provider acceptance is not proof of a delivered
phone/desktop alarm. Native OAuth and managed-config saving are a disjoint auth
lane. The finance source sync reaper must not be replayed as an acceptance test.
