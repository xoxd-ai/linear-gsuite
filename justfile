set shell := ["bash", "-euo", "pipefail", "-c"]
set dotenv-load
set positional-arguments

root := justfile_directory()
# pnpm is the default. LINEAR_GSUITE_BUILD=bazel opts in to local,
# non-qualifying Bazel: no flywheel lane is enrolled, so it starts a local
# server that .bazelrc bounds (TIN-5770, R471).
build_system := env("LINEAR_GSUITE_BUILD", "pnpm")
default: status

[doc("Show local toolchain status")]
status:
    @echo "linear-gsuite"
    @echo "  node: $$(node --version 2>/dev/null || echo missing)"
    @echo "  pnpm: $$(pnpm --version 2>/dev/null || echo missing)"
    @echo "  bazel: $$(bazel --version 2>/dev/null | head -1 || echo missing)"
    @echo "  nix: $$(nix --version 2>/dev/null || echo missing)"

[doc("Install JS dependencies")]
install:
    cd {{ root }} && pnpm install

[doc("Build the CLI")]
build:
    #!/usr/bin/env bash
    set -euo pipefail
    cd {{ root }}
    if [[ "{{ build_system }}" == "bazel" ]] && command -v bazel >/dev/null 2>&1; then
        echo "bazel: local, non-qualifying (R471)" >&2
        bazel build //:pkg
    else
        pnpm build
    fi

[doc("Typecheck the repo")]
typecheck:
    #!/usr/bin/env bash
    set -euo pipefail
    cd {{ root }}
    if [[ "{{ build_system }}" == "bazel" ]] && command -v bazel >/dev/null 2>&1; then
        echo "bazel: local, non-qualifying (R471)" >&2
        bazel build //:typecheck
    else
        pnpm typecheck
    fi

[doc("Run tests")]
test:
    #!/usr/bin/env bash
    set -euo pipefail
    cd {{ root }}
    if [[ "{{ build_system }}" == "bazel" ]] && command -v bazel >/dev/null 2>&1; then
        echo "bazel: local, non-qualifying (R471)" >&2
        bazel test //:test
    else
        pnpm test
    fi

[doc("Run the CLI against the example package")]
doctor config="examples/tinyland-business-ops/linear-gsuite.package.json":
    cd {{ root }} && pnpm exec tsx src/cli.ts doctor --config {{ config }}

[doc("Run arbitrary linear-gsuite CLI arguments")]
run *args="":
    cd {{ root }} && pnpm exec tsx src/cli.ts {{ args }}

[doc("Authenticate Google Calendar desktop OAuth")]
auth-login *args="":
    cd {{ root }} && pnpm exec tsx src/cli.ts auth login {{ args }}

[doc("Show auth status")]
auth-status *args="":
    cd {{ root }} && pnpm exec tsx src/cli.ts auth status {{ args }}

[doc("List visible calendars")]
calendar-list *args="":
    cd {{ root }} && pnpm exec tsx src/cli.ts calendar list-calendars {{ args }}

[doc("Sync example package into Google Calendar")]
sync config="examples/tinyland-business-ops/linear-gsuite.package.json" *args="":
    cd {{ root }} && pnpm exec tsx src/cli.ts calendar sync --config {{ config }} {{ args }}

[doc("Show currently synced events")]
show-events *args="":
    cd {{ root }} && pnpm exec tsx src/cli.ts calendar show-events {{ args }}

[doc("Install the launchd sync agent from the built CLI")]
launchd-install config="examples/tinyland-business-ops/linear-gsuite.package.json":
    cd {{ root }} && pnpm build && node dist/cli.js launchd install sync --config {{ config }}

[doc("Show launchd sync agent status")]
launchd-status config="examples/tinyland-business-ops/linear-gsuite.package.json":
    cd {{ root }} && node dist/cli.js launchd status sync --config {{ config }}

[doc("Remove the launchd sync agent")]
launchd-uninstall config="examples/tinyland-business-ops/linear-gsuite.package.json":
    cd {{ root }} && node dist/cli.js launchd uninstall sync --config {{ config }}

[doc("Build the flake package")]
nix-build:
    cd {{ root }} && nix build

[doc("Run the packaged CLI via nix run")]
nix-run *args="":
    cd {{ root }} && nix run . -- {{ args }}

[doc("Enter the flake dev shell")]
nix-shell:
    cd {{ root }} && nix develop

[doc("Run flake checks")]
nix-check:
    cd {{ root }} && nix flake check
