# src/client — client-mode transport + connection lifecycle

Client-mode port (ADR-0005), bucket (a): the connection carrier for a
non-page dsh client. Plugin mode is untouched; these modules are the
foundation the lifecycle manager (`lifecycle.ts`, bucket (e)) and the
Remote session layer (bucket (b)) build on.

## Module map

| File | Role |
|---|---|
| `cookie-mint.ts` | Mint the Host API cookie from `$DSH_HOME/.credentials.yaml` (owner grant). |
| `mux-frame.ts` | Pure mux frame + `$events` item validation (gateway parity). |
| `events-source.ts` | The `$events` generation source: mux WebSocket pump. |
| `transport.ts` | `ClientConnection` — the facade over `dsh-client-connection`'s installConnection. |
| `remote-stream.ts` | One logical Remote stream on the mux WebSocket (`session/follow` et al). |
| `remote-follow.ts` | `session/follow({assistantStream:true})` consumption → TurnCallbacks shapes (deltas/usage/tools/todos/turn-end; audit rows 2–6, 34) + the optional `onRecord` seq ledger hook and clean compact-stream replay (wave 2). |
| `remote-waterfall.ts` | Forwarded `$events` waterfall claim + `$events/result` answering (approval + user-questions; audit rows 7–8). |
| `remote-host-session.ts` | `RemoteHostSession` — the HostSession-shaped session facade over RPC + `$events` (bucket (b), waves 1 + 2: turn lifecycle, waterfalls, session ops, model, presets, credentials/settings, commands/skills/plugins, tail, status surface). |
| `remote-session-ops.ts` | Session-side ops (wave 2): `session/list` + retention filter, stored transcript via page/follow snapshot, search/rename/fork, skills/commands, journal mappers (turn grouping, tail rows), `RemoteTailSession` (foreign follow + page gap repair; rows 13–20, 26, 27, 17). |
| `remote-model.ts` | Model routes (wave 2): `session/modelCatalog` + `selectModel` round-trip, provider catalog, projections-based live selection, catalog-default cold-boot label (rows 21–22). |
| `remote-settings.ts` | Settings + credentials (wave 2): `settings/describe|mutate|update|replace` shaped to the in-process seams, `credentials/describe|set|unset` (rows 24–25). |
| `remote-local-fs.ts` | Client-local FS clusters (wave 3): `/agents` read/write over `<dshHome>/agents/*.md` (tui-pi frontmatter parity: CRLF/quotes/deep default/name==file, in-place write-back) + the `/repair` session-store scan — injectable home (rows 30–31). |
| `remote-agent-profiles.ts` | Agent model/thinking composition (tui-pi agent-runtime parity): nearest `.dsh-profile` pin (+) `model-profiles.json` overrides; pinned commits write `profiles[].agents[name]` atomically, unpinned commits write the frontmatter. The store's `current` is NOT reused (that key drives `agent/config.ts`). |
| `remote-git.ts` | Client-local `git branch --show-current` probe (wave 3; row 39 — no VCS namespace on the wire). |
| `remote-exec-mode.ts` | `agentPresets/read` entry-list scan for the `tool-presentation` row's `mode` — the executionMode badge discriminator, with the documented deployment-default assumption (row 37). |
| `remote-attachments.ts` | `/attach` staging → inline `session/prompt` image parts (the wire-chosen route over upload receipts — the doc says why), `session/attachment` read-back, `GET /api/file?path=` bytes helper (rows 35–36). |
| `remote-btw.ts` | `/btw` second-session flow (create + follow + prompt), reused throwaway session, `btw:` marker rename + listSessions filter — the documented pollution cap (row 32). |
| `remote-subagents.ts` | Subagent panel aggregation (wave 3): `session/list` adoption + `api-session/*` pushes + parent-journal tool-workflow pairing, child transcript via `session/follow` `address.kind:'subagent'`, steer via `subagents/prompt` (typed `subagent/not-resumable` policy surface), interrupt via `subagents/interruptByParent` (row 33). |
| `remote-restart.ts` | Same-port host restart for `/reload` over the lifecycle lockfile contract: SIGTERM → same-port respawn → listener wait → cookie re-mint (row 29). |
| `shell-session.ts` | The ShellHost-consumed session surface (bucket c): the structural subset ShellHost + its features touch, with compile-time conformance guards — the client entry passes RemoteHostSession under the plugin-mode HostSession type, and this file fails tsc on surface drift instead of letting it surface as a boot crash. |
| `workspace-config.ts` | Workspace-local `./.dsh/config.yml` overlay (bucket d). |
| `lifecycle.ts` | Host process lifecycle (separate agent; bucket (e)). |

## Entry wiring (`src/client-entry.tsx`, bucket (c))

`bootClient()` chains the boot with injectable seams (all faked in
`test/client-entry.test.ts`): `ensureHost({profile:'opentui',
idleExitSec:60})` → `ClientConnection({authority, cookieHeader})` →
`RemoteHostSession` (cwd = launch workspace, dshHome/profile from the host
handle) → `session.start()` → bounded wait for the cold-boot model label →
`bootRuntime` render of ShellHost (zero ShellHost edits; the remote session
rides the HostSession type under the `shell-session.ts` guard). Theme comes
from `configLoad().theme` post-start (overlay cache warm; env still wins in
ShellHost). The wave-2 usage finding (row 5) is injected client-side too:
`aggregateTurnContext` rewrites the turn-end hand-off's `prompt` to
`prompt + cacheRead + cacheWrite` — the 🧠 status-bar context percent reads
exactly that value, and ShellHost's own bundle stays byte-identical
(dist-host zero-diff gate). Shutdown routes every exit path (`/quit`,
Ctrl+C via the process.exit interception, renderer exit,
SIGINT/SIGTERM/SIGHUP) through `dispose()` → `host.release()` — never
`host.dispose()` — and on a last-ref release spawns the DETACHED idle
reaper (`scripts/idle-reaper.mjs`): the lifecycle's idle timer is
unref()ed and would die with the quitting process, so the reaper idles the
host out after `idleExitSec` (SIGTERM→SIGKILL) and clears the lockfile,
unless a fresh boot replaced the host or a client re-attached inside the
grace window (established connections to the host port — the adoption
liveness marker; tested behaviorally in `test/idle-reaper.test.ts`). The
`@opentui/solid/preload` import stays first in the entry AND the launcher
passes it as `bun --preload`: bun transpiles the whole import graph before
executing, so a runtime registration alone is too late for kit's .tsx
modules, and bunfig preload only applies from packages/shell's cwd while
the client runs from arbitrary workspaces. Tests:
`test/client-entry.test.ts` (fakes; the real boot is the tmux gate).

## Contracts

### `mintOwnerCookie` (cookie-mint.ts)

```ts
function mintOwnerCookie(options: { home: string; authority: string; maxAgeMs?: number }): string
```

- Reads `<home>/.credentials.yaml`, record
  `records["client-connection/browser-session"]` (`kind: grant`,
  `payload.version: 1`, 43-char base64url `secret` = 32-byte HMAC key).
- Returns the full `Cookie` header value:
  `dsh-auth-<b64url(sha256(authority))>=v1.<b64url(JSON{version,authority,issuedAt,expiresAt})>.<b64url(HMAC-SHA256(secret, body))>`
  where `body` is the middle b64url segment. `authority` is `host:port`
  (scheme omitted — HTTPS audiences carry the scheme inside the payload,
  which v1 does not support; ADR-0005 is a local HTTP listener).
- `maxAgeMs` defaults to the host's 30-day `cookieMaxAgeDays` window and is
  clamped to it (larger values would be rejected by the host).
- Typed errors (all extend `OwnerCookieError`): `CredentialsFileMissingError`
  (no file within the 2s first-boot retry window),
  `CredentialsGrantMissingError` (no record within the window),
  `CredentialsGrantInvalidError` (wrong kind / rotated version / bad secret
  shape), `CredentialsFileInsecureError` (file is group/other readable —
  fail closed), `CredentialsParseError` (file violates the credentials
  subset). The caller re-mints on missing/rotated grants after refreshing
  state.
- Security: the secret and any cookie material NEVER appear in error
  messages (tests string-scan every thrown message).

### `ClientConnection` (transport.ts)

```ts
type ClientConnectionState = "connecting" | "connected" | "disconnected"

interface ClientReadyInfo {
  clientId: string
  host: { home: string }
}

class ClientConnection {
  constructor(options: {
    authority: string          // "host:port" — cookie audience + URL authority
    cookieHeader: string       // full "name=value" Cookie header (from mintOwnerCookie)
    baseUrl?: string           // default http://<authority>
    recovery?: Partial<ConnectionRecoveryConfig>  // defaults = host documented caps
  })
  connect(): Promise<ClientReadyInfo>
  rpc<T = unknown>(method: string, args?: Record<string, unknown>, signal?: AbortSignal): Promise<T>
  onEvent(handler: (item: EventsItem) => void): () => void
  getState(): ClientConnectionState
  onStateChange(listener: (state: ClientConnectionState) => void): () => void
  close(): Promise<void>
}

class RemoteRpcError extends Error { code: string; details: Record<string, unknown> }
class RpcTransportError extends Error {}
class ConnectionClosedError extends Error {}
```

Input shape from the lifecycle manager: `{ authority, cookieHeader }` —
this module never spawns hosts and never mints cookies.

Semantics:

- `connect()` starts the SDK (`dsh-client-connection`) connection loop and
  resolves with the first validated `$events` ready frame
  (`{clientId, host:{home}}`). The loop then keeps reconnecting forever;
  ongoing health is observed via `getState()` / `onStateChange()`.
  Reconnect timing mirrors the host's documented caps: 500ms base, factor 2,
  10s max, 50–100% jitter, 3s slow-handshake warn, 15s readiness deadline.
- Generation gating is the SDK's: `connect()` resolution and event delivery
  happen only after the ready item; a stream end/error/malformed frame
  invalidates the generation and the loop reconnects.
- `rpc(method, args)` posts `{type:"client-request", rpcId, method,
  payload:{args}}` to `POST <base>/api/<method>` with the cookie; envelope
  validation (rpcId correlation, multipart binary responses) is the SDK's.
  A host failure envelope throws `RemoteRpcError` (`code`, `details`);
  transport failures throw `RpcTransportError`. Calling while disconnected
  is allowed (the cookie may still be valid) and fails with a typed error
  if the transport is actually down.
- `onEvent(handler)` receives RAW `$events` items after the opening frame:
  `{type:"emit", event, args}`, `{type:"waterfall", event, eventId,
  agentId, request}`, `{type:"cancel", eventId}`. The ready frame is
  consumed as the gate and is NOT delivered. Waterfalls are not answered
  for you — the consumer replies via
  `rpc("$events/result", { clientId, eventId, outcome })` (clientId from the
  `connect()` result; outcome `{kind:"next"}` / `{kind:"result", value}` /
  `{kind:"rejected", error}`). Handler exceptions are contained and logged.
- `close()` stops the loop, closes the socket, publishes `disconnected`,
  and rejects a pending `connect()` with `ConnectionClosedError`.
  Idempotent.

### `RemoteHostSession` (remote-host-session.ts)

```ts
class RemoteHostSession {
  label: string                  // powerline model segment; cold-boot label from modelCatalog.default (row 22)
  status: RemoteSessionStatus    // wave-2: {connection, turn: idle|starting|running|reconnecting, sessionAttached, tailActive}
  usage: { prompt, completion, cacheRead, cacheWrite }
  lastTurnStats: TurnStats
  // — wave 1 (frozen) —
  start(): Promise<ClientReadyInfo>          // connect + begin $events routing + cold-boot label (turn() calls it lazily)
  turn(userText, cb: TurnCallbacks, signal?): Promise<void>  // session/create + session/prompt{mode:'queue'}; awaits durable turn/end
  steer(userText): void                       // session/prompt{mode:'steer'}
  abort(): void                               // session/cancel; next send is a FRESH session (host-session parity)
  newSession(): void                          // next send creates a new session (fresh client-minted id — row 12)
  resumeSession(id): "ok"                     // next send re-creates with the stored id (writer-held → takeover error, row 15)
  registerAskProvider(onAsk): void            // user-questions waterfall prompt target
  currentSessionId(): string | undefined
  dispose(): Promise<void>                    // close carrier + tail; no listeners left behind
  // — wave 2 (rows 12–28 + 22) —
  switchModel(provider, model, effort?)       // live session → session/selectModel; else staged onto the next create
  selectModel(sel): Promise<ModelSelection>   // session/selectModel round-trip (host-resolved acceptance)
  modelCatalog() / defaultModelSelection() / currentModelSelection() / initializeDefaultModel()
  listSessions(limit?)                        // session/list + retention filter (subagent rows out, retentionDays, capped)
  storedTranscript(id, skip?)                 // session/page backwards fills over the follow opening snapshot
  renameSession(title)                        // session/rename → {title, seq}
  searchSessions(query)                       // session/search ([] when the deployment's index is openAt:never)
  historyTurns()                              // client-side turn grouping from the follow record ledger
  forkAtTurn(seqEnd?)                         // session/fork (omission = latest completed turn) + facade switch
  listPresets() / readPreset(id) / selectPreset(id)   // agentPresets/list|read|select
  listHostCommands() / executeHostCommand(line)       // commands/list|execute (agent-scoped; [] without a session)
  credentialStatus(ref) / login(ref, key) / logout(ref)  // credentials/describe|set|unset
  settingsSeam / settingsDescribe() / settingsMutate() / settingsUpdate() / settingsReplace() / settingsDocument()
  listSkills() / refreshSkills()              // skills/list (session-scoped; sync cache + async refresh)
  listPlugins() / refreshPlugins()            // pluginManager/listPlugins (+listBundles versions; built-ins out)
  startRemoteTail(id) / stopRemoteTail()      // read-only foreign session/follow + page gap repair (row 17)
  onSettingsUpdated / onHostCommandsChanged / onPluginsChanged / onCredentialUpdated   // $events push listeners
  // — wave 3 (rows 29–37 + 39 + 41; full parity, see remote-host-session.ts header) —
  listAgents() / agentSet(name, field, value|null)    // client-local ~/.dsh/agents/*.md, COMPOSED model/thinking + pin (row 30)
  agentBody(name) / modelEfforts(provider, model)     // /agents viewer body + the model's real effort ladder
  repairScan()                                       // client-local session-store scan (row 31)
  reloadPlugins() / lastRestartPid()                 // same-port host restart + carrier reconnect (row 29)
  btwAsk(question, snapshot, onDelta?)               // reused throwaway session, btw: marker (row 32)
  childTranscript(id) / steerChild(id, text)         // subagent panel (row 33; steer false =
  steerChildDetailed(id, text) / interruptChild(id)  //   host not-resumable policy, typed reason)
  subagentViews()                                    // panel snapshot (onSubagentUpdate rows)
  attachImage(path) / lastAttachmentIds()            // staged image → inline prompt part (row 35)
  readSessionAttachment(id) / fetchHostFile(path)    // durable read-back + GET /api/file (rows 35/36)
  executionMode()                                    // cached preset-document probe (row 37)
  gitBranch(cwd?)                                    // client-local git probe (row 39)
  configPath / configLoad / configSave / keybindingsLoad / refreshWorkspaceConfig   // row 41
}
```

- Waterfall answers reach the UI synchronously: `approval/request` frames
  claimed by `frame.agentId === sessionId` prompt `cb.onApprove` and answer
  `$events/result` with `"allowed-once"` / `"rejected"` (`"unavailable"`
  fail-closed when no callbacks); `user-questions/request` prompts the
  registered ask provider and answers `{answers:[{id, selected[], custom?}]}`
  (throwing UI → the declined envelope). Not-ours waterfalls answer
  `{kind:"next"}` (delegate).
- Generation change (reconnect): the follow stream re-opens when the carrier
  reports `connected` again; an ACTIVE turn surfaces a `label` swap
  ("reconnecting…") plus `status.turn === "reconnecting"`, the snapshot's
  missed durable rows ride `cb.onReattachedMissed`, the active attempt's
  compact stream replays CLEAN at the dense index already streamed (wave-2
  dedupe), and a journal gap the snapshot window cannot reach is repaired
  from `session/page` before the live frames resume.
- Idle-release (row 16) is HOST-NATIVE: there is no client-side lease
  machinery (no idle timer, no wake-diff base) — the host owns the writer
  lock and the follow read needs none.
- Usage semantics (row 5, wire-verified): every usage chunk ASSIGNS the
  fields it reports; completion accumulates over the session; the context
  size is prompt + cacheRead + cacheWrite (cache-splitting adapters report
  prompt = uncached input only).
- Push events (`$events` emit frames) are routed to listeners:
  `settings/document-updated` (ns, revision), `commands/change`,
  `plugin-manager/changed` (auto-refreshes the plugins cache),
  `credentials/reference-updated`, and — wave 3 — the subagent panel feeds
  `api-session/status|removed|added` (adopted children only).
- Wave-3 seam options: `dshHome` (default `$DSH_HOME`/`~/.dsh`) scopes the
  client-local FS clusters + the restart; `workspaceDir` (default = `cwd`)
  scopes the config overlay; `profile` (default `opentui`); `restartHost`
  overrides the /reload action (default `restartSamePortHost`, which
  reuses the lifecycle lockfile's pid/port and respawns
  `dsh --profile <p> --no-open --port <same>` so the existing carrier
  reconnects and the wave-2 re-attach machinery resumes the session).
- Config seam (row 41): `configLoad()` = profile config.json (plugin
  keys) ⊕ workspace `.dsh/config.yml` (theme + model, bucket-d precedence
  env > workspace > profile) ; `configSave()` routes `theme` and the
  plugin keys to the profile config.json (host-face parity — the F7b
  /theme contract) and `model` to the config.yml overlay. Legacy overlay
  `theme:` keys still win the read until the file is cleaned up.
- Tests: `test/remote-host-session.test.ts`, `test/remote-session-ops.test.ts`,
  `test/remote-model-settings.test.ts` (fake connection + fake mux sockets),
  `test/remote-wave3-local.test.ts`, `test/remote-btw-restart.test.ts`,
  `test/remote-subagents.test.ts` (wave-3 clusters, tmp homes + fakes),
  `test/remote-live-smoke.test.ts` (env-gated:
  `DSH_REMOTE_SMOKE=1 DSH_SMOKE_PROFILE=opentui bun test test/remote-live-smoke.test.ts` —
  wave-1 turn + the full wave-2 capability sweep incl. the row-5 usage
  discriminator and provider-key-rot fallback via selectModel, plus the
  wave-3 sweep: /agents round-trip + /repair on a scratch DSH_HOME,
  attachImage round-trip, /btw, /reload same-port restart + follow
  re-open, git branch, /api/file bytes).

## Events source decision (native vs pump)

`dsh-api-gateway/client`'s native `ClientRemoteEvents` pump was probed and
**mounts cleanly under bun** (cordis `Context` + a stub `typert`
`{contexts:{getClient:()=>undefined}, remotes:{register:()=>()=>{}}}` →
generation published, `$on` subscription works). It is NOT used, because it
intercepts waterfall frames and answers them itself — with the stub it would
auto-answer every forwarded waterfall (`approval/request`,
`user-questions/request`) as `{kind:"next"}`, so the TUI would never see the
frames it must answer in-process. The minimal mux pump
(`events-source.ts`, the proven spike-A recipe) delivers every frame to
`onEvent`. The source is isolated behind `ConnectionGenerationSource`
(the SDK's own registration interface) — swapping in the gateway-native
pump later is a one-constructor change plus a waterfall-answer policy.

## Environment notes

- Runtime deps: `ws` (added to package.json; carries the cookie on the
  upgrade — the global WebSocket cannot send headers). The SDK resolves
  through the global dsh closure via the same symlink mechanism as
  `dsh-llm` (`packages/shell/node_modules/@deepseek-ai/dsh-client-connection`);
  the closure's pinned version is 0.2.1-rc.5, cordis 4.0.5.
- `src/client/ws.d.ts` is a minimal ambient declaration for `ws`; replace
  with `@types/ws` at dependency-sync time if preferred.
- Tests: `test/cookie-mint.test.ts` (fake credentials in tmp dirs),
  `test/mux-frame.test.ts` (parser + pump gating over fake sockets). The
  full facade path is exercised by the live-host probe against
  `dsh --profile web`.
