# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Client-mode foundations (ADR-0005 P1/P5).** The TUI-as-thin-client path gets its four base layers. `src/client/cookie-mint.ts` mints the Host API cookie from the persisted `client-connection/browser-session` grant in `$DSH_HOME/.credentials.yaml`, reproducing the Host's own recipe byte-for-byte (BrowserAuth/dsh-credentials: cookie name `dsh-auth-` + base64url(sha256(authority)); value `v1.<body>.<base64url(HMAC-SHA256(secret, body))>`), fail-closed on non-owner-only credentials and with no secret/cookie material in any thrown error. `src/client/mux-frame.ts` + `events-source.ts` + `transport.ts` give a `ClientConnection` carrier over one authenticated `/api/remote.mux` WebSocket (`ws`, cookie on the upgrade — the global WebSocket cannot send headers): unary RPC via `POST /api`, and the `$events` mux pump behind `dsh-client-connection`'s `ConnectionGenerationSource` — the pump is deliberately chosen over the gateway-native `ClientRemoteEvents` client because waterfall frames must reach the consumer's `onEvent` (v1 answers them in-process), while the gateway source intercepts waterfall frames and auto-answers them itself with a stub typert service. `src/client/lifecycle.ts` is the host lifecycle manager `ensureHost`: first-TUI spawn, single-instance lock with stale-lock takeover, refcounted attach/detach, idle exit after `idleExitSec` (default 60s, `0` = resident), respawn crash cap. `scripts/provision-opentui-profile.mjs` idempotently bootstraps the fixed `opentui` host profile via `dsh opentui --from-default-profile web --dump-config` (compose-and-exit, no boot; touches only that one profile). 64 green tests in `packages/shell`; design background in `docs/adr/0005-client-mode.md` and `docs/client-mode-protocol-audit.md`.

- **Client-mode session core + workspace config overlay (ADR-0005 P2 wave 1 / P4).** `src/client/remote-host-session.ts` is `RemoteHostSession` — the HostSession-shaped session facade the rendering layer consumes, driven over P1's `ClientConnection` (unary Remote RPC + raw `$events` pump). Wave-1 audit rows: turn lifecycle (`session/create` + `session/prompt`, `mode:'queue'` for fresh sends and `mode:'steer'` mirroring `agent.steer`; the message queue stays client-side), `session/follow({assistantStream:true})` consumption (`remote-follow.ts`: text/thinking deltas, usage, tool call/result frames with image-path extraction parity, durable turn/end + error mapping, `todo/write`), `session/cancel` abort, and generation re-attach — the follow stream re-opens on reconnect, the opening snapshot replays missed transcript rows through `onReattachedMissed` and an active turn's compact stream replays as deltas under a "reconnecting…" label. Waterfalls (`remote-waterfall.ts`): forwarded `$events` `approval/request` + `user-questions/request` frames are claimed by `frame.agentId === sessionId` and answered through the unary `$events/result` RPC with the host verdict payloads — `"allowed-once"` / `"rejected"` (+ `"unavailable"` fail-closed with no callbacks) for approvals, `{answers:[{id, selected[], custom?}]}` (declined envelope on UI throw) for questions — the waterfall route rather than `userQuestions/answer` + `attachWait`, since the TUI modal has no detach window and the waterfall is the exact-parity answerer chain the in-process TUI joins today. `src/client/workspace-config.ts` is the workspace-local config overlay (bucket d, decision 4): `./.dsh/config.yml` holds only theme + model preferences, precedence environment (`DSH_OPENTUI_THEME` / `DSH_OPENTUI_MODEL`) > workspace > global base, model subfields merge partially, unknown keys ignored on load and preserved verbatim on save, credential-shaped keys rejected on load AND save (denylist, fail closed), 0600/0700 atomic same-dir rename writes, and a strict no-dependency YAML subset that refuses to rewrite a file it cannot fully parse. `remote-host-session` plugs into the same `TurnCallbacks` seam as the in-process `HostSession`, so the UI swap is zero-change. Rest of the audit surface (rows 12–28, 30–33, 35–37) ships as HostSession-shaped wave-2/3 stubs. 116 green tests in `packages/shell` (116 pass / 1 env-gated live smoke skip); contract background in `docs/adr/0005-client-mode.md` and `docs/client-mode-protocol-audit.md`.

### Fixed

- **solid-js client build pinned install-proof.** Under the host's node runtime solid-js's `node` export condition resolves to `dist/server.js` (SSR, no reactive scheduling): the TUI rendered one frame and went dead — most visible in the rich-markdown path (a markdown table froze the screen). The fix rewrites the installed package's exports to the client build, but plain `pnpm install` wiped it. Now registered as a pnpm `patchedDependencies` patch (`patches/solid-js@1.9.12.patch`) in the profile, so every install re-applies the pin; the direct rewrite stays as belt-and-braces. Also adds `packages/shell/scripts/sync-profile.mjs` (`npm run sync`) — the local deploy loop (build → rsync dist-host into the profile → keep the pin) that used to be manual shell work. Verified: two forced `pnpm install` rounds keep the pin and the dist-host overlay, 19/19 e2e, parity gate green, real-host markdown-table scenario renders a full bordered table.

## [0.4.0] - 2026-10-30

### Added

- **Idle lock release (the lock half of the cross-surface takeover contract).** A dsh-opentui TUI used to hold its session's kernel write lease forever, so the phone's `/resume` against any open TUI session degraded to a read-only watch that nothing (short of quitting the TUI) ever released. After `idleReleaseSec` without input or a running turn (plugin config, default 600s, `0` disables) the write handle is disposed — the kernel lease frees with it and the transcript stays on screen. The next send re-attaches the SAME session id and folds in the durable user/assistant rows other surfaces (phone, second TUI) wrote while released (`onReattachedMissed`, spliced ahead of the prompt row); a lease meanwhile won by another surface fails the wake with an actionable error and keeps the id for a retry. `abort()` keeps its `/new` semantics (fresh id on the next send); an explicit resume still wins over the reattach. Verified: 6 new HostSession contract tests (release, same-id wake, missed-rows fold, owned-refusal, abort/resume precedence, disable switch), monorepo `bun test` green, both packages typecheck clean, and the packed-tarball real-host boot smoke.

## [0.1.0] - 2026-10-29

First public release of `@aiwayds/dsh-opentui`.

### Added

- Host profile mode: first launch of the `dsh-opentui` bin idempotently installs a dsh profile (`~/.dsh/profiles/dsh-opentui`, bundles `dsh-base` + this package) and pins the model via a cordis patch (`llm-pi-ai` provider routing + `agent-default-model`, default `zai-coding-cn/glm-5.3-flash/high`); `--provider` / `--model` / `--reasoning-effort` override at install time. The plugin runs inside the real dsh host process (OpenTUI + Solid; node >= 26.4 with `--experimental-ffi`, auto-injected by the bin).
- Slash command panel (`/help`, `/model`, `/usage`, `/clear`, `/quit`).
- Themeable UI with theme tokens shared through `@dsh-opentui/kit`.
- Runtime model switching (`/model provider/id`).
- Markdown rendering for replies.
- Custom line editor (input history, cursor editing).
- Standalone compiled binary distribution (direct mode, bypassing the host).
- Declarative surface protocol (`ctx.surface.declare(...)`) for zero-build plugin integration.
- `starter/` copyable plugin template.

### Changed

- Plugin sources are distributed and mounted through the npm package / installed profile instead of repo-local `link:` mounts.

### Fixed

- Kitty keyboard protocol: Ctrl+C no longer kills the TUI unexpectedly; it is handled as the abort/quit key.

[0.1.0]: https://github.com/fan56/dsh-opentui/releases/tag/v0.1.0
