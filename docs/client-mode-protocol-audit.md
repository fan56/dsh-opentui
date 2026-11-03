# Client-mode protocol coverage audit

Date: 2026-11-03
Status: supporting data for ADR-0005 (client mode)

Read-only audit of the TUI's host-coupled capabilities mapped against the
host's Remote API surface, with gap analysis and an engineering-effort
estimate for the client-mode port. Sources: TUI sources in
`packages/runtime/src`, `packages/kit/src`, `packages/shell/src`; host
closure package READMEs and generated `typert.remote-client.d.ts`
artifacts in the installed `@deepseek-ai/dsh` dependency tree.

## 0. Transport ground truth

A non-page (non-browser) client is a first-class citizen of the host
Remote stack:

- `dsh-client-connection`: Node clients import `./client`
  (`lib/client.node.js` ESM). `GET /connect?token=...&interactions=answer`
  creates a Peer with **owner principal** plus a signed API cookie and
  returns the mux destination. Unary RPC is HTTP POST `/api`; streams
  multiplex over the `/api/remote.mux` WebSocket; the internal `$events`
  logical stream is the sole host-to-client push source and opens with a
  `{type:'ready', clientId, host:{home}}` frame. Non-page carriers may
  alternatively supply `ClientTransportHooks.createWebSocket` with a
  `streamBaseUrl`.
- `dsh-api-gateway`: waterfalls (`$events` / `$events/result`) require
  `peer.interactions === 'answer'`; **owner** peers receive and answer
  forwarded waterfalls, so an API peer from `/connect?interactions=answer`
  qualifies. Non-owner peers only receive policy-allowed broadcasts
  (`dsh-api-remote-access`).
- `dsh-api-remotes` README: "Its Client face can be reused by Web or a
  future TUI that provides the same React-free `ctx.remote` contract."
- Forwarded-event allowlist (`dsh-api-remotes/lib/types/remote-events.js:16-45`):
  `approval/request` (waterfall), `user-questions/request` (waterfall),
  `api-session/added|removed|status|activity|error` (emits), `commands/change`,
  `credentials/*`, `settings/document-updated`, `plugin-manager/*`,
  `agent-preset/selected`, `schedule/changed`, `permission-presets/catalog-changed`,
  and others.

Consequence: the in-process cordis `ctx.*` seams of `HostSession` map to
`remote.<ns>.<method>` calls plus `$events` subscriptions. The raw
`session/event` firehose is **not** forwarded; its durable subset arrives
via `session/follow` (journal stream) and `session/control` (projection
snapshot stream), which is the designed replacement.

## 1. Mapping table

TUI refs are relative to `packages/shell/src` unless prefixed. `host-session.ts`
= `packages/shell/src/host-session.ts`, `ShellHost.tsx` =
`packages/shell/src/ShellHost.tsx`. Host-closure refs are
`<package>/<file>` inside the installed `@deepseek-ai/dsh` closure.
Verdicts: FULL (remote API covers it), PARTIAL (needs client-side shaping
or aggregation, or a degraded path), MISSING (no remote equivalent).

| # | Capability | Direction | Today's seam (file:line) | Remote equivalent (host closure ref) | Verdict |
|---|---|---|---|---|---|
| 1 | Turn: send prompt, fresh/resumed session | TUI→host | host-session.ts:804-863 (`ctx.agents.create` + `agent.followup`, `createUserMessage`) | `session/create` (sessionId, cwd/workspaceId, agentPreset) + `session/prompt` (requestId, content[], mode) — `dsh-api-session-controller/lib/types/types.d.ts:284,332` | FULL |
| 2 | Streaming text deltas | host→TUI | host-session.ts:1228-1281 (`agent/assistant-stream` text-delta) | `session/follow({assistantStream:true})` → `assistant-stream` frames (start/chunk/end, reconnect baseline with compact stream) — types.d.ts:482-535 | FULL |
| 3 | Streaming thinking deltas | host→TUI | host-session.ts:1247 (reasoning-delta) | same assistantStream chunk stream | FULL (chunk payload is JsonValue; verify reasoning-delta presence at impl) |
| 4 | Turn end / errors | host→TUI | host-session.ts:1283-1289 (`agent/status`), :1352-1359 (`session/event` `turn/end`) | durable `turn/end` on follow + `api-session/status` emit (running bool) + `api-session/error` | FULL |
| 5 | Token usage (prompt/completion/cache) | host→TUI | host-session.ts:1253-1272 (usage chunk) | assistantStream usage chunk (verify) + durable `assistant/message` usage fields (already parsed at :1013) | PARTIAL (client-side aggregation; prompt-token assignment semantics to confirm) |
| 6 | Tool calls/results in dock | host→TUI | host-session.ts:1307-1351 (`tool/call`, `tool/result` incl. image path regex) | same durable events on `session/follow` (tool args/result pass through unchanged per session-controller README) | FULL |
| 7 | Tool approval waterfall (y/n card) | both | host-session.ts:1366-1382 (`approval/request` waterfall, returns "allowed-once"/"rejected"); ShellHost.tsx:1095-1113 | `approval/request` forwarded waterfall over `$events` (owner, interactions=answer); client answers via `$events/result` — `dsh-api-remotes/lib/types/remote-events.js:18`, `dsh-api-gateway` README | FULL |
| 8 | ask_user overlay | both | host-session.ts:248-275 (`user-questions/request` waterfall); ShellHost.tsx:299-328 | same waterfall; alternative RPC: `userQuestions/answer` + `userQuestions/attachWait` (remainingMs stream) — `dsh-user-questions/lib/typert.remote-client.d.ts` | FULL |
| 9 | Steer mid-turn input | TUI→host | host-session.ts:1186-1193 (`agent.steer`); ShellHost.tsx:1033-1038 | `session/prompt` with `mode:'steer'` | FULL |
| 10 | Message queue | TUI→host | ShellHost.tsx:903-910, 1149-1153 (client-local queue) + steer | client-local queue (unchanged) or host-side: `mode:'queue'` + `session/updateQueue` (QueueDock edit/remove) | FULL |
| 11 | Abort turn | TUI→host | host-session.ts:1168-1183 (dispose handle) | `session/cancel` | FULL |
| 12 | /new fresh session | TUI→host | host-session.ts:143-156 | new `session/create` (new sessionId); blank-reuse rules host-native | FULL |
| 13 | Session list (/sessions) | TUI→host | host-session.ts:208-240 (`sessionPersistence.list` + retention filter) | `session/list` (SessionSummary: running/blank/cwd/parentSessionId/formatStatus/projections); retention filter stays client-side | FULL |
| 14 | Stored transcript replay on resume | both | host-session.ts:176-205 (`persistence.open(id,'read')` drain) | `session/page` (backwards journal pages) + `session/follow` opening snapshot (records+cursor) | FULL |
| 15 | /resume + single-writer guard | both | host-session.ts:164-168, 826-838 (`SessionAlreadyOwnedError`) | resume via `session/create` on stored id (writer lock retained); blocked resume returns `session/writer-held` — session-controller README | FULL |
| 16 | Idle-release write lock (takeover contract) | TUI→host | host-session.ts:868-919 (dispose after idle, reattach + wake diff) | host writer lock is native; `session/follow` read-only watch needs no lock; wake diff = follow opening snapshot. TUI-side mechanism deleted | FULL (host-native; TUI code removal) |
| 17 | /tail read-only watch of another process's session | host→TUI | host-session.ts:513-584 (zstd CLI poll of ~/.dsh/sessions) | `session/follow` on that sessionId (no activation needed); reconnect gap repair via tail page | FULL (strictly better than today) |
| 18 | /history turn grouping + fork-at-turn | both | host-session.ts:1057-1139 (`session.snapshotEvents()`, `agents.create` with seed) | `session/fork` (`atSeq` exact prefix; omission = latest completed turn) — types.d.ts:320; turn grouping client-side from follow records | FULL |
| 19 | /search full-text | TUI→host | host-session.ts:587-599 (`sessionQuery.searchSessions`) | `session/search` (query → items + hasMore) | FULL |
| 20 | /session rename | TUI→host | ShellHost.tsx:911-915 (today echoes only; host session-title plugin names) | `session/rename` (title → normalized title + seq) | FULL |
| 21 | /model catalog + switch + /think effort | both | host-session.ts:101-140 (`llm.listConfigurableProviders/listModels`, `#override`), features/model-select.tsx:33-95 | `session/modelCatalog` (host-generation catalog), `session/selectModel` (ModelSelection `{provider,model,reasoningEffort?}` — types.d.ts:92-96), `llm/listProviders`, `llm/listConfigurableProviders` | FULL |
| 22 | Model default / cold-boot label | TUI→host | host-session.ts:90-94 (`agentDefaultModel.currentSelection`) | model-selection projection on `session/projections` / `session/control` (lastUsed/pending — types.d.ts:98-110); `session/initializeDefaultModel` | PARTIAL (shape differs; mapping work) |
| 23 | /preset list + switch | TUI→host | host-session.ts:342-360 (`agentPresets.remoteExportList`) | `agentPresets/list`, `agentPresets/read`, `agentPresets/select` — `dsh-agent-preset-registry/lib/typert.remote-client.d.ts`; preset at create via `session/create.agentPreset` | FULL |
| 24 | /login //logout (credentials + route registration) | TUI→host | host-session.ts:288-304 (`credentials.set/unset`), features/login.tsx:113-127 (`settings.mutate('llm-pi-ai')`) | `credentials/describe`, `credentials/set`, `credentials/unset` + `settings/describe`, `settings/mutate` — `dsh-api-settings-controller/lib/typert.remote-client.d.ts` | FULL |
| 25 | /settings browse + mutate | both | host-session.ts:602-618 (`settings.describe/mutate`); ShellHost.tsx:934-964 | `settings/describe`, `settings/mutate`, `settings/update`, `settings/replace`; `settings/document-updated` push event | FULL |
| 26 | Host slash commands (plan/compact/…) | both | host-session.ts:309-335 (`commands.list/execute`); ShellHost.tsx:251-257, 494-500 | `commands/list`, `commands/execute` (agent-scoped, SessionId) — `dsh-commands/lib/typert.remote-client.d.ts` | FULL |
| 27 | /skills | TUI→host | host-session.ts:714-727 (`skills.list`) | `skills/list` (session-scoped catalog, non-activating) | FULL |
| 28 | /plugins list | TUI→host | host-session.ts:744-763 (reads profile package.json) | `pluginManager/listPlugins`, `pluginInventory/list`, `pluginMarket/*`; `plugin-manager/changed` push | FULL |
| 29 | /reload plugin hot-reload | TUI→host | host-session.ts:730-740 (`loader.reload`) | none — pluginManager offers install/enable/remove but no live reload of a running tree | MISSING (workaround: host restart + auto-reconnect) |
| 30 | /agents view + edit (~/.dsh/agents/*.md) | both | host-session.ts:453-507 (direct FS read/write) | none. Read-only single-file fetch exists (`GET /api/file?path=`, 20 MiB cap — session-controller README) but no directory list and no write | MISSING (write); PARTIAL read |
| 31 | /repair session-log scan | TUI→host | host-session.ts:653-711 (walks ~/.dsh/sessions, checks zstd/jsonl) | none remote; partial signal via `session/list` `formatStatus:'migration-required'` | MISSING (degrade to formatStatus display) |
| 32 | /btw side question | both | host-session.ts:378-442 (one-shot `agents.create` + stream + `turn/end`) | second `session/create` (fresh id) + `prompt` + follow; no in-process one-shot — heavier, pollutes session list | PARTIAL (works; needs shaping + cleanup) |
| 33 | Subagent panel (adopt children, rounds/model/status, transcript viewer, steer child) | host→TUI / TUI→host | host-session.ts:921-1054 (firehose header adoption, tool-workflow pairing, `steerChild` :941-950) | children from `session/list` rows (`parentSessionId`, `origin:'subagent'`, delegationDepth) + `api-session/added/removed` + control projections; child transcript via `session/follow` with `address.kind:'subagent'`; steer via `subagents/prompt`, interrupt via `subagents/interruptByParent` — `dsh-subagent/lib/typert.remote-client.d.ts` | PARTIAL (aggregation work; steer limited to continuable children) |
| 34 | Todos widget | host→TUI | host-session.ts:1315-1318 (`todo/write` event) | durable `todo/write` on follow (whole-list snapshot semantics preserved — `dsh-tool-todo/lib/types`) | FULL |
| 35 | /attach image → next prompt | TUI→host | host-session.ts:1153-1163 (`attachments.saveImages`), :849-858 | `fileUploads/upload` (receipts) → `session/prompt` content part `{type:'file',receiptId}` or inline image part — types.d.ts:79-90; read back via `session/attachment` / `GET /api/file` | FULL |
| 36 | Tool-result images in panel | host→TUI | host-session.ts:1330-1343, ShellHost dock | image path in tool result text; bytes via `GET /api/file?path=` | FULL |
| 37 | executionMode badge (native/ptc) | TUI→host | host-session.ts:774-783 (`tools.schemas` probe) | no direct equivalent; infer from `agentPresets/read` document or pluginInventory | PARTIAL |
| 38 | Status bar: phase, elapsed, tok/s, clock, context % | client | ShellHost.tsx:1322-1359, 205-215; kit/status-bar.tsx | pure client-side (computed from row-5 data) | FULL (client-local) |
| 39 | Git branch powerline segment | client→(host cwd) | ShellHost.tsx:277-295 (`child_process git` on process.cwd) | no git namespace. Options: `terminal/create` + `attach` and run git (heavy), or client-local FS/probe | PARTIAL |
| 40 | keybindings.json load | client | host-session.ts:367-373 (profile file), ShellHost.tsx:173 | client-local file on the client machine | FULL (client-local; path semantics change) |
| 41 | Plugin config (favorites/hidden, dockRows, askUserTimeoutSec, retention, maxAgents gate, statusVerbs) | client | host-session.ts:623-649, ShellHost.tsx:183, 317, 1098-1104 | client-local (workspace `./.dsh/` overlay per ADR-0005 decision 4); maxAgents stays an onApprove-layer gate | FULL (client-local; new overlay mechanism) |
| 42 | Theme + i18n + welcome banner | client | kit/theme.ts, themes-*.ts, i18n.ts | client-local | FULL |
| 43 | Transcript windowing, dock widgets, overlays, palette, stop-confirm, history recall | client | kit/*, features/dock.tsx, ShellHost.tsx:1163-1310 | pure client rendering, untouched | FULL (no host coupling) |
| 44 | Surface protocol (declarative widgets) | client | `packages/runtime/src/protocol.ts`, surface-service.ts | `SurfaceStore` reserved in ShellHost (:30-33), not host-coupled; no remote needed for v1 | FULL (client-local / out of scope) |
| 45 | Connection lifecycle, reconnect, auth | new | n/a (in-process today) | `/connect` token→cookie, `/api` POST, mux WS, `$events` generation + ConnectionController retry caps — `dsh-client-connection` README | new build (effort bucket a) |

## 2. Gap list — what is concretely missing

1. **/agents write** (`agentSet`): no remote write path for
   `~/.dsh/agents/*.md`; no remote directory listing of `~/.dsh` either.
   v1 single-machine topology: read/write via client-local FS (host and
   client share the filesystem), or read-only degrade via
   `GET /api/file?path=` per known filename.
2. **/reload**: no remote live-plugin reload. plugin-manager events
   notify changes; applying them needs a host restart. Workaround: host
   restart + TUI auto-reconnect.
3. **/repair**: raw session-store scan is local-FS only. In the
   single-machine topology the client can run the same scan locally over
   `~/.dsh/sessions`; remote deployments degrade to `session/list`
   `formatStatus` reporting.
4. **Git segment**: no VCS namespace on the remote surface. In the
   single-machine topology the client keeps its local `git` probe;
   remote deployments drop it or run it through `terminal/create`.
5. **Usage/token telemetry**: no dedicated usage RPC; rebuilt
   client-side from assistantStream chunks and/or durable
   `assistant/message` usage fields; prompt-token "context size"
   semantics need runtime verification.
6. **Cold-boot model label / default-model projection**: exists as
   projection data but the `agentDefaultModel.currentSelection()`
   one-shot read has no 1:1 remote; rebuilt from `session/projections` +
   `modelCatalog`.
7. **/btw**: no one-shot throwaway-agent RPC; implemented as a real
   second session (create + prompt + follow + cleanup).
8. **Subagent child steer**: `subagents/prompt` rejects
   non-continuable/one-shot/cold children (host policy); today's
   in-process `agent.steer` on any live child is stronger.
9. **`process.cwd()` assumptions**: welcome banner, session create `cwd`,
   git probe all assume the TUI runs in the workspace; client mode takes
   cwd from the `session/follow` header (`SessionWireHeader.cwd`) / the
   `session/create` argument.
10. **Token acquisition**: the launch token exists only in the printed
    `dsh web:` URL line (and browser cookie); no file/env machine
    contract for headless supervisors.

## 3. Effort estimate

One senior dev, familiar with both codebases, no host-side changes
available. Ranges are honest, not padded.

| Bucket | Contents | Days |
|---|---|---|
| (a) Client transport + connection lifecycle | Mount `dsh-api-remotes` client contributions (cordis ctx inside the TUI process, `lib/client.node.js`); `/connect` token→cookie flow; cookie persistence; mux WS + `$events` with `interactions:'answer'`; generation readiness gating; reconnect/backoff; `RemoteResult`→error mapping; token discovery UX (user-pasted URL vs parsed stdout). | 4–7 |
| (b) Per-gap work | `RemoteHostSession` behind the existing `TurnCallbacks`/facade: turn/create/prompt/follow(assistantStream)/control mapping; approval + ask waterfalls; cancel; fork; page/follow transcript replay; search; rename; selectModel + effort ladder; presets; login/logout (credentials+settings); skills; plugins; queue; /tail→follow; subagent panel aggregation; /btw second-session flow; usage aggregation. | 8–14 |
| (c) TUI rendering refactor | ShellHost/Kit largely survive (they already render from callbacks). Remove `process.*` assumptions (cwd, child_process git, process.exit), swap `HostSession`→`RemoteHostSession` at the one injection point (host-entry.tsx:55, ShellHostDeps.session), generation-guard replays against a remote journal. | 3–6 |
| (d) Workspace-local config overlay | New client-side mechanism: `./.dsh/` overlay (theme, model prefs/favorites/hidden, dock sizes, keybindings) merged over profile config with defined precedence (env > workspace > profile); `/config` surface reads/writes it. | 2–3 |
| (e) Host lifecycle manager | Spawn the host profile (single-instance lock), readiness/token capture from the stdout URL line, health probe, refcount (multiple TUIs), `idleExitSec` idle exit (default 60, 0 = resident), crash/restart policy, stale-host adoption, version-skew guard. | 4–8 |
| Integration + E2E | Extend the existing harness (`packages/shell/scripts/e2e-live.mjs`, `e2e-fork.mjs`, `smoke-boot.mjs`) to a two-process topology; reconnect/kill-recovery tests. | 3–5 |
| **Total** | | **27–48 person-days** (mid ≈ 35) |

Key assumptions:

- The TUI ships as a separate client binary that still renders with
  `@opentui/*` locally (the `--experimental-ffi` flag stays a
  client-machine concern).
- The dsh client stack (`dsh-client-connection`, `dsh-api-remotes`
  client artifacts, `dsh-typert-protocol`) is resolvable as npm
  dependencies and kept **external** in the bundle (like today's
  dsh-llm symlink), pinned to the installed dsh version.
- Owner principal via `/connect` is the accepted security posture
  (local user machine; the TLS/proxy guidance in the dsh-web-app README
  applies to remote deployment).
- v1 targets full capability parity, exploiting the single-machine
  topology (client-local FS/process for /agents, /repair, git) instead
  of degrading UX; remote (non-local) deployments would degrade those
  three.
- No DeepSeek-side changes are available; every gap is worked around
  client-side.

Top risks:

1. **Client SDK inside the TUI process** — mounting the generated
   `/remote` contributions pulls cordis + the client SDK into the
   OpenTUI process; if it conflicts with the Bun bundling / FFI
   `NODE_OPTIONS` posture, fall back to a sidecar Node process bridged
   over IPC (+3–5 d).
2. **Version skew** — strict Typert descriptor validation fails hard on
   TUI/host mismatch; needs a startup compatibility check and a
   documented pin.
3. **assistantStream chunk semantics** (usage chunk presence,
   live-chunk ordering/replay) — verification risk with a durable-events
   fallback already understood.
4. **Token capture fragility** — stdout-line parsing of `dsh web:` is an
   undocumented contract; a dsh update can break bucket (e).
5. **Waterfall plumbing** — any mistake in `interactions` or peer
   lifecycle yields `gateway/interactions-forbidden`; peer lifetime must
   be handled carefully (peer disposal closes the mux and ends
   `$events`).
6. **Writer-lock semantics differ** — today's `SessionAlreadyOwnedError`
   handling becomes `session/writer-held` + `session/create` reuse
   rules; the idle-release machinery is deleted, so the multi-surface
   takeover story needs regression tests.

## 4. Requires DeepSeek-owned (host-side) changes

None are **required** for the core loop: chat, streaming, approvals,
ask_user, sessions/history/fork/search, models, login, settings, skills,
plugins list, queue, steer, tail are all covered today by the owner-peer
Remote API. The following are quality gaps only a host change can close
properly (items 1–3 have viable client-side degradations for v1; 6 is
the one to escalate first because the host lifecycle manager depends on
it):

1. Remote CRUD (write + list) for `~/.dsh/agents/*.md` agent
   definitions — restores full /agents for remote deployments.
2. Remote session-store integrity scan (or read-only persistence-handle
   RPC) — restores /repair for remote deployments.
3. Remote trigger for live plugin reload — restores /reload without a
   host restart.
4. A VCS/git-status remote namespace — restores the powerline git
   segment cleanly for remote deployments.
5. Subagent steer for one-shot/non-continuable children — restores
   parity with in-process `agent.steer`.
6. A machine-readable readiness/token handshake (file or env instead of
   the printed URL line) — de-risks the host lifecycle manager.
7. If the assistantStream compact frames turn out not to carry usage
   chunks: a usage surface on follow/projections.
