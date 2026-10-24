# TIN-7126: native scoped availability provider artifact

repo | worktree/branch | integration | active machine | owner
linear-gsuite | /srv/fast-local/jess/git/linear-gsuite-worktrees/cade-native-f3341d3-receipt-20261024 / docs/cade-native-provider-f3341d3-receipt-20261024 | PR18 merged fb6413c7ab12254d47b076a96ee1e6cc7a79cd35 | Neo build / Sting receipt | calendar_integrations/native_provider_9eab

Root explicitly authorized the guarded PR18 merge and native artifact lane under
R-HOOK-CONVERGENCE-20261004. Fresh checks confirmed exact reviewed signed head
`f3341d337bcba5375d71e6c6d2a8884b4cdaebaf`, clean worktree, GOOD signature,
all four CI checks green, CLEAN/MERGEABLE and no required checks configured.
Normal `gh pr merge --merge --match-head-commit` succeeded without admin/bypass
at 2026-10-24T15:29:09Z, producing merge fb6413c7ab12254d47b076a96ee1e6cc7a79cd35.

Exact accepted source was checked out clean and detached at
`/Users/jess/git/linear-gsuite-worktrees/cade-native-f3341d3`; signature GOOD.
Managed PZM offer OPEN with fresh no-hold evidence, 57.5 GB free, builder cap 1,
Neo max-jobs 0. Trust, holds, builders and caps unchanged. Official build exit 0:

    just nix-build /Users/jess/git/linear-gsuite-worktrees/cade-native-f3341d3#packages.aarch64-darwin.default --out-link /tmp/cade-provider-neo-f3341d3 --print-out-paths

Existing managed ssh-ng PZM builder produced the dependency preparation and
package; Neo registered the returned closure normally.

- Source: `f3341d337bcba5375d71e6c6d2a8884b4cdaebaf`.
- Closure: `/nix/store/b160zrzgak7bfgm267vnd3l7vyxj7h2l-linear-gsuite-0.1.0-dev+f3341d3`.
- NAR: `sha256-VUG3j3AvazTEx7iEd72Na8iLgBrNpjoB/mLeie61izU=`.
- Deriver: `/nix/store/x9n6c3g6zy2xfgikz5fhzb7gk31czg4i-linear-gsuite-0.1.0-dev+f3341d3.drv`.
- Build identity: revision f3341d3, source nix, dirty false.
- Node: `/nix/store/jp1j44w4fvrxvx62fasairgwv80iw6x3-nodejs-22.22.2/bin/node`, darwin/arm64, version 22.22.2.
- Immutable manifest: `/nix/store/bp81qbsd3hgf3zys57bvqz8g6pgp6ikw-cade-provider-f3341d3-aarch64-darwin-manifest.json`.
- Manifest SHA256: `d592c09c6da47cdf0f899a0b035f559098aa63d6891838b56fb2826d97e72cad`.

Exact manifest is tracked in docs/artifacts/cade-provider-f3341d3-aarch64-darwin.json.
Owned state directory
`/Users/jess/.local/state/tinyland/cade-provider-artifacts/f3341d3-aarch64-darwin`
contains indirect GC roots provider/manifest-store, manifest.json and a
credential-free config-pair.json. These do not activate the artifact.

Native qualification imported actual provider and Effect from the new closure
outside checkouts with its native Node. Synthetic scope: 16 availability IDs,
15 event-detail IDs. Valid freeBusy projection passed, foreign/private fields
were excluded, busy-only event GET was rejected before transport, and incomplete
availability failed closed. Two fake calls, zero live calls. Independent
artifact reviewer calendar_source_review returned ARTIFACT GO, independently
matching manifest SHA, actual NAR, full source and clean identity. Its own actual
new-closure fixture passed 16 availability / 15 detail, busy-only GET denied
before transport, foreign/private projection exclusion and incomplete rejection:
two fake calls, zero live calls, native Node 22.22.2 arm64.

Only this note/public manifest transfer to isolated Sting receipt worktree for
normal signing with Sting's own subkey. No credentials/OAuth or private config
transferred. No real API calls, events, active config/services or read-only43128
changes. Parent/root retains actual API qualification and separate activation.
