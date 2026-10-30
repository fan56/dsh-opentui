# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
