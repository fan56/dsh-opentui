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
