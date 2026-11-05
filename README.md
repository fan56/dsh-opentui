# dsh-opentui

A next-generation TUI **platform** for [dsh](https://github.com/deepseek-ai/dsh) —
new architecture, not a reskin of dsh-tui-pi. Built on
[OpenTUI](https://github.com/anomalyco/opentui) + [Solid](https://solidjs.com),
running on Bun.

The repo's product is the **architecture**; the shipped Shell is a working
chat agent TUI on top of it:

| Package | What it is |
|---|---|
| `@dsh-opentui/runtime` | Engine lifecycle, cordis `surface` service, stdout capture, protocol types |
| `@dsh-opentui/kit` | Shared components: theme tokens, `t()` i18n seam, status bar, panel, line |
| `@dsh-opentui/shell` | **Usable chat TUI**: ask → thinking stream → tool approval → reply |
| `starter/` | Copyable plugin template; consumes the surface protocol with zero build step |

See [CONTEXT.md](CONTEXT.md) for the glossary and [docs/adr/](docs/adr/)
for decisions: Solid (0001), two integration channels with no compat shim
(0002), Bun + compiled binary distribution (0003), host profile route (0004).

## Install

Prerequisites:

- The dsh host: `npm i -g @deepseek-ai/dsh` (or your official channel)
- Node >= 26.4 (OpenTUI's native core needs `--experimental-ffi`, injected for you)
- pnpm

```bash
npm i -g @aiwayds/dsh-opentui
dsh-opentui
```

The first launch idempotently installs a dsh profile at
`~/.dsh/profiles/dsh-opentui` (bundles: `dsh-base` + this package) and pins
the default model through a cordis patch (`llm-pi-ai` provider routing +
`agent-default-model`: `zai-coding-cn/glm-5.3-flash/high`). Afterwards
`dsh-opentui` is equivalent to `dsh --profile dsh-opentui`.

To change the model, re-run the installer with flags
(`--provider` / `--model` / `--reasoning-effort`) or edit the profile's
`cordis.patch.yml` directly.

Prefer to run without the host? See
[Direct mode (development)](#direct-mode-development).

## Run as a dsh profile (host mode)

The Shell runs inside the real dsh host as a profile. The `dsh-opentui`
bin handles everything: on first launch it installs the profile, then it
execs the host with the profile flag and injects `--experimental-ffi` for
you. After the first run, `dsh-opentui` is equivalent to:

```bash
NODE_OPTIONS=--experimental-ffi dsh --profile dsh-opentui   # manual fallback
```

| What | Where |
|---|---|
| Profile | `~/.dsh/profiles/dsh-opentui` (bundles: `dsh-base` + `@aiwayds/dsh-opentui`; model pinned via `cordis.patch.yml`) |
| Runtime | node >= 26.4 with `--experimental-ffi` inside the host (auto-injected by the bin) |
| Model & keys | reused from the host's own config; override the pinned default via installer flags or the patch file |

## Direct mode (development)

Without the host, useful for hacking on the Shell itself:

```bash
cd ~/repo/dsh-opentui/packages/shell
bun src/main.tsx                      # dev run
bun src/main.tsx --model zai-coding-cn/glm-5.2   # explicit model
bun build.ts && ../../build/dsh-opentui-darwin-arm64   # standalone binary
```

**Config reuse**: the Shell reads your existing dsh config — model default
comes from `~/.dsh/model-profiles.json` (current profile's workhorse
agent), provider baseUrls from `~/.dsh/models-store.json`, API keys from
`~/.dsh/.credentials.yaml`. Override with `--model provider/id` or
`DSH_OPENTUI_MODEL` / `DSH_OPENTUI_API_KEY`.

**In the TUI**: type a question, Enter to send. The model's thinking
streams dim; tool calls (bash / read_file / write_file) pop an approval
card — `y` allow, `n` decline; `esc` aborts a running turn. Commands:
`/help` `/model [provider/id]` `/usage` `/clear` `/quit` (or Ctrl+C).

## Plugin integration, 30 seconds

**Layer 2 (declarative, zero build)** — inject the surface service:

```ts
import type { Context } from "@deepseek-ai/cordis"
import { hasSurface } from "@dsh-opentui/runtime"

export function apply(ctx: Context) {
  if (!hasSurface(ctx)) return // headless: no surface host mounted
  ctx.surface.declare({
    kind: "widget", slot: "status", id: "myplugin.state",
    parts: [{ text: "myplugin", dim: true }, { text: " ok", color: "#50fa7b" }],
  })
}
```

**Layer 1 (Solid components)** — depend on `@dsh-opentui/kit` and write
components; add vite + babel-preset-solid to your build.

## Develop

```bash
npx pnpm@10.18.3 install
cd packages/shell && bun src/main.tsx   # run the shell
bun test                                # tests (repo root)
npx pnpm@10.18.3 -r typecheck
```

To test host mode against local sources, point the installed profile at the
repo via `link:` mounts, then rebuild after changing plugin sources:

```bash
cd packages/shell && bun build-host.ts
```

Requires Bun >= 1.3.14 (`bun upgrade`). Note: each package carries its own
`bunfig.toml` (the @opentui/solid preload) — bun only reads the CWD's
bunfig; a root-level one breaks compiled binaries ("preload not found").

### Verification gates (client mode, live)

```bash
node packages/shell/scripts/e2e-sweep.mjs   # full command-surface sweep
node packages/shell/scripts/e2e-client.mjs  # two-process topology gate (attach/adopt/reload)
node packages/shell/scripts/e2e-live.mjs    # in-process live gate
node scripts/smoke-boot.mjs                 # boot smoke
```

`e2e-sweep.mjs` drives EVERY slash command + keyboard surface through the
real client topology in tmux 120x34 (slow typing, per-item capture): the
read-only commands, every overlay picker, `/config` forms, the `/login`
panel + headless forms, the palette / history-recall / alt+enter / paste /
scroll / dock-toggle / esc stop-confirm keys — and the keystroke-leak
regressions (modal-consumed keys must never type into the blurred editor).
It runs under a scratch `DSH_HOME` (temp dir, mode 700) seeded from the real
profile, so login/logout/config/preset writes never touch the user's home.
Real turns ride the workingRoute pattern: the catalog is probed, a route is
selected, and when no route answers the turn items report BLOCKED loudly
while everything else still gates. Per-item captures land in a temp
caps dir for eyeballing. Requires `dsh`, `tmux`, `bun` on PATH; otherwise
the script self-skips (exit 0) so CI runs green.

## Status

v0.1.0: published as `@aiwayds/dsh-opentui` (host profile mode via the
`dsh-opentui` bin, direct-mode binary). Roadmap: host seams
(approval waterfall, ask, attachments, sessions via the real dsh host) ·
full Kit + starter polish · linux binary release pipeline.
