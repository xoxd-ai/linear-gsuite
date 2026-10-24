# TIN-7126: native calendar metadata provider artifact

repo | worktree/branch | integration | active machine | owner
linear-gsuite | /srv/fast-local/jess/git/linear-gsuite-worktrees/cade-native-39d5337-receipt-20261024 / docs/cade-native-provider-39d5337-receipt-20261024 | PR17 merged f500e520abf16726b8fdb94a5d43e7030983562d | Neo build / Sting receipt | calendar_integrations/native_provider_9eab

Root explicitly authorized this native artifact lane under
R-HOOK-CONVERGENCE-20261004. Exact accepted source
`39d53373d0888d7f5037abbe272bf1c4db3d47b6` was checked out clean and detached
at `/Users/jess/git/linear-gsuite-worktrees/cade-native-39d5337`; signature GOOD.
The managed PZM offer was OPEN with fresh no-hold evidence (70-second export),
57.5 GB free, existing cap 1 and Neo max-jobs 0. No builder, trust, hold or cap
setting changed. Existing roots/remotes/dirty work were preserved.

Exact official build, exit 0, through the existing managed ssh-ng PZM builder:

    just nix-build /Users/jess/git/linear-gsuite-worktrees/cade-native-39d5337#packages.aarch64-darwin.default --out-link /tmp/cade-provider-neo-39d5337 --print-out-paths

- Source: `39d53373d0888d7f5037abbe272bf1c4db3d47b6`.
- Closure: `/nix/store/mksj0gqh9sblsvk9kw15ban0ag6hkvq7-linear-gsuite-0.1.0-dev+39d5337`.
- NAR: `sha256-spHU3xgyjedGf4nQ5kMwFqwTejzw/yI3HFaXLV1Qcts=`.
- Deriver: `/nix/store/23qh6yb8syfhpcv86ch8vjyb7pvy4gpl-linear-gsuite-0.1.0-dev+39d5337.drv`.
- Build identity: revision 39d5337, source nix, dirty false.
- Native Node: `/nix/store/jp1j44w4fvrxvx62fasairgwv80iw6x3-nodejs-22.22.2/bin/node`, darwin/arm64, version 22.22.2.
- Immutable manifest: `/nix/store/7jzc2v1pn79gdwvqzjsbfiknfwksdcap-cade-provider-39d5337-aarch64-darwin-manifest.json`.
- Manifest SHA256: `68c928ffb97e9b463918e2e63c1940bf479321ccd238fcdd6c1e36e337c7c670`.

Exact manifest bytes are tracked at
`docs/artifacts/cade-provider-39d5337-aarch64-darwin.json`.
Owned directory
`/Users/jess/.local/state/tinyland/cade-provider-artifacts/39d5337-aarch64-darwin`
contains indirect GC roots `provider` and `manifest-store`, manifest.json and
credential-free config-pair.json. These do not activate the artifact.

Native fixture imported actual provider and Effect modules from this immutable
closure, from /private/tmp with native Node. `listCalendarMetadata()` passed a
two-page fake GET qualification with owner, hidden and deleted metadata rows:
2 pages, 3 calendars, 2 fake calls, zero live calls. Global live fetch was
forbidden. Independent reviewer calendar_source_review returned ARTIFACT GO:
manifest SHA, actual NAR, full source hash and clean build identity all matched;
its own two-page, three-calendar fixture passed using actual immutable provider
and native Node 22.22.2 arm64, with names excluded and two synthetic/zero live
calls. No credentials or active configuration were accessed.

Only this note and the credential-free manifest are transferred to the new
isolated Sting receipt worktree based on merged PR17 for its own normal signing
subkey. No OAuth or private configuration was transferred. No credentials, real
API reads, calendar events, active config or service were touched. Existing
read-only service port 43128 remains untouched. Root/parent retains actual
metadata read, activation and all live acceptance actions after ARTIFACT GO.
