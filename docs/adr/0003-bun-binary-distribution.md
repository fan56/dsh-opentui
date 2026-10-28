# ADR-0003: Bun single process, compiled binary distribution

Date: 2026-10-28
Status: accepted

## Context

OpenTUI's native core is Zig, distributed via platform packages, and its
first-class runtime is Bun (Node 26.4 + `--experimental-ffi` also works
but is bleeding-edge for our users). dsh-tui-pi embeds the host in its
own process; the host has no detached form, so the TUI owns the process.

## Decision

- Run on **Bun in a single process** that embeds the cordis host.
- Distribute as a **standalone compiled binary** via `Bun.build` +
  `@opentui/solid/bun-plugin` + `compile` (verified in M0: darwin-arm64
  96 MB; linux-arm64 musl 120 MB, runs in alpine with `libstdc++`).
- npm distribution is deferred.

## Consequences

- Cross-compiling linux needs the target `@opentui/core-<plat>` native
  packages present on the build machine (they are optionalDependencies,
  not installed on mismatched hosts — fetch tarballs explicitly).
- A compiled binary must not run with a `bunfig.toml` preload in its
  CWD (it fails with "preload not found"); distribution runs from clean
  directories.
- Tests use `bun test`; CI runs on mac + linux runners.
