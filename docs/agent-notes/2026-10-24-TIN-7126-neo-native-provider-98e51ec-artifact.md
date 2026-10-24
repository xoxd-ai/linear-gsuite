# TIN-7126: native partial availability provider

repo | worktree/branch | integration | active machine | owner
linear-gsuite | /srv/fast-local/jess/git/linear-gsuite-worktrees/cade-native-98e51ec-receipt-20261024 / docs/cade-native-provider-98e51ec-receipt-20261024 | PR19 merged f9025f467c0b81dda83d98d38879286e187daa04 | Neo build / Sting receipt | calendar_integrations/native_provider_9eab

Root authorized normal guarded PR19 merge and native artifact delivery under
R-HOOK-CONVERGENCE-20261004. Fresh checks: exact reviewed head
98e51ecfcffd50bbabc65bb58854be93c6a8b6a0, clean worktree, GOOD signature,
four green CI checks, CLEAN/MERGEABLE, no required checks configured. Normal
`gh pr merge --merge --match-head-commit` succeeded without admin/bypass at
2026-10-24T15:49:03Z, producing f9025f467c0b81dda83d98d38879286e187daa04.

Clean detached source /Users/jess/git/linear-gsuite-worktrees/cade-native-98e51ec
was signature verified. Managed PZM offer OPEN: fresh no-hold evidence (67-second
export), 55.5 GB free, cap1; Neo max-jobs0. No trust/holds/builders/caps changed.
Official build via existing managed ssh-ng PZM builder, exit0:

    just nix-build /Users/jess/git/linear-gsuite-worktrees/cade-native-98e51ec#packages.aarch64-darwin.default --out-link /tmp/cade-provider-neo-98e51ec --print-out-paths

- Source: `98e51ecfcffd50bbabc65bb58854be93c6a8b6a0`.
- Closure: `/nix/store/03pnpkxi8bjfa50zsy0njk7lz6z7wlf0-linear-gsuite-0.1.0-dev+98e51ec`.
- NAR: `sha256-Fc85r/7c+Y6icgUyqYHNCGxuiN55CG/g9/0I7RNlgQg=`.
- Deriver: `/nix/store/18rl16swvxrs2aldmzp26ffll93v21lc-linear-gsuite-0.1.0-dev+98e51ec.drv`.
- Build identity: revision98e51ec, source nix, dirty false.
- Node: `/nix/store/jp1j44w4fvrxvx62fasairgwv80iw6x3-nodejs-22.22.2/bin/node`, darwin/arm64,22.22.2.
- Immutable manifest: `/nix/store/qnbgr0bdlbm3llqiafm8g9pzafw98y6a-cade-provider-98e51ec-aarch64-darwin-manifest.json`.
- SHA256: `e947316de64d54c6229f9475095a82a62bf05d69176f1a0850e0167d607d7ade`.

Exact manifest tracked at docs/artifacts/cade-provider-98e51ec-aarch64-darwin.json.
Owned state /Users/jess/.local/state/tinyland/cade-provider-artifacts/98e51ec-aarch64-darwin
contains indirect provider/manifest-store GC roots, manifest copy and credential-
free config-pair.json. This does not activate anything.

Worker fixture imported actual new provider/Effect with native Node outside
checkouts. Typed CalendarAvailabilityPartialError survived Effect.runPromise:
14 resolved calendars,2 unresolved. Exact minimal fields/two-page listAvailability
without ETags passed, including all-day/floating/unresolved times. Busy-only
list denied before transport, HTTP200 error envelope rejected:4fake,0live calls.
Independent reviewer calendar_source_review returned ARTIFACT GO: manifest SHA,
actual NAR, full source and dirty:false matched. Its own native22.22.2arm64
fixture independently passed typed14/2 partition, minimal two-page listing without
ETags/titles, HTTP200 error rejection and busy-only listing denial:4fake,0live.

Only this note/public manifest transfer to isolated Sting receipt worktree for
normal own-subkey signing. No credentials/OAuth/private config transferred or
read. No actual API calls/events/config/service changes;43128 remains untouched.
Parent alone owns root-authorized two fallback probes after ARTIFACT GO.
