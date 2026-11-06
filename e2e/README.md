# dsh-opentui e2e (podman)

Podman-based end-to-end harness for the opentui client, ported from the
`dsh-tui-pi` e2e suite (`~/repo/dsh-tui-pi/e2e`): same structure
(Containerfile + lib/ + scenarios/ + run-e2e.sh), same assertion
primitives, same aggregation rules — adapted to this repo's boot path and
markers.

## What boots in the container

Plugin mode. The image installs the tarball packed from this source tree
globally and boots the `dsh-opentui` launcher, which injects node's
`--experimental-ffi` into `NODE_OPTIONS` and execs
`dsh --profile dsh-opentui` (the committed `dist-host/` plugin under the
node runtime). Client mode (`bun src/client-entry.tsx`) needs bun + the
workspace and is out of scope for the container; the suite is
mode-agnostic — the goal is "the same cases pass on opentui".

Node 26 (>= 26.4) is a hard requirement of the plugin path: OpenTUI's
native core needs `--experimental-ffi`, which node 22 rejects as a bad
option. (The `dsh-tui-pi` image runs node 22; this one cannot.)

Profile provisioning mirrors the repo's own smoke path
(`packages/shell/scripts/smoke-boot.mjs`) via the idempotent
`scripts/install-profile.mjs`:

- tarball as a `file:` dep (`--dep file:/dist/aiwayds-dsh-opentui-*.tgz`)
- patch layer: provider route (`zai-coding-cn`), default model pin
  (`glm-5.3-flash`, effort `high`), plugin insert (theme catppuccin-mocha)
- hoisted `pnpm install` inside the profile
- solid-js pinned to its client build (by install-profile.mjs itself)
- `@deepseek-ai/dsh-llm` linked from the global dsh closure

All of this runs at IMAGE BUILD time; scenarios only boot. Nothing touches
host state — every boot happens inside the container's own `~/.dsh`.

## Files

- `Containerfile` — ubuntu 24.04 + node 26 + tmux + global
  `pnpm`/`dsh` + tarball pack (`/dist`) + profile bootstrap
- `lib/common.sh` — markers, tmux driving (start/wait/quit), assert
  primitives (copied as-is from dsh-tui-pi)
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
| palette rows (6)        | `/help show available commands`, `/new start a fresh session`, `/model switch model (bare opens the picker)`, `/quit exit the app`, `/sessions list and resume stored sessions`, `/clear clear the transcript` |
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

Known anomaly: bare `/model` never opens the picker in the container — the
plugin seam's `modelCatalog()` is built from `listProviders()`, which is
empty on this path (`packages/shell/src/host-session-seam-adapter.ts`);
`/model` prints `no models in the catalog`. Scenario 30 asserts the captured
behavior and that no picker opened (it flips to FAIL once a catalog exists —
update the scenario then).

Known limitation: `/quit`, Ctrl+C x2 and Ctrl+D do not currently exit the
app inside this container (same upstream bug family) — `lib/common.sh`'s
`quit_tui` documents it, scenario 20 does not assert quit, and runners
clean up via `kill_tui` + container exit.

## Run

```sh
# everything (builds the image, runs the suite):
./e2e/run-e2e.sh

# subset only:
E2E_SCENARIOS="20-start" ./e2e/run-e2e.sh

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
