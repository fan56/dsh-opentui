# dsh-opentui

A next-generation TUI **platform** for [dsh](https://github.com/deepseek-ai/dsh) —
new architecture, not a reskin of dsh-tui-pi. Built on
[OpenTUI](https://github.com/anomalyco/opentui) + [Solid](https://solidjs.com),
running on Bun.

The repo's product is the **architecture**; the shipped Shell is a working
chat agent TUI on top of it, distributed as a **client-only** package: a thin
OpenTUI client that talks to a resident dsh host over the host's remote API.

| Package | What it is |
|---|---|
| `@dsh-opentui/runtime` | Engine lifecycle, cordis `surface` service, stdout capture, protocol types |
| `@dsh-opentui/kit` | Shared components: theme tokens, `t()` i18n seam, status bar, panel, line |
| `@dsh-opentui/shell` | **Usable chat TUI**: ask → thinking stream → tool approval → reply |

See [CONTEXT.md](CONTEXT.md) for the glossary and [docs/adr/](docs/adr/)
for decisions: Solid (0001), two integration channels with no compat shim
(0002), Bun single-process distribution (0003), host profile route (0004),
client mode (0005).

## Install

Prerequisites:

- [Bun](https://bun.sh) >= 1.3.14 (`npm i -g bun`) — the client bundle's runtime
- The dsh CLI (`npm i -g @deepseek-ai/dsh`) — the session carrier (profile storage, config, model access)
- Node >= 26.4 — runs the `dsh-opentui` launcher itself

```bash
npm i -g @aiwayds/dsh-opentui
dsh-opentui
```

## Client mode

`dsh-opentui` starts a thin client TUI (`dist/client/index.js` under Bun) that
connects to a resident `dsh --profile opentui` host process. The launcher
handles everything on first run:

- **Profile bootstrap** — if `$DSH_HOME/profiles/opentui` is missing it is
  provisioned idempotently. Pass `--provider` / `--model` /
  `--reasoning-effort` on first launch to pin a different default model
  (default `zai-coding-cn/glm-5.3-flash/high`).
- **Legacy migration** — a pre-retirement `profiles/dsh-opentui` profile is
  detected once and its theme / config preferences are conservatively copied
  into the `opentui` profile (only keys the target does not already have).
  The legacy profile is kept, never deleted.
- **SDK closure link** — the client imports `@deepseek-ai/dsh-client-connection`
  at runtime. That SDK is not on the public npm registry; it ships inside the
  globally-installed dsh's own `node_modules` closure, and the launcher
  symlinks it in (idempotent). This is why the dsh CLI is a hard prerequisite.

Architecture: one resident host serves the workspace; a crashed or quit client
re-attaches (or a fresh one adopts) the running host; `/reload` restarts the
host on the same port without losing the session. Multiple clients can attach
to the same host.

**Config reuse**: the Shell reads your existing dsh config — model defaults
from the host, provider baseUrls and API keys from `$DSH_HOME`. A
workspace-local `./.dsh/config.yml` overlays theme + model preferences on top;
environment (`DSH_OPENTUI_THEME` / `DSH_OPENTUI_MODEL`) wins over the file.

**In the TUI**: type a question, Enter to send. The model's thinking streams
dim; tool calls (bash / read_file / write_file) pop an approval card — `y`
allow, `n` decline; `esc` aborts a running turn. Ctrl+C twice quits. Commands:
`/help` `/model [provider/id]` `/usage` `/clear` `/login` `/logout` `/resume`
`/search` `/new` `/quit` and more — see `/help` inside the TUI.

## Develop

```bash
npx pnpm@10.18.3 install
cd packages/shell && bun src/client-entry.tsx   # run the client from source
for p in packages/*/; do (cd "$p" && bun test); done   # tests, per package
npx pnpm@10.18.3 -r typecheck
```

Note on the @opentui/solid preload and bunfig scope:

- bun only reads the `bunfig.toml` in the CWD, and **`bun test` only honors
  the `[test]` section's `preload`** (the top-level `preload` covers `bun
  run` only — on bun 1.4.x it is ignored by the test runner). Every package
  therefore carries both in its `bunfig.toml`; without `[test].preload`,
  `bun test` resolves `"solid-js"` to the SSR build (`dist/server.js`, no-op
  `createEffect`) and reactive tests pass vacuously. Run tests per package
  (the loop above, same as CI).
- A bare `bun test` from the repo root also gets the real runtime (root
  `bunfig.toml` carries `[test].preload`), but it runs all packages in ONE
  process, so cross-package module singletons can contaminate each other
  (e.g. shell's session-seam-adapter wires tui-base's steer slot with no
  reset API). Per-package runs are the supported gate; a root run is for
  quick iteration only and is expected to show that one steer-slot failure.

To rebuild the client bundle that `prepack` ships: `bun scripts/build-client.mjs`.

### Verification gates (live, client topology)

```bash
node packages/shell/scripts/e2e-sweep.mjs   # full command-surface sweep
node packages/shell/scripts/e2e-client.mjs  # two-process topology gate (attach/adopt/reload)
```

`e2e-sweep.mjs` drives EVERY slash command + keyboard surface through the
real client topology in tmux 120x34 (slow typing, per-item capture): the
read-only commands, every overlay picker, `/config` forms, the `/login`
panel + headless forms, the palette / history-recall / alt+enter / paste /
scroll / dock-toggle / esc stop-confirm keys — and the keystroke-leak
regressions (modal-consumed keys must never type into the blurred editor).
`e2e-client.mjs` gates the two-process topology itself: multi-client attach,
crash adoption, same-port `/reload`, host-death recovery, markdown-table
rendering. Both run under a scratch `DSH_HOME` (temp dir, mode 700) seeded
from the real profile, so login/logout/config/preset writes never touch the
user's home. Real turns ride the workingRoute pattern: the catalog is probed,
a route is selected, and when no route answers the turn items report BLOCKED
loudly while everything else still gates. Requires `dsh`, `tmux`, `bun` on
PATH; otherwise the scripts self-skip (exit 0) so CI runs green.

## Status

v0.9.0: published as `@aiwayds/dsh-opentui` — client-only distribution
(npm bin → client chain; the in-process plugin mode was retired). New
default theme dsh-blue (dark/light, auto-selected by terminal background,
`/theme` to pin) with focus visuals, framed composer/messages/code blocks,
and a motion system (`/motion`, `DSH_OPENTUI_MOTION`) that reduces on
tmux/SSH/non-truecolor. Roadmap: platform + Kit polish.
