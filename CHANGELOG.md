# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
