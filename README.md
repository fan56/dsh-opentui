# dsh-opentui

A next-generation TUI **platform** for [dsh](https://github.com/deepseek-ai/dsh) —
new architecture, not a reskin of dsh-tui-pi. Built on
[OpenTUI](https://github.com/anomalyco/opentui) + [Solid](https://solidjs.com),
running on Bun.

The repo's product is the **architecture**; the shipped Shell is a working
chat agent TUI on top of it. It boots an in-process session bridge inside the
dsh host and drives the OpenTUI client over a stdio JSON-lines channel — the
bridge is the only session seam. The legacy remote thin-client seam and its
`DSH_OPENTUI_INPROC=0` escape hatch were removed in 0.24.0; the `--remote`
flag was removed earlier, in 0.23.0.

| Package | What it is |
|---|---|
| `@dsh-opentui/runtime` | Engine lifecycle, cordis `surface` service, stdout capture, protocol types |
| `@dsh-opentui/kit` | Shared components: theme tokens, `t()` i18n seam, status bar, panel, line |
| `@dsh-opentui/shell` | **Usable chat TUI**: ask → thinking stream → tool approval → reply |

See [CONTEXT.md](CONTEXT.md) for the glossary and [docs/adr/](docs/adr/)
for decisions: Solid (0001), two integration channels with no compat shim
(0002), Bun single-process distribution (0003), host profile route (0004),
client mode (0005, superseded as the sole TUI path by the in-process bridge,
0009), session seam lifecycle (0010), the ask/permission channel (0011),
table-driven CapIR v3 dispatch (0012) and retirement of the legacy container
e2e layer (0013).

## Install

Prerequisites:

- [Bun](https://bun.sh) >= 1.3.14 (`npm i -g bun`) — the client bundle's runtime
- The dsh CLI (`npm i -g @deepseek-ai/dsh`) — the session carrier (profile storage, config, model access)
- Node >= 26.4 — runs the `dsh-opentui` launcher itself

```bash
npm i -g @aiwayds/dsh-opentui
dsh-opentui
```

The first launch automatically provisions the `opentui-inproc` profile: the
shipped bridge bundle is materialized as a real directory copy of this
installation (no symlink, no copy of any `@deepseek-ai/*` package into the
profile) and checked against a build-time fingerprint. The copy converges
idempotently on every launch, so a damaged or stale bridge is replaced on the
next start. `--repair-bridge` is a terminal maintenance command: it kills this
profile's stale instances (SIGTERM, then SIGKILL for survivors), reruns the
provisioner in repair mode, and exits without launching the TUI. A fingerprint
mismatch still fails loud.

The legacy `--force` and `--yes` launcher flags are deprecated no-ops in this
in-process-only build: `--yes` is accepted only alongside `--force`, and neither
kills processes nor clears markers. Use `--repair-bridge` to clear stale
instances and repair the bridge. Both flags will be removed in the next minor
release.

Run `dsh-opentui --help` for the full list of launcher options.

## Upgrading

The `dsh-opentui upgrade` subcommand is retired; reinstall the package with the
install command above to update the launcher.

## Session topology

> Since 0.24.0 the in-process session bridge (`opentui-inproc` profile, see
> ADR-0009) is the **only** session seam: the Bun TUI talks stdio JSON-lines to
> a bridge loaded inside a `dsh --profile opentui-inproc` host process. The
> legacy remote thin-client seam, its `DSH_OPENTUI_INPROC=0` escape hatch and
> the `--remote` flag are all gone (the flag has been a usage error, exit 2,
> since 0.23.0).

The Node launcher spawns the Bun TUI in the foreground (forwarding
SIGINT/SIGTERM/SIGHUP); the TUI starts the dsh host, which loads the bridge
in-process. A boot handshake compares the client's expected capability surface
with the bridge and degrades honestly on a mismatch.

Every launch provisions one profile:

- **`opentui-inproc`** — the only session host, provisioned synchronously (a
  failure here is fatal): a real directory copy of this installation's bundled
  bridge, the session shim, a host-version compatibility exemption, the
  approval gate, the inproc-only cordis patch and the companion set declared by
  `scripts/lib/companion-policy.mjs`. The bridge copy converges on every launch;
  `--repair-bridge` clears this profile's stale instances, reruns provisioning
  in repair mode, and exits without launching the TUI. Companion versions
  resolve to the registry `latest` within each catalog range and are never
  downgraded.
- **SDK closure link** — the client still imports
  `@deepseek-ai/dsh-client-connection` at runtime (host label/lifecycle). That
  SDK is not on the public npm registry; it ships inside the globally-installed
  dsh's own `node_modules` closure, and the launcher symlinks it into the
  installed package's `node_modules` (idempotent). This is why the dsh CLI is a
  hard prerequisite.

The retired `opentui` profile is no longer provisioned or seeded. Existing
`opentui` / `opentui-inproc` directories remain untouched as migration sources
and rollback material. The old `--provider`, `--model`, `--reasoning-effort`,
`--plugins` and `--dry-run` launcher options are retired; manage companions with
`dsh plugin --profile opentui-inproc` when manual intervention is needed.

**Config reuse**: the Shell reads your existing dsh config — model defaults
from the host, provider baseUrls and API keys from `$DSH_HOME`. A
workspace-local `./.dsh/config.yml` overlays theme + model preferences on top;
environment (`DSH_OPENTUI_THEME` / `DSH_OPENTUI_MODEL`) wins over the file.

**In the TUI**: type a question, Enter to send. `F6` (or a click) moves focus
between the transcript and the composer; while the transcript is focused, ↑/↓
scroll a line, PgUp/PgDn a page, Home/End jump to the top/bottom, and Tab or
Esc returns to the composer (Esc ×2 stops a running turn: the first press
prompts "press Esc again to stop", the second opens a confirmation dialog
that stops the turn AND every live subagent). The focused pane
carries a heavy accent frame; the unfocused one dims. Mouse reporting is on, so
hold **Shift** while dragging for the terminal's native selection (then
Cmd/Ctrl+C copies it); a plain drag is copied on release per `terminal.copy`.
The model's thinking streams
dim; write-class tool calls (bash / write / edit / apply_patch) pop an approval
card — **Enter** allows once, **Esc** declines (fail-closed); read-only tools
such as read_file pass straight through. `esc` ×2 + confirm stops a running
turn. Ctrl+C twice quits. Commands (see `/help` inside the TUI for the full
list): `/help` `/model [provider/id]` `/model discover` `/btw` `/plugins`
`/goal` `/login` `/logout` `/account` `/settings` `/agents` `/skills`
`/search` `/history` `/subagents` `/session` `/export` `/think` `/preset`
`/theme` `/language` `/motion` `/hints` `/hotkeys` `/stop` `/resume` `/new`
`/clear` `/flush` `/quit`.

**Approval by default (inproc profile)**: the generated profile pins
`defaultPreset: workspace-write` (`approval: ask`) and arms the pre-execute
gate for the write tools the host registers — `bash`, `write`, `edit`,
`apply_patch`. Those tools pop the approval card before running; read-only
tools run straight through; writes outside the workspace are denied by the
sandbox with an escalation hint. **Escape hatch**: launch with
`DSH_OPENTUI_APPROVAL_GATE=off dsh-opentui` to disable the gate and restore the
pre-T9 `danger-full-access` default. The gate is ON by default — do not set
that variable for normal use. See `docs/adr/0011-ask-permission-bridge-channel.md`
§6 and `tickets/2026-11-18-approval-trigger-mechanism.md`.

**Session restore on launch (opt-in)**: a plain launch starts a new, empty
session. To reopen the newest non-empty session from the launch workspace that
was active within the last 7 days — with a `resumed <title> · <time ago>`
notice — set `"autoResume": "last"` in
`$DSH_HOME/profiles/opentui-inproc/config.json` (change the window with
`"autoResumeDays": N`), or pass `--resume-last` for one launch (it overrides
the config). `--new` always starts fresh and wins over both; `--session <id>`
pins a specific session.

## Capability surface

The capability layer is table-driven: `capir/capir.json` (CapIR v3 — 257
wire→client methods over 43 host artifacts) is the single source of truth, and
`scripts/gen-capcontract.mjs` generates the id/kind/params/service tables plus
a generic dispatcher; `node scripts/check-capcontract.mjs` byte-compares the
generated files (22 assertions). Capabilities are released by an explicit
per-id allowlist, not a blanket grant. The in-process host currently wires
**58 of 257** methods (28 hand-written adapters + 30 released generic ids);
everything else fails explicitly as `NOT_WIRED`, never a silent empty result.
The `account` / `credentials` / `settings` families are deny-listed from the
generic arm and served only by hand-written faces with per-field whitelist
projection. Credential values are redacted to key name + presence before they
cross the stdio bridge and never land in logs or evidence.

Plugin write operations (install/uninstall/enable/disable) are gated twice —
a bridge-side confirm set (8 `pluginManager` write ids) and a TUI confirmation
modal. Goal edits confirm in the TUI before each write; they are exempt from
the bridge confirm set by risk grading (AMEND-5 §11.2) — goals only change
host-side goal state, with no FS, config or credential surface. Values crossing
the bridge pass through per-field whitelist projection in both cases.

Command faces backed by real host data (0.24–0.25):

- **`/btw`** — a side question answered in a throwaway side session; it runs
  alongside a busy main turn (bare `/btw` reopens the last answer).
- **`/plugins`** — a plugin-manager panel with list + detail and install /
  uninstall / enable / disable behind a confirmation modal; install progress
  is polled with a bounded wait and can be cancelled.
- **`/goal`** — goal data with 7 operations: status, create, edit, pause,
  resume, complete, clear; writes confirm first.
- **`/model discover`** — query the current provider for its model list. The
  positive path is environment-dependent and was NOT RUN in the scratch gate
  (no discovery source registered); the honest degrade path is verified.
- **`/login`** / **`/logout`** / **`/account`** — provider login picker
  (including a Custom form) and account sign-in state, kept in separate
  domains.
- **`/search`** / **`/history`** / **`/subagents`** — full-text search over
  stored sessions, completed-turn browse/refill/switch/fork, and live subagent
  transcripts with steer/stop.
- **`/settings`** — now shows a real permission-preset row; config/agents
  faces became real (no degrade notice) in 0.24. `/model` has used the real
  model catalog and selection since 0.24.

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

### Verification gates

CI runs the integrity and test gates: `node scripts/check-capcontract.mjs`
(22 byte-level/consistency assertions over the generated capability tables),
per-package `bun test`, `bun run test:ft`, `bun run typecheck:entry` and the
`^verify:` assembly tests, plus the `pack-cold-start` job (npm pack → fresh
install → bridge identity → stdio handshake). The real-machine tmux recipe
(`scripts/real-client-gate.sh`, historically named "verify70") runs **64**
items against a live TUI; its CI job is opt-in and needs a self-hosted runner
with `dsh`, tmux, a provisioned profile and a provider key, so a local run is
required before keymap/panel/command-surface changes. The legacy podman
`e2e/scenarios/` container layer was retired in 0.25 (ADR-0013); its still-valid
assertions moved to the host families, verify70, unit tests and the
`pack-cold-start` gate.

The legacy HTTP client-topology and command-surface gates were retired with
the HTTP host. They are no longer available as local verification commands.

## Status

v0.9.6: published as `@aiwayds/dsh-opentui` — client-only distribution
(npm bin → client chain; the in-process plugin mode was retired). New
default theme dsh-blue (dark/light, auto-selected from terminal background,
`/theme` to pin) with focus visuals, framed composer/messages/code blocks,
and a motion system (`/motion`, `DSH_OPENTUI_MOTION`) that reduces on
tmux/SSH/non-truecolor. 0.9.2 aligns the footer with `dsh-tui-pi`
(provider icon, effort ladder, context usage, counters, tok/s, subagent
lines), adds shell-style input history recall, and fixes palette/dialog
contrast and footer refresh. 0.9.3 adds slash-palette Tab completion with
a 10-row window and skills, the `/agents` and `/settings` panels, F6 /
click pane focus with a scrollable transcript, the dock fade, and default
plugin provisioning with keyless `web_search`. 0.9.4 ships MCP by default
(`dsh-mcp-adapter` plus a keyless context7 server), a steer-or-queue choice
on a busy submit, the cwd · git branch composer row, session restore on
launch, a compact footer context percent, and a fix for transcript loss on
`/resume`. 0.9.5 adds `/flush` for a paused delivery queue, closes the
settings permission-preset and skill-catalog gaps, and makes session restore
opt-in (`--resume-last` or `autoResume: "last"`) so a plain launch starts
fresh. 0.9.6 adds tiered tests (`test:unit|ft|ui|e2e|all` with a geometry×
scene UI matrix and a real-client e2e flow suite), hardens first-connect
(stale host locks are probed over HTTP and replaced, readiness waits for
HTTP + `$events`, retries capped at 3 with the host stderr tail surfaced),
and fixes footer wrapping on narrow terminals, tool-dock clipping, the
message count after `--resume-last`, and duplicate terminal-size listeners.

0.24.0 completes the in-process bridge as the sole session seam (the `--remote`
flag and the `DSH_OPENTUI_INPROC=0` escape hatch are both gone). It adds the
CapIR/capcontract layer with a startup capability handshake, a FocusRouter
keymap with a four-tier capture stack, and the S1–S6 capability surface: a real
`/model` catalog, credentials/account with PKCE authorization, and real
config/settings/agents faces. The `pack-cold-start` CI gate and the real-machine
verify70 gate went green; 28 methods were hand-wired and `@manual` reached 0.

0.25.0 (npm `latest`) makes capability release table-driven: CapIR v3 parameter
tables plus a generic dispatch arm (ADR-0012) and a per-id allowlist take the
wired set to 58/257 while `check-capcontract` stays green at 22/22 assertions.
New command faces ride real host data — `/btw` side sessions, a `/plugins`
manager panel with confirm-gated writes and bounded install progress, `/goal`
with 7 operations, `/model discover`, separate `/login` and `/account` domains,
and real `/search`, `/history` and `/subagents` data. The legacy podman
`e2e/scenarios/` container layer was retired (ADR-0013), verify70 closed at
64/64, and the `pack-cold-start` gate is required. `/model discover`'s positive
path is environment-dependent; it was NOT RUN where no discovery source is
registered, and is not faked. Current focus: capability-surface polish and
honest degradation.
