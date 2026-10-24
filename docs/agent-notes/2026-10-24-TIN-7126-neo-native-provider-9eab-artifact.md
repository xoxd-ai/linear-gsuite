# TIN-7126: native Neo provider 9eab artifact

repo | worktree/branch | integration | active machine | owner
linear-gsuite | /srv/fast-local/jess/git/linear-gsuite-worktrees/cade-native-9eab-receipt-20261024 / docs/cade-native-provider-9eab-sting-receipt-20261024 | xoxd-ai/linear-gsuite PR16 | Neo artifact / Sting receipt | calendar_integrations/native_provider_9eab

Root explicitly authorized this parallel native artifact delivery under
R-HOOK-CONVERGENCE-20261004. Provider PR16 is merged; accepted signed source
`9eab75363ac3378dac087aade7f4b068860c74be` was checked out clean and detached at
`/Users/jess/git/linear-gsuite-worktrees/cade-native-9eab753`. Its signature was
verified and ancestry in origin/main confirmed. No remotes were changed.

The existing managed PZM offer was OPEN, with fresh no-hold export evidence,
57.5 GB free, existing builder cap 1 and Neo max-jobs 0. The separate direct
`just pzm-hold-status` SSH probe closed its connection; its failure was recorded
as diagnostic, and the managed offer's hold/headroom evidence was retained.
No hold, cap, trust or builder setting changed. Cache timeouts retried normally.

Exact source build, successful exit 0:

    just nix-build /Users/jess/git/linear-gsuite-worktrees/cade-native-9eab753#packages.aarch64-darwin.default --out-link /tmp/cade-provider-neo-9eab753 --print-out-paths

Nix built dependency preparation and the package through the existing managed
ssh-ng PZM builder and registered the returned output normally on Neo.

- Closure: `/nix/store/3xlnif57llmfyl572a4d6vp6grsrw34b-linear-gsuite-0.1.0-dev+9eab753`.
- NAR hash: `sha256-P46Jh2RKYH3CxcTwXst+RJYM1bKNRGkVI3cDNoJJmnE=`.
- Deriver: `/nix/store/k4i8rainnradnpk593x47187856bwamz-linear-gsuite-0.1.0-dev+9eab753.drv`.
- Build identity: revision 9eab753, source nix, dirty false.
- Native Node: `/nix/store/jp1j44w4fvrxvx62fasairgwv80iw6x3-nodejs-22.22.2/bin/node`, Mach-O arm64, version 22.22.2.
- Immutable manifest: `/nix/store/jb1w30bx7w7gnng4q4ghpi7snsp2rh4v-cade-provider-9eab753-aarch64-darwin-manifest.json`.
- Manifest SHA256: `ab2542ff18ee74a717f9a6ced186ceaa454770f0f2faf95080be6101f9e385e1`.

Exact manifest bytes are tracked at
`docs/artifacts/cade-provider-9eab753-aarch64-darwin.json`.
Owned directory
`/Users/jess/.local/state/tinyland/cade-provider-artifacts/9eab753-aarch64-darwin`
contains ordinary indirect GC roots `provider` and `manifest-store`, a manifest
copy and a credential-free `config-pair.json` for root's later configuration.
Cade's existing manifest loader accepts this schema and source pin without an
application source change.

Native qualification imported the actual provider and Effect modules from the
new closure, outside checkouts in /private/tmp, using the closure's Node.
One injected fake GET passed, retaining `attendeesOmitted: true`; global live
fetch was forbidden. Result: darwin/arm64, Node 22.22.2, fake GET PASS, one fake
call, zero live calls. Independent reviewer `calendar_source_review` returned
ARTIFACT GO after verifying manifest SHA, actual NAR, full source hash and clean
build identity, and running its own inline fake GET from /private/tmp against
this immutable provider with native Node 22.22.2 arm64. That independent test
also preserved `attendeesOmitted: true`, with one synthetic and zero live calls.

This is artifact proof only. No OAuth/credential files, calendar events, active
configuration or service were read or changed. Existing read-only port 43128
remains untouched; root retains activation and any live acceptance action.

Neo's normal signed receipt commit timed out in tinyland-gpg-sign after 120s
waiting for GPG/pinentry. No agent or signing service was restarted. The shell
subsequently pushed the initial receipt branch at old `374cecb`, so that branch
does not contain this receipt. Parent authorized transfer of only this note and
the exact credential-free manifest to the new isolated Sting receipt worktree
above, based on matching `374cecb`, for normal signing by Sting's own subkey.
No private configuration or OAuth material was transferred.
