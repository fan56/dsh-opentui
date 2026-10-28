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

## Run as a dsh profile (host mode)

The Shell can run inside the real dsh host as a profile, instead of the
standalone binary:

```bash
./dsh-opentui                                        # launcher (adds the flag for you)
NODE_OPTIONS=--experimental-ffi dsh --profile dsh-opentui   # equivalent, manual
./try-host.sh                                        # keymap banner + launcher
```

| What | Where |
|---|---|
| Profile | installed at `~/.dsh/profiles/dsh-opentui` (bundles: `dsh-base` + `@dsh-opentui/shell`; plugins mounted via `link:`) |
| Runtime | OpenTUI's native core needs node >= 26.4 with `--experimental-ffi` inside the host |
| Model & keys | fully reused from the host's own config (agent-default-model combo by default) |

After changing plugin sources, rebuild:

```bash
cd packages/shell && bun build-host.ts
```

## Try the Shell (M2 demo)

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

Requires Bun >= 1.3.14 (`bun upgrade`). Note: each package carries its own
`bunfig.toml` (the @opentui/solid preload) — bun only reads the CWD's
bunfig; a root-level one breaks compiled binaries ("preload not found").

## Status

M3: host profile mode (`dsh --profile dsh-opentui`) + direct-LLM fallback. Roadmap: host seams
(approval waterfall, ask, attachments, sessions via the real dsh host) ·
full Kit + starter polish · linux binary release pipeline.
