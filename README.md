# dsh-opentui

A next-generation TUI **platform** for [dsh](https://github.com/deepseek-ai/dsh) —
new architecture, not a reskin of dsh-tui-pi. Built on
[OpenTUI](https://github.com/anomalyco/opentui) + [Solid](https://solidjs.com),
running on Bun.

The repo's product is the **architecture**; the shipped Shell is
deliberately minimal:

| Package | What it is |
|---|---|
| `@dsh-opentui/runtime` | Engine lifecycle, cordis `surface` service, stdout capture, protocol types |
| `@dsh-opentui/kit` | Shared components: theme tokens, `t()` i18n seam, status bar, panel, line |
| `@dsh-opentui/shell` | The minimal proof-of-architecture TUI |
| `starter/` | Copyable plugin template; consumes the surface protocol with zero build step |

See [CONTEXT.md](CONTEXT.md) for the glossary and [docs/adr/](docs/adr/)
for decisions: Solid (0001), two integration channels with no compat shim
(0002), Bun + compiled binary distribution (0003).

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
pnpm install
pnpm shell        # run the shell
bun test          # tests
pnpm typecheck    # tsc --noEmit across packages
```

Requires Bun >= 1.3.14 (`brew install bun` / `bun upgrade`).

## Status

M1 (repo bootstrap). Roadmap: M2 host seams (approvals, ask, attachments,
sessions) · M3 full Kit + starter polish · M4 binary release pipeline.
