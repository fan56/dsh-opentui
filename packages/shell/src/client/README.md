# src/client — in-process stdio bridge + session seam

This directory contains the bun-side client for the in-process-only build.
`client-entry.tsx` injects `StdioBridgeTransport` into tui-base's `bootClientV2`;
the transport starts the dsh host with stdio bridge mode enabled and speaks the
ADR-0010 JSON-lines protocol. `BridgeSessionSeam` is the sole session seam.

The HTTP client transport, HTTP host lifecycle, and HTTP mux events pump are
retired. They are not runtime fallbacks.

## Module map

| File | Role |
|---|---|
| `append-system.ts` | Locate, read, and seed `$DSH_HOME/APPEND_SYSTEM.md`; expose the bridge append-system preset block. |
| `boot-shared.ts` | Client error logging, shutdown/exit-path helpers, and persisted theme/motion reads. |
| `bridge-transport.ts` | `StdioBridgeTransport`: spawn the dsh host, correlate JSON-lines requests/replies, forward events, and recover or close the child. |
| `bridge-session-seam.ts` | `BridgeSessionSeam`, the sole `SessionSeam` implementation; bridge protocol errors, event projection, session operations, and honest unsupported/degraded faces. |
| `seam-bootstrap.ts` | Bridge handshake/fingerprint checks, fail-fast diagnostics, seam construction, and recovery orchestration. |
| `bridge-side-session.ts` | Side-session create → prompt → wait flow over bridge requests. |
| `bridge-directory.ts` | Whitelisted projections for provider/model directory and permission-catalog faces. |
| `bridge-goals.ts` | Whitelisted projections for goal results. |
| `bridge-permission.ts` | Whitelisted projection for permission-switch command results. |
| `bridge-plugins-manager.ts` | Whitelisted projections for plugin-manager read faces. |
| `bridge-settings-route.ts` | Host-first settings document and mutation projections. |
| `journal-projection.ts` | Shared durable journal → seam-event projection used by bridge replay/recovery. |
| `local-config-faces.ts` | Local profile config, settings, agents, presets, and login faces, with field-level allow-lists. |
| `profile-constants.ts` | Re-export the shared in-process profile name used by client file access and host spawning. |
| `seam-types.ts` | Transcript row types shared with the v2 view without importing its source graph. |
| `token-estimate.ts` | CJK-aware token estimation for context occupancy. |
| `workspace-config.ts` | Workspace-local `.dsh/config.yml` overlay and env/profile merge rules. |
| `mux-frame.ts` | Pure mux frame and `$events` validation, plus the retained `MuxSocket` / `MuxSocketFactory` types. These types moved here when the HTTP mux events pump was removed; the stdio bridge does not open a mux socket. |

### Retained legacy helpers

The `remote-*` name is historical. The current seam reuses only the local
filesystem helpers and pure projection functions it imports; it does not run an
HTTP remote-session stack.

| File | Current status |
|---|---|
| `remote-local-fs.ts` | Local filesystem helpers remain in use, including home resolution and agent frontmatter edits. |
| `remote-agent-profiles.ts` | Local agent/profile composition helpers remain in use through `local-config-faces.ts`. |
| `remote-follow.ts` | Legacy HTTP stream implementation is not wired into production; pure text/error helpers remain reused by journal projection. |
| `remote-session-ops.ts` | Legacy HTTP operations are not wired into production; `RemoteJournalEntry` and `journalToTranscriptRows` remain reused by the bridge seam. |
| `remote-stream.ts`, `remote-btw.ts`, `remote-model.ts`, `remote-settings.ts` | Retired HTTP runtime helpers; not used by the stdio bridge. |
| `transport.ts`, `lifecycle.ts`, `remote-host-session.ts` | Retired HTTP stubs retained only for legacy script imports; constructors/entry points throw. |
| `remote-attachments.ts`, `remote-exec-mode.ts`, `remote-git.ts` | Legacy helpers retained outside the stdio runtime path. |

In short: legacy helpers retained for pure projection functions and local file
operations; HTTP runtime retired.

## Entry wiring

`src/client-entry.tsx` performs the current composition:

1. Install the client error log.
2. Dynamically import tui-base's `v2-entry.tsx`.
3. Construct `StdioBridgeTransport` and inject it into `bootClientV2`.
4. Let `bootClientV2` call `createBridgeSessionSeam`, render the v2 view, and
   return its shutdown handle.

`bootClientV2` requires an injected bridge transport. A missing transport or a
failed bridge handshake is terminal; there is no alternate seam selection.
Shutdown disposes the seam and closes the transport, which terminates its host
child. The package launcher provisions the profile and starts the bun client; it
does not pre-launch a separate HTTP host.

## Stdio transport contract

`StdioBridgeTransport` spawns `dsh --profile <DEFAULT_PROFILE>` with
`DSH_OPENTUI_BRIDGE_STDIO=1` and piped stdin/stdout/stderr. Frames are newline-
delimited JSON:

```text
client → host  {"id":1,"method":"bridge.hello","params":{"protocolVersion":1}}
host → client  {"id":1,"ok":true,"result":{...}}
host → client  {"id":1,"ok":false,"error":{"code":"...","message":"...","detail":{...}}}
host → client  {"type":"...","payload":{...}}
```

The transport exposes the injected `BridgeTransport` surface:

```ts
interface BridgeTransport {
  request(method: string, params?: Record<string, unknown>): Promise<unknown>
  onEvent(listener: (event: { type: string; payload: unknown }) => void): () => void
  readonly profile?: string
}
```

`StdioBridgeTransport` adds observable connection state, diagnostics, manual
recovery from `dead`, and idempotent `close()`. Request ids correlate replies;
event frames use the existing `onEvent` subscription. Recovery re-spawns the
child and repeats the handshake/fingerprint checks before returning to `ready`.

## Packaging and tests

`packages/shell/package.json` ships `bin/`, `scripts/`, `dist/client/`,
`dist/bridge/`, and `dist/locales/`. The launcher executes
`dist/client/index.js` under bun; bridge lifecycle code is part of the client
and bridge bundles, not a separate helper process artifact.

Relevant existing tests include `test/bridge-transport.test.ts`,
`test/bridge-session-seam.test.ts`, `test/bridge-recover.test.ts`,
`test/journal-projection.test.ts`, and `test/mux-frame.test.ts`.
