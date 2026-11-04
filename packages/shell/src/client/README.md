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
| `remote-follow.ts` | `session/follow({assistantStream:true})` consumption → TurnCallbacks shapes (deltas/usage/tools/todos/turn-end; audit rows 2–6, 34). |
| `remote-waterfall.ts` | Forwarded `$events` waterfall claim + `$events/result` answering (approval + user-questions; audit rows 7–8). |
| `remote-host-session.ts` | `RemoteHostSession` — the HostSession-shaped session facade over RPC + `$events` (bucket (b) wave 1). |
| `workspace-config.ts` | Workspace-local `./.dsh/config.yml` overlay (bucket d). |
| `lifecycle.ts` | Host process lifecycle (separate agent; bucket (e)). |

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
  label: string                  // powerline model segment; "reconnecting…" during a mid-turn gap
  usage: { prompt, completion, cacheRead, cacheWrite }
  lastTurnStats: TurnStats
  start(): Promise<ClientReadyInfo>          // connect + begin $events routing (turn() calls it lazily)
  turn(userText, cb: TurnCallbacks, signal?): Promise<void>  // session/create + session/prompt{mode:'queue'}; awaits durable turn/end
  steer(userText): void                       // session/prompt{mode:'steer'}
  abort(): void                               // session/cancel; next send is a FRESH session (host-session parity)
  newSession(): void                          // next send creates a new session
  resumeSession(id): "ok"                     // next send re-creates with the stored id (writer-held → takeover error)
  registerAskProvider(onAsk): void            // user-questions waterfall prompt target
  currentSessionId(): string | undefined
  dispose(): Promise<void>                    // close the carrier; no listeners left behind
  // … HostSession-shaped wave-2/3 stubs for the rest of the surface (listSessions,
  //   storedTranscript, forkAtTurn, searchSessions, presets, credentials, settings,
  //   commands, skills, plugins, /agents, /repair, /tail, subagents, /btw, attachImage)
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
  ("reconnecting…"), the snapshot's missed durable rows ride
  `cb.onReattachedMissed`, and the active attempt's compact stream replays as
  deltas below the host's dense-index baseline (journal-tail page repair is
  wave 2).
- Tests: `test/remote-host-session.test.ts` (fake connection + fake mux
  sockets), `test/remote-live-smoke.test.ts` (env-gated:
  `DSH_REMOTE_SMOKE=1 bun test test/remote-live-smoke.test.ts`).

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
