# ADR-0004: Host profile route — the plugin runs inside the real dsh host

Date: 2026-10-29 (night)
Status: accepted

## Context

Two integration postures were on the table after M2's direct-LLM demo:
embedding nothing (direct HTTP calls reusing dsh config files) or running
as a plugin inside the real host, tui-pi-style (`dsh --profile
dsh-opentui`). The user picked the profile route: fewer features is fine,
but the surface must be a real host citizen (host models, host tools,
host approval, host sessions).

## Decision

dsh-opentui ships a host plugin. `packages/shell/src/host-entry.tsx` is
the cordis plugin (`apply(ctx)` + `inject: ["agents"]` on the **default
export** — the loader unwraps `default ?? exports`, a sibling named
`inject` export is silently dropped). `HostSession` drives conversations
through host services: `ctx.agents.create` + `agent.followup`, streaming
via `agent/assistant-stream` frames (reasoning-delta = thinking), durable
tool blocks via `session/event` (tool/call + tool/result), and the
`approval/request` waterfall.

Distribution: `build-host.ts` bundles to a self-contained
`dist-host/` package (node target, ESM). `@opentui/*` + `solid-js` stay
external; `@deepseek-ai/dsh-llm` resolves from the global dsh closure via
symlink (the tui-pi link-dsh-closure mechanism — those packages are not
on public npm). The profile at `~/.dsh/profiles/dsh-opentui` mounts it
with `link:` and pins `llm-pi-ai` + `agent-default-model` config the same
way the tui profile does.

## Consequences — the four gates found tonight

1. **node >= 26.4 + `--experimental-ffi` is mandatory**: OpenTUI's native
   core refuses to init without it ("native FFI is not available for this
   runtime"). The `dsh-opentui` launcher sets NODE_OPTIONS.
2. **solid-js must be pinned to its client build under node**: its
   `"node"` export condition resolves to `dist/server.js` (SSR — signals
   never schedule UI updates; first frame renders, then the screen is
   dead). `build-host.ts` rewrites the installed package's `exports` to
   `dist/solid.js`, keeping the `./dist/*` subpaths @opentui/solid uses.
   This is the node edition of the bunfig-preload remap (ADR-0003 note).
3. **The loader takes `default ?? exports`** — plugin metadata (inject)
   must ride the default export object.
4. **The host does not auto-apply a default model**: seed
   `agentOptions` from `ctx.get('agentDefaultModel').currentSelection()`
   (ctx.get needs no inject) and pin the provider route in the profile
   patch (`llm-pi-ai.providers.zai-coding-cn`), or the turn dies with
   NO_ADAPTER / has-no-provider-model.

Known boundary: under the base bundle's workspace-write preset most tool
calls are auto-allowed, so the approval card rarely gets asked to show in
host mode (the listener is armed tui-pi-style; the card UI itself is
verified end-to-end in direct mode).
