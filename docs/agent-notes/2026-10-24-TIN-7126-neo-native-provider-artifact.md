# TIN-7126: native Neo calendar provider artifact

repo | worktree/branch | integration | active machine | owner
linear-gsuite | /Users/jess/git/linear-gsuite-worktrees/cade-native-provider-receipt-20261024 / docs/cade-native-provider-artifact-20261024 | xoxd-ai/linear-gsuite | neo | calendar_integrations

Root authorized native artifact delivery from reviewed source
07885a2d35914f4512a4d10ca0485ee1519d9b63 after the Linux artifact leaf was
correctly rejected by Neo's normal Nix signature policy. No trust bypass,
signing-key creation or borrowed developer dist was used. Authority:
R-HOOK-CONVERGENCE-20261004; root's named native-artifact delivery instruction.
Tracker: https://linear.app/tinyland/issue/TIN-7126.

The source was checked out clean and detached at
/Users/jess/git/linear-gsuite-worktrees/cade-native-07885a2; its signature was
verified. `just pzm-hold-status` reported no set markers. Neo's managed builder
offer was OPEN with fresh headroom/hold evidence; max-jobs remained 0 locally,
and the existing PZM builder cap remained 1. The dry run required only locked
pnpm dependency preparation and the JS package, plus cached native dependencies.

Exact build:

    just nix-build /Users/jess/git/linear-gsuite-worktrees/cade-native-07885a2#packages.aarch64-darwin.default --out-link /tmp/cade-provider-neo-07885a2 --print-out-paths

Nix used its existing ssh-ng PZM builder and normal daemon output registration.
No builders, trust flags, host profiles or services were changed.

- Source commit: `07885a2d35914f4512a4d10ca0485ee1519d9b63`.
- Native output: `/nix/store/ay488rccnp8krnkn72hwinrf3as74vfz-linear-gsuite-0.1.0-dev+07885a2`.
- NAR hash: `sha256-qUXbP7FErDkTZrY4gjT/VNqOrUBjzWnPTWgh4DA2HII=`.
- Build identity: source nix, revision 07885a2, dirty false.
- Node: `/nix/store/jp1j44w4fvrxvx62fasairgwv80iw6x3-nodejs-22.22.2/bin/node`, Mach-O arm64.
- Immutable manifest: `/nix/store/1a9ryycyk80233nrb86jh52gqka6fyhd-cade-provider-07885a2-aarch64-darwin-manifest.json`.
- Manifest SHA256: `4ec70d3eb44beec3457b5331cf0c559761e716bfb6fc2934b8ba1eb626d60a1d`.

The exact manifest bytes are tracked in
`docs/artifacts/cade-provider-07885a2-aarch64-darwin.json`.

The owned state directory
`/Users/jess/.local/state/tinyland/cade-provider-artifacts/07885a2-aarch64-darwin`
contains manifest.json and config-pair.json. Its provider and manifest-store
symlinks are ordinary indirect Nix GC roots preserving the qualified artifacts.
The pair contains only CalendarRuntimeConfig manifestFile and manifestSha256;
root applies these to the private app configuration while preserving its existing
credential handles. No OAuth files were read or transferred by this lane.

Qualification ran Node 22.22.2 from the native closure outside all checkouts,
with cwd /private/tmp. It imported the actual provider and Effect modules from
the immutable store and executed a single injected fake GET. Result: native
darwin/arm64, fakeGet PASS, liveCalls 0. This verifies artifact loading and
provider execution; real Calendar reads and application activation remain root's
separate acceptance actions. No extra live calendar events were written.
