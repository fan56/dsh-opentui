# ADR-0005: Client mode — TUI as thin client over the host Remote protocol

Date: 2026-11-03
Status: accepted

## Context

Today the TUI is a cordis plugin running in-process inside the dsh host
(plugin mode, ADR-0004). Every `dsh-opentui` launch boots a whole host
stack (22+ plugins) just to render one terminal. Verified empirically:
each `dsh --profile X` boot is a fresh process with no
attach/registration path — a second web boot on the same port crashes
with EADDRINUSE, and no lock/pid/instance registry exists.

The rendering stack (OpenTUI + solid-js) is bun-first. Under the host's
node runtime, solid-js's `"node"` export condition resolves to its SSR
build (no reactive scheduling); we worked around it by pinning the
installed package's exports to the client build (patchedDependencies,
commit a28d77d). This is a permanent upstream gap: `@opentui/solid`'s
node preload is a throw stub ("Bun-only").

Meanwhile the host already ships a mature client protocol —
dsh-client-connection (Remote RPC + `$events` incremental streams +
reconnect policy + token/cookie auth), explicitly supporting non-page
carriers (non-browser clients supply their own WebSocket transport). The
web product surface already runs host-as-service with many browser
clients. The host's workspace registry groups sessions by directory and
serves multiple workspaces per host.

## Decision

Adopt **client mode**: the TUI becomes a thin rendering client (bun)
attaching to a resident host service (profile `opentui`) over the host's
Remote connection protocol. This supersedes ADR-0004's in-process route
as the product path.

1. **Workspace = the directory the TUI is launched in** (cwd,
   canonicalized). Identity follows the host's workspace registry
   semantics: delete + re-add yields a new record.
2. **Entry is one word**: `dsh-opentui` in any directory — that
   directory is the workspace.
3. **The product is the host profile**, fixed as `opentui` (no new
   profile name): users install plugins into `~/.dsh/profiles/opentui`
   and see them there.
4. **Workspace isolation is local config only**: `<workspace>/.dsh/`
   holds theme + model preferences overriding globals; credentials and
   plugin installs never live there. Sessions stay host-managed
   (host-global durable logs); a TUI mounts one session per entry,
   defaulting to new (`/history` reaches older ones).
5. **Host lifecycle**: the first TUI launch spawns the host service
   (single-instance lock); later TUIs only connect. When the last TUI
   disconnects, the host exits after `idleExitSec` of idleness —
   configurable, default 60s; `0` keeps the host resident (never
   exits), which covers background-plugin scenarios (cron / bot
   listeners) that must outlive every TUI.
6. **Plugin mode is retained** for the standalone direct-mode binary
   (ADR-0003) — that binary bypasses the host by design.

## Consequences

Positive:

- Multi-TUI on one host ("register, don't re-boot") falls out naturally.
- The solid-js pin / patchedDependencies / `--experimental-ffi`
  workarounds become obsolete: the client runs bun, where
  `@opentui/solid` is officially supported.
- Host upgrades and TUI releases decouple; web/phone/TUI become peers on
  one protocol.

Negative / cost:

- The host-coupled layer — the `ctx.*` seams (commands registry,
  approval waterfall, steer injection, transcript streaming, status
  signals, widgets, keybindings, session ops, attachments, model switch,
  remote-tail, subagent panel) — must be re-wired onto Remote
  RPC/`$events`. Sized by the capability mapping audit
  (docs/client-mode-protocol-audit.md): 27–48 person-days, no host-side
  changes required for the core loop.
- One network hop adds reconnect UX concerns (the protocol ships a
  reconnect policy).
- A resident host adds a managed process on single-user machines.

User decision recorded with this ADR: **v1 ships full capability
parity, no degradations** — /agents, /repair, and the git segment go
through client-local filesystem/process operations (valid in the
single-machine topology where host and client share a filesystem), and
/reload is worked around as host restart + TUI auto-reconnect. The
protocol-level coverage behind this call, including what would degrade
in a remote (non-local) deployment, is in
docs/client-mode-protocol-audit.md.

Risks: protocol coverage gaps may require host-side (DeepSeek-owned)
changes we cannot ship; partial coverage may force fallbacks (see
docs/client-mode-protocol-audit.md §4 for the flagged list).

## Open questions

None open. The former "60s idle-exit vs background plugins" question is
resolved by decision 5: `idleExitSec` is configurable with default 60s
and `0` = resident, which covers background-plugin scenarios without a
special case.
