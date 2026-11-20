# dsh-opentui e2e (podman)

Podman-based end-to-end harness for the opentui client, ported from the
`dsh-tui-pi` e2e suite (`~/repo/dsh-tui-pi/e2e`): same structure
(Containerfile + lib/ + scenarios/ + run-e2e.sh), same assertion
primitives, same aggregation rules — adapted to this repo's boot path and
markers.

## What boots in the container

Client mode only (batch B5; the plugin face is retired — ADR-0005, batch
B4 removed the `--plugin` chain). The image carries bun + a workspace
snapshot at `/src`, and the suite boots the repo-root `./dsh-opentui`
launcher, which execs `bun --preload ... client-entry.tsx` (the bun TUI).
The client spawns/joins the resident `dsh --profile opentui` host (node,
from the global dsh closure) through the single-instance lifecycle.

Node 26 (>= 26.4) is a hard requirement of the resident host: OpenTUI's
native core needs `--experimental-ffi`, which node 22 rejects as a bad
option. (The `dsh-tui-pi` image runs node 22; this one cannot.)

The `opentui` profile is NOT baked into the image: `lib/common.sh`'s
`start_tui` / `ensure_client_profile` provisions it at runtime into the
scratch `DSH_HOME` (`/tmp/client-dsh`) from the workspace snapshot —
`provision-opentui-profile.mjs` for the profile, then the bake scripts
(mock LLM endpoint into the patch layer, jev dispatch chain +
subagent-registry bundle members, hoisted `pnpm install` inside the
profile). Nothing touches host state — every boot happens inside the
container's own scratch home.

## Files

- `Containerfile` — ubuntu 24.04 + node 26 + tmux + global
  `pnpm`/`dsh` + bun + the `/src` workspace snapshot
- `lib/common.sh` — markers, tmux driving (start/wait/quit), assert
  primitives (copied as-is from dsh-tui-pi)
- `scenarios/11-upgrade.sh` — `dsh-opentui upgrade` against the offline
  registry fixture: dry-run plan with zero writes, real install with
  `--save-exact` reaching pnpm, `upgrade-overrides.json`, and provisioning
  honouring the override (no reinstall/downgrade)
- `fixtures/upgrade-registry/` — fixture generator (stub tarballs + packuments
  derived from the shipped PLUGIN_SET, one patch bump) and the `127.0.0.1`
  registry server that both the query and install paths point at (see its
  README)
- `scenarios/20-start.sh` — first screen: composer placeholder, powerline
  provider/model segments, ticking clock, editor echo + backspace clear
- `scenarios/30-commands.sh` — slash commands over the 6-command core set:
  palette open (all rows, shape, first-row highlight), `/cl` + `/mo`
  filtering, clear-restore, Esc close, bare `/model`, unknown `/nope`,
  editor liveness (palette mirror) after every cycle
- `scenarios/run-all.sh` — in-container master runner + aggregation
- `run-e2e.sh` — host driver: resolve dsh version (newest of
  latest/next), podman build, podman run

## Markers (derived from a real boot capture inside the container)

| assertion            | text                                                     |
| -------------------- | -------------------------------------------------------- |
| composer placeholder | `Type a message (enter send, alt+enter newline)`         |
| composer hint line   | `enter send · alt+enter newline · ↑↓ history`            |
| provider segment     | `zai-coding-cn`                                          |
| model segment        | `glm-5.3-flash` / powerline pairing `🤖 glm-5.3-flash`   |
| clock                | ERE `[0-9]{2}:[0-9]{2}:[0-9]{2}`, two captures differ    |

Editor echo/backspace are asserted through the slash palette (it repaints
reliably and mirrors the composer buffer): typing `/quit` must list the
`/quit exit the app` row AND filter out the `/help` row; backspaces +
a trailing `/` must restore the unfiltered list (`/help show available
commands`). Rationale: OpenTUI's diff paint has a known upstream bug
(`docs/upstream-opentui-paint-bug-draft.md` — "the process stays alive and
keeps processing input correctly — only the screen is wrong"), so the
composer value line itself can render stale while typing; palette
keystrokes trigger the repaint.

Scenario 30 markers (same discipline — real capture):

| assertion               | text                                                   |
| ----------------------- | ------------------------------------------------------ |
| palette rows (6)        | `/help show available commands`, `/new start a fresh session`, `/model switch model (bare opens the picker, then the effort picker)`, `/quit exit the app`, `/sessions list and resume stored sessions`, `/clear clear the transcript` |
| first-row highlight     | SGR `38;5;238m/help` (active fg) vs `38;5;255m/new` (base fg) |
| `/cl` / `/mo` filter    | only the `/clear` / `/model` row; `/help` row absent    |
| bare `/model`           | `no models in the catalog`; `Select model` absent       |
| unknown command         | `unknown command: /nope (try /help)`                    |

In-container input law (captured, see `lib/common.sh` `ensure_editor_ready`):
text must land as ONE tmux write from a CLOSED palette — appending text
while the palette is open breaks it (rows vanish, buffer undefined); so
filters are typed as `/cl` in one write, never `/` then `cl`. Backspaces
must be spaced: a no-sleep flood drains asynchronously and can eat keys
typed seconds later. `ensure_editor_ready` proves the editor through the
palette mirror (`/quit` echo, backspaces + trailing `/` clear), not the
composer value row.

Known anomaly (plugin-era record, kept for history): bare `/model` used to
never open the picker in the container — the retired plugin seam's
`modelCatalog()` was built from an empty `listProviders()`; `/model`
printed `no models in the catalog`. The client face resolves the catalog
through the resident host, so scenario 30's captured-behavior assertion may
flip once the picker opens there — update the scenario then.

Known limitation: `/quit`, Ctrl+C x2 and Ctrl+D do not currently exit the
app inside this container (same upstream bug family) — `lib/common.sh`'s
`quit_tui` documents it, scenario 20 does not assert quit, and runners
clean up via `kill_tui` + container exit.

## Run

```sh
# everything (builds the image, runs the suite — client face only):
./e2e/run-e2e.sh

# subset only:
E2E_SCENARIOS="20-start" ./e2e/run-e2e.sh

# client face via the runtime-assembly path (no image rebuild; pulls from
# the npmmirror — use when the podman VM cannot reach registry.npmjs.org):
E2E_SCENARIOS="20-start" ./e2e/run-client-e2e.sh

# directly against an already-built image:
podman run --rm -v "$PWD/e2e:/e2e:ro" localhost/dsh-opentui-e2e:latest \
  bash /e2e/scenarios/run-all.sh
```

Requirements: podman with a running machine. The default mirrors
(`docker.m.daocloud.io` base image, `npmmirror.com/mirrors/node` node
dist) exist because docker.io / nodejs.org are not reachable from this
network's podman VM; on a clean network drop the prefixes (see
`Containerfile` build args).

Results print per-scenario counters and a final `E2E RESULT: PASS/FAIL`;
run-e2e.sh exits non-zero on failure.

## v2 assertion criteria (0234 upgrade)

`lib/assert-v2.sh` replaces the v1 "grep a string / accept a degrade copy"
mentality. Every assertion is recorded as one row in
`$RESULTS_DIR/v2-items.tsv` and rendered into `report.md`:

- class `A` 真缺陷 / `B` 判据错误 / `C` 预期行为. A B-class row must carry the
  wrong criterion and the correct one; report.md prints both.
- level `L1` 有响应 / `L2` 状态真变 / `L3` 模型可感知.
- silent no-op is always FAIL; a `warn` fallback never counts as PASS.
- gate-dark items are SKIP (listed explicitly in report.md), never a PASS.

Primitives: `assert_frame_has <regex>` (content poll — never "two identical
captures", which is unstable during a busy turn), `assert_no_degrade <frame>`
(configurable blacklist `V2_DEGRADE_ERE`), `assert_state_change <label> <before>
<after>`, `assert_log_has <regex> <logfile>` (L3 model-side proof),
`assert_exit_code <label> <expected-ere> <frame>` (needs
`E2E_CAPTURE_EXIT=1`), `v2_skip`, `v2_record`, and `v2_each_size <callback>`.

### Dual size

`E2E_SIZES` defaults to `120x40 200x50`. Key/panel scenarios (`t0-*`,
plus the command/palette smoke in `30-commands`) drive every size with
`v2_each_size`; the geometry is stamped onto each report item. The TUI boots
at the first size; `resize_tui_to` (lib/common.sh) resizes the live pane.

### Isolation / retry

- `E2E_ISOLATED=1`: run-all.sh gives each scenario its own scratch
  `DSH_HOME` under `E2E_SCRATCH_ROOT` (default `/tmp/e2e-scratch`) and a
  derived mock port (`E2E_PORT_BASE`, default 8642) baked into that home's
  route via `MOCK_BASE_URL`. `reset_e2e_state` runs at scenario source time
  and kills leftover TUI/host/mock processes, so no state is shared.
- `E2E_RETRY=1` (default): a scenario with failing assertions is rerun once
  (2 attempts max); its failed ledger rows are dropped before the retry.
  Use `E2E_SCENARIOS="t0-global-keys" ./e2e/run-e2e.sh` to rerun a single case.

### Self-check without podman

```sh
bash -n e2e/lib/*.sh e2e/scenarios/*.sh e2e/run-e2e.sh
./e2e/run-e2e.sh --help       # no network, no podman
./e2e/run-e2e.sh --dry-run    # prints resolved commands, executes nothing
```

`podman machine` is intentionally not started by these checks.
