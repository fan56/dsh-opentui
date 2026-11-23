# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.26.4] - 2026-11-23

### Changed

- **`/goals` is renamed to `/goal`** to match the host/web command name. There
  is no runtime alias: typing the old `/goals` now yields `unknown command`.
  The seven operations (status, create, edit, pause, resume, complete, clear),
  the bare-command read-only status, and the write-confirmation flow are
  unchanged; saved usage counts carry over once through the renamed-command
  migration.
- **The inproc profile pins the host subagent `maxDepth` to 1.** Depth is
  absolute (lead 0, direct child 1): direct children are allowed, grandchildren
  (depth 2) are rejected, closing the depth-≥2 delegation-gate silent-pass
  window and surviving host default drift. `0` is never used — it would refuse
  every delegation. The pin is the initial default of a volatile setting, so a
  runtime change by the host is still possible.

## [0.26.3] - 2026-11-22

### Changed

- Full-access delegation now inherits the parent's approval policy across live
  and resumed children (parent policy events, bind/reconcile re-sync and child
  turn-start re-pin), so returning to `ask` no longer leaves a child on `never`
  and silently bypasses the write-approval gate.

## [0.25.0] - 2026-11-22

### Added

- **Capability release is table-driven.** CapIR v3 adds per-method parameter /
  service tables and a generated generic dispatch arm (ADR-0012); new capabilities
  are released through an explicit per-id allowlist instead of a blanket grant.
  The in-process host now wires **58 of 257** methods (28 hand-written adapters
  plus 30 released generic ids); every other id fails explicitly as `NOT_WIRED`,
  never a silent empty result. `scripts/check-capcontract.mjs` byte-compares the
  generated tables with **22 assertions**.
- **New command faces ride real host data.** `/btw` answers a side question in a
  throwaway side session alongside a busy main turn; `/plugins` opens a real
  plugin-manager panel (list + detail, install / uninstall / enable / disable
  behind a confirmation modal, bounded install-progress polling with cancel);
  `/goals` exposes 7 goal operations with a TUI confirmation before each write;
  `/model discover` queries the current provider for its model list; `/login` /
  `/logout` and `/account` are separate provider-login and account domains;
  `/search`, `/history` and `/subagents` read real host data. `/settings` shows a
  real permission-preset row.

### Changed

- **The legacy podman `e2e/scenarios/` container layer was retired (ADR-0013).**
  Its 21 scenarios were inventoried and each still-valid assertion was shown to
  be taken over by the host families, the real-machine gate, unit tests and the
  CI `pack-cold-start` gate before deletion. The container slot is recorded as
  NOT RUN, never a fake green. The real-machine tmux recipe (historically
  "verify70") closed at **64/64** items; the `pack-cold-start` gate is required.

### Known

- `/model discover`'s positive path is environment-dependent and was NOT RUN
  where no discovery source is registered; the honest degrade path is verified
  and no model list is fabricated. The real-machine CI job remains opt-in and
  needs a self-hosted runner with `dsh`, tmux, a provisioned profile and a
  provider key.

## [0.24.0] - 2026-11-21

### Added

- **The in-process bridge is the sole session seam.** All TUI traffic runs over
  a stdio JSON-lines channel to a bridge loaded inside the `dsh --profile
  opentui-inproc` host; the legacy remote thin-client seam and its
  `DSH_OPENTUI_INPROC=0` escape hatch were removed. A boot handshake compares
  the client's expected capability surface with the bridge and degrades honestly
  on a mismatch.
- **The CapIR / capcontract layer** makes `capir/capir.json` the single source of
  truth for capability interface shapes, with generated contract tables checked
  byte-for-byte in CI.
- **A FocusRouter keymap with a four-tier capture stack** (ADR-0008), and the S1–S6
  capability surface: a real `/model` catalog, credentials / account with PKCE
  authorization, and real config / settings / agents faces (no degrade notice).

### Changed

- **The bridge is now a real directory copy** of this installation's bundled
  artifact, guarded by a build-time fingerprint and a host-version compatibility
  window — no absolute symlink, and no `@deepseek-ai/*` package copied into the
  profile. It converges idempotently on every launch; `--repair-bridge` is still
  accepted but is a no-op, while a fingerprint mismatch still fails loud.
- **28 methods are hand-wired and `@manual` reached 0.** The `pack-cold-start` CI
  gate (npm pack → fresh install → bridge identity → stdio handshake) and the
  real-machine `verify70` gate went green.

## [0.23.3] - 2026-11-20

### Changed

- **The think fade now lives inside the activity frame.** The frame's latch
  keeps the bordered `activity` panel mounted while any think/tool row is
  still lingering or fading (~2.3s after a turn ends) instead of dropping the
  panel at the 60ms turn boundary — the fade finishes inside the panel and the
  transcript only reclaims the space afterwards, fixing the overlap where a
  fading think row painted on top of the falling transcript. The compact
  (≤30-row terminal) fallback dock now tweens its height through the same
  shared clock, removing the two-row snap at the frame/flat handoff and the
  N→0 snap when lingering rows drop.
- **Todos render as a tree in the activity panel** — a `● Todos (done/total)`
  header plus `├─/└─` child rows (same branch glyphs as the subagent rows) in
  both the framed and compact layouts, replacing the single-line
  `todos [✓]d/n · active` summary. The summary remains only as the degrade
  when the tree cannot fit. An in-progress todo now also holds the activity
  frame open after the turn ends.
- **Ask-panel descriptions are readable on dsh-blue.** The theme gains a
  `@dialog` scope override lifting dialog-surface muted text from
  neutral.400 to neutral.300 in both light and dark — option descriptions and
  the `Type something.` hint stop sitting at the too-dark tier.

### Fixed

- **The "Think display lines" setting now persists.** On the default in-process
  bridge the setting silently no-opped (no configSave wire) while reporting
  success and fell back to `default` on restart — which caps the think preview
  at 1 line on ≤40-row terminals. Gear-type UI settings now persist in a
  client-local `ui-state.json` (XDG state dir, alongside the existing
  model.json preference store), take precedence on boot, and the settings row
  says so ("Stored on this machine", plus a note that the think preview is
  fixed at 1 line while a subagent runs, by design). Settings the bridge
  cannot persist now fail honestly instead of pretending to save.
- Todo rows survive object-shaped argument carriers end to end (live turn and
  journal replay), with regression tests using real journal frame shapes.

## [0.23.2] - 2026-11-20

### Changed

- **Transcript block types now carry distinct theme hues.** Fenced code
  blocks in assistant messages paint their streaming left rule and final
  frame in the theme's code hue (`markdown.code` walked two ramp steps
  deeper via `increase` — green.400 on the default theme), the user `❯`
  box paints its border in the theme's interactive hue at the 400 step,
  and the think block's left accent bars paint in the accent hue two ramp
  steps deeper — the same family the widgets dock's think lines already
  use. All three stay border-tier, low-saturation accents on dark themes;
  body text colors are unchanged.
- **The last-request echo line reads as user content.** The composer
  footer's last submitted prompt now prefixes with the `👤` user icon
  (footer-emoji family, a deliberate departure from tui-pi's `●`) and
  paints at `text.base` instead of `text.muted`. The `👤` glyph is
  double-width; the line's clip budget already measures it through the
  grapheme-aware `stringWidth`, so no layout math changed.

## [0.23.1] - 2026-11-20

### Changed

- **"Stop everything" now really interrupts in-bridge subagents.** Pressing Esc
  twice and confirming "Stop everything?" makes the host interrupt its child
  subagents at once, without waiting for the parent turn to reach a boundary;
  their rows flip to the ⊘ aborted state within ~2s. Answering "no" at the
  confirm leaves every child running untouched. The interrupt also reaches
  children the client roster never showed (live-spawned / hidden subagents),
  and is scoped by session ownership: a TUI can only stop the subagents of its
  own session, never another session's. The model-side `rounds` / `model`
  information on those rows is preserved.

### Fixed

- **Running subagents are visible the moment they spawn.** In 0.23.0 a live
  child was absent from the ctrl+g panel (and shift+k reported "no running
  subagents") until the next turn boundary drained the journal. Live spawn now
  enters the catalog immediately. Root cause: catalog-family spawn frames were
  being silently dropped by the anti-collision guard.

### Internal

- Bridge: added a `subagent-index` (session → sub-agents mapping) and
  `subagents.interrupt` / `subagents.stopChildren` methods gated on session
  ownership at both entrances; converged the stop path into a shell
  confirm-then-emit flow; added the ⊘ state and i18n strings to tui-base.

## [0.23.0] - 2026-11-19

### Changed

- **The in-process bridge is now the default.** A plain `dsh-opentui` boot
  provisions the `opentui-inproc` profile and drives the TUI through the bridge
  seam — no flag or env var needed. `DSH_OPENTUI_INPROC=1` remains valid
  (idempotent). Setting `DSH_OPENTUI_INPROC=0` is the escape hatch back to the
  legacy remote thin-client seam. A failed bridge handshake / fingerprint check
  still fails fast with a diagnosis, a repair command and a mode notice, and
  never silently falls back.
- **`--remote` has been removed.** It is no longer accepted as a launch flag;
  passing it exits with a usage error (exit 2). The legacy remote seam is now
  reachable only through the `DSH_OPENTUI_INPROC=0` env escape hatch.

### Fixed

- **Ghost subagent rows are swept at turn boundaries.** When a parent turn is
  aborted the host never journals the subagent's settle notice, so the child
  stayed `running` forever. The bridge seam now reconciles its catalog against
  the host session list at every turn terminal and after session recovery, and
  settles any child the host no longer reports as running. Best-effort and
  idempotent; still no wall-clock fallback.
- **ctrl+g subagent views show real progress.** `rounds`, `lastLine` and
  `model` are now read from each subagent's own journal (lazily, cached, and
  re-read once the child settles), so the viewer no longer shows 0 rounds, an
  empty last line, and a missing model.

## [0.22.0] - 2026-11-19

### Changed

- **Opt-in in-process bridge (no default change).** Setting `DSH_OPENTUI_INPROC=1`
  provisions the `opentui-inproc` host profile and routes the TUI through a
  bridge bundle running inside that host (stdio JSON-lines), so session
  identity, turns, asks and journal replay share one data source. Without that
  env var a plain `dsh-opentui` boot still starts the remote thin-client seam,
  exactly as in 0.21.x. Flipping the default to the bridge is planned for
  0.23.0. `--remote` remains the explicit remote selector and is deprecated,
  slated for removal in 0.23.0; passing it prints one deprecation notice per
  launch naming the removal line. When opt-in is on, both seams coexist and a
  failed inproc handshake/fingerprint check fails fast with a diagnosis, a
  repair command (`dsh-opentui --repair-bridge`) and a mode notice — it never
  silently falls back to the remote seam.

### User decisions (2026-11-19 merge-footer review)

- Three rulings on the merged inproc footer, final (do not re-litigate):
  1. The 🆔 session-id footer segment is removed entirely — segment, v2-entry
     wiring, recovery-ui callback and tests. Session identity stays queryable
     through `/session info` (ADR-0010 I5 carries a revision record).
  2. The `bridgeStatus` footer segment hides only the normal `✓ ready` state;
     `⚠ dead` / `⟳ recovering` still render during a fault / recovery and
     disappear automatically once the link returns to ready. Recovery logic is
     untouched — only the powerline render condition changed. The 80-column
     priority table keeps `bridgeStatus` at the lowest priority (-2); it now
     only occupies a slot in an abnormal state.
  3. The 🧠 context and ⚡ cache-hit-rate footer segments render again under
     the inproc bridge (the former P3-2 Known debt, paid early).

### Added

- **Real session resume.** `session.open{resume}` calls the host's `ctx.agents.resume`
  eagerly instead of silently creating a fresh session. Model context and the
  on-screen journal now point at the same persisted session, fixing the
  "screen still shows history, model forgot everything" split (the
  dsh-opentui-amnesia incident). `/resume`, `--session` and `--resume-last` all
  take the resume path; abort leaves the session id unchanged.
- **Approval cards and tighter defaults.** The generated profile pins
  `defaultPreset: workspace-write` (`approval: ask`) and arms a pre-execute gate
  for `bash`, `write`, `edit` and `apply_patch`. Those tools pop a TUI approval
  card before execution (Enter = allow, Esc = reject, fail-closed); read-only
  tools pass straight through. Escape hatch: `DSH_OPENTUI_APPROVAL_GATE=off
  dsh-opentui` restores the old `danger-full-access` default.
- **User-questions panel over the bridge.** Host `user-questions` requests are
  forwarded as `ask.request` events and surface on the TUI's ask dock, where
  they can be answered back through `ask.response`. Missing provider/service,
  answer errors and timeouts settle fail-closed with an explicit error code and
  UI notice instead of being silently swallowed; first answer wins, and turn
  end closes every pending ask.
- **APPEND_SYSTEM.md injected for real in inproc mode.** The bridge registers
  an agent-scoped `systemPrompt.section` (`order: 200`) that lazily reads
  `~/.dsh/APPEND_SYSTEM.md`, caches by mtime, and truncates at 64 KiB on a UTF-8
  character boundary. Existing `opentui-append-system` sessions carry that id
  as inert metadata on resume (no migration, no cleaning, no `preset` passed to
  `agents.resume`); the appended text comes only from the bridge section.
- **DEAD recovery, phase one (host-crash recovery).** A bridge/host exit shows a
  DEAD notice immediately with the exit code/signal, even when idle. `R`
  reconnects: respawn the child, re-handshake with three checks (protocol
  version, fingerprint fields, host-compat window), eager `session.open{resume}`,
  then a `journal.replay` drain to fill the transcript. Pending approval cards
  at DEAD turn into terminal "invalidated" cards (acknowledge-only, never an
  implicit allow); an in-flight turn is judged by the journal's terminal row —
  a silent journal yields a local `INTERRUPTED` marker (`seq:null`, `source:local`)
  that is never written to the journal. Automatic retry/backoff and heartbeats
  are deferred to a later version.

### Fixed

- **Inproc bridge subagent rows converge; tool callId / isError reach the view.**
  Follow-up to the 9190946 subagent/tool fix (oldfox P1×2+P2×3+P3×3):
  - A plain `subagent` child now settles when the host journals a
    `user/message` `source.kind=subagent-settled` notice — paired by
    `senderSessionId` to the catalog child's `childId` (no runId needed),
    `stopReason`→status conservatively mapped. Settled rows freeze their
    duration; unknown stop reasons never paint a false failure. An ABORTED
    parent turn leaves no such notice, so its ghost row stays `running` — a
    documented known residue with no wall-clock fallback (ADR-0010).
  - Catalog-family rows may revive a settled child on a later same-childId
    catalog (a new run); the tool-workflow family keeps its no-revive guard.
    `sessionInfo`'s incremental drain now folds these rows too, so an async
    child settles outside any turn. Catalog replay anchors `startedAt` to the
    host's real `childCreatedAt`.
  - `turn.tool` call/result frames carry the `callId` end-to-end; the seam
    passes it into `onToolStart`/`onToolRun`, so two same-name tools
    interleaving no longer collide on one row and args stay with their call.
    The result frame carries the host's `isError`, mapped to `ok` (a failed
    tool is no longer painted as a success). Corrected 9190946's inaccurate
    claim that callId preserved the args — that came from the seam-rows
    empty-argsPretty fallback.
- **🧠 context and ⚡ cache-hit segments render under the inproc bridge.**
  The in-process bridge exposes no `session` / `projections` RPC (only
  `session.list`), so `BridgeSessionSeam` derives `contextTokens()` /
  `contextWindow()` / `cacheHitRate()` from journal rows rather than a live
  projection. The caliber is deliberately LAYERED, not a wholesale parity
  claim:
  - ⚡ cache-hit rate — same formula as remote: `lastMessage` is
    `cacheRead / (prompt + cacheRead + cacheWrite)` of the latest billed row,
    `session` is `ΣcacheRead / (Σprompt + ΣcacheRead + ΣcacheWrite)`.
  - 🧠 context occupancy — a DEGRADED local caliber. The numerator is the
    journal's latest billed `assistant/message.data.usage.totalTokens`
    (≈ remote `ContextTokenMeter` billed base `input + cacheRead + cacheWrite
    + output`); it carries no pending-item estimate and no next-request
    projection, so unlike remote it does NOT climb with pending text while a
    turn is in flight. The denominator is the host-resolved
    `request/context.contextWindow` for the live route, guarded by the same
    `currentModelSelection()` route check.
  All three ride the existing incremental `sessionInfo()` tally (no new cache,
  no double counting) and read the same host usage data the remote seam reads
  off its live chunks — remote reads the live usage chunk, the bridge the
  journal row that carries it. The `/session` panel's `cache read/write 0 / 0`
  was a field-name mismatch — the journal row carried `cacheReadTokens` but the
  seam only read `cacheRead`; the alias mapping (remote `scanUsageChunk` parity)
  fixes both the panel and the footer rate.
- **Writer-held as a localized diagnostic.** `SESSION_LOCKED` now renders as a
  `writer-held` message that includes the host-reported holder session id,
  instead of the raw host error. In inproc mode the footer brand shows as `dsh`.
- **Footer `💬` and `⚡` now render on the opt-in inproc path.** The bridge
  seam's `sessionInfo()` derives `msgCount` from journal `assistant/message`
  rows — the same single `💬 N msgs` unit defined in 0.21.1 — and `tps` when it
  can be derived, so the counter and token-rate segments are no longer blank
  under the inproc seam. `messageCount` remains the `/session` panel's data.

### 用户裁决 — activity 面板重设计（2026-11-19）

用户逐条拍板的最终规则表，覆盖此前"think / tool 各自独立锚点"的旧法则：

| 场景 | think | tool | todo | subagent |
| --- | --- | --- | --- | --- |
| A. subagent 活跃 | 1 行，置顶 | 1 行，置顶 | 1 行摘要 `todo 完成数/总数 时长s` | 列表占剩余行（沿用现有滚动裁剪） |
| B. 无 subagent、think 可见（活跃 + 2s exit hold） | 齿轮行数（≤10） | 隐藏 | 隐藏 | — |
| C. 无 subagent、无 think | — | ≤3 行（固定值，不吃齿轮） | 1 行（现行完整格式） | — |

1. **面板封顶 10 行。** 内容区随内容伸缩、硬上限 `MERGED_DOCK_TOTAL_LINES = 10`（不含边框）；废除 `all` 档的 2/3 终端增长规则和 halfBudget 帧钳制。无内容整体隐藏（D5）不变。
2. **齿轮只管 think。** `session.activity_panel_height` 语义改为仅 think 显示行数：1/5/7/10；`all` 保留兼容（不迁移用户 config）但等于 10。tool 恢复固定 3 行。settings 行文案与 en/zh 文案改义（key 名不动）。
3. **场景 B 互斥。** think 可见期间藏 tool 与 todo；若 subagent 仅有历史残留行而 think 活跃，按场景 B 处理（subagent 行也让位）。优先级：subagent 活跃 > think 独占。
4. **场景 A 的 todo 摘要行。** 只显示 `todo 完成数/总数 时长s`（如 `todo 1/3 300s`），不显示当前任务文本。时长 = 当前任务集建立至今的秒数：按任务文本集合（忽略状态翻转、与顺序无关）首次出现的时刻起算；换任务集重置，同一集内 1/3→2/3 不重置，跨会话清空。
5. **伸缩动画。** 面板高度变化走共享动画钟（busy 才给 rate）驱动的整数行数逐帧插值，200ms smoothstep；非常驻、终态精确等于目标行数；共享钟 idle 不给 tick 时按挂钟取终态。动画结束帧后自校验行数 = 目标，规避仓内常驻动画撞 diff-paint 丢行的前科。**动画仅作用于增长**（新行逐行出现）；收缩为瞬时（被删行无法参与过渡）——这是设计内的不对称，不是缺陷。

置顶顺序：场景 A 中 think 行、tool 行、todo 行在 subagent 列表上方。

### Known debt (0.22.0 transitional)

- The default inproc launch still runs two host processes: an HTTP host owns the
  config plane (`configSave`, theme/skin persistence, profile/workspace overlay
  reads) because `BridgeSessionSeam` has no config frame, while the bridge host
  owns the session plane. 0.23.0 folds config into the bridge (or local files)
  and removes the `ensureHost`/`RemoteHostSession` path.
- The old automatic reconnect (backoff retry) is not implemented; recovery in
  0.22.0 is manual (`R`, with a 5s cooldown) only.
- The inproc bridge's `subagentViews` field set matches the remote seam's, but
  its VALUES are approximate: the bridge only sees the parent journal, so
  `rounds` stays 0, `lastLine` / `model` are absent, and a settled row's
  `elapsedSec` is frozen at discovery time. No whole-parity claim is made.
- ~~`BridgeSessionSeam` does not implement `contextTokens()` / `contextWindow()`;
  the 🧠 context-occupancy segment does not render under the inproc bridge.~~
  **RESOLVED in 0.22.0** (user decision 2026-11-19, paid ahead of the later
  seam-capability batch): see the Fixed entry above for the journal-derived
  implementation and the ⚡ cache-rate parity fix.
## [0.21.1] - 2026-11-17

### Changed
- The footer message counter is now a single `💬 N msgs`. One message is one
  durable `assistant/message` event (the unit previously called a round). The
  turn count is no longer displayed in the footer; it remains available to the
  `/session` panel.

### Note
- `msg` also counts tool-only rounds that produce no assistant transcript row.

## [0.21.0] - 2026-11-17

### Added
- The footer now shows turn and round counters as `💬 N turns · ↻ M rounds`.
  Turns count durable `user` transcript rows; rounds count durable
  `assistant/message` journal events (one assembled message = one round).
  When the journal is unavailable the counters degrade honestly: the rounds
  half is omitted rather than shown as a fake 0.

### Changed
- The busy status line is gone: no verb, elapsed time or detail text renders.
  The animated comet now rides the key-hint row, to the left of the hints and
  only while busy; its renderer moved to a shared `comet-track.tsx` module.

### Known limitations
- Round counts refresh only at turn boundaries, so a multi-round turn jumps
  once at its end instead of ticking per round. Steer messages may inflate the
  turn count; whether the host journals steer text as a user message cannot be
  verified from this repo.

## [0.20.0] - 2026-11-17

### Added
- The activity frame now merges Todos and Subagents. Tool and think rows render
  in an upper zone above the todo tree, and both zones are visible at once
  instead of switching.
- Only `in_progress` todos render. Every running subagent hangs under the last
  `in_progress` todo — a documented approximation, since the data model has no
  todo/subagent association field.
- The merged frame has a 10-line visible cap shared with
  `session.activity_panel_height` as `min(gear, 10)`. The lower zone scrolls via
  mouse wheel with a `ctrl+alt+up/down` fallback (overflow and page-owner
  guarded) and an `N/M` position suffix in the frame title.
- Per-line entrance and exit fades and think italics apply inside the merged
  frame. Todo and agent rows survive turn end while in_progress content remains,
  decoupled from the activity frame latch.

### Changed
- The activity title tool glyph is `🔧` (U+1F527) instead of `🛠️`: the renderer
  blanks VS16 graphemes in wcwidth mode. The footer provider lead is likewise
  `🌐` (U+1F310) for the same reason.

### Removed
- Running-child rows were removed from the last-request footer dock; subagents
  now render once, in the activity panel.
- The standalone Todos panel render was removed.

## [0.19.1] - 2026-11-17

### Fixed
- The launcher spawns the client asynchronously. Host processes were previously
  left as unreaped zombies for the whole client session, because the synchronous
  spawn blocked the event loop that reaps them. A client killed by a signal now
  also reports `128 + signal` instead of exiting 0.
- Stopping a host under a non-default profile works again: the
  process-identification check compared the command line against the hardcoded
  `opentui` profile instead of the profile the registry record was read for.
- The watchdog backs off when the host refuses to stop (capped at 30s) instead
  of re-probing every tick forever.
- The `widgets-dock` fade-window test samples across a window derived from the
  visibility constants instead of one fixed instant, so a slow CI runner no
  longer fails it. The live remote smoke test builds its own scratch git
  repository instead of relying on the checkout's branch.

### Changed
- ADR-0009 is Accepted. The phase-2 workspace-config extension is deferred:
  skills, AGENTS.md and theme/model already resolve per session cwd; only
  settings and tools are profile-scoped. Give each project its own `DSH_HOME`
  if it needs a different tool set today.

## [0.19.0] - 2026-11-17

0.18.7 carried the same code but shipped these lifecycle changes as a patch;
it is deprecated in favour of 0.19.0.

### BREAKING CHANGES
- The resident host no longer exits 5s after going idle. It now shuts down
  once the last client exits (2s grace). `DSH_OPENTUI_HOST_IDLE_MS` keeps its
  name but now means "last-one grace override" (default 2000); `0` means
  resident. Scripts that relied on the 5s idle window must set it explicitly.
- The host registry moved to schema v2. v1 records are treated as legacy and
  never overwritten or signalled; a live v1 host is left for stale cleanup
  only. Tooling that parsed `opentui-host.<profile>.json` must accept
  `version: 2`.
- `--force` without `--yes` now exits 2 and leaves the host untouched while
  clients are still live. Automation calling `--force` must add `--yes`.

### Changed
- One host service per `(DSH_HOME, profile)`, on a port derived from the home
  path. Later launches attach to the running host rather than spawning another;
  warm attach measured at 407ms.
- Startup renders the boot phase and elapsed time before entering the client
  interface, so a cold start shows progress instead of a blank screen.
- The host shuts down gracefully 2s after the last client exits, letting it
  flush state. Set `DSH_OPENTUI_HOST_IDLE_MS=0` to keep it resident instead.

### Fixed
- `--force` without `--yes` now exits 2 and leaves the host untouched while
  clients are still live. A three-evidence gate keeps it from stopping a
  process it cannot positively identify as this profile's server.
- The host registry is unified on v2, so v1 and v2 records no longer overwrite
  each other.
- The row 39 git-branch probe in the shell tests now builds its own temporary
  repository instead of assuming the checkout is on a named branch, so the
  tests no longer fail under detached PR/tag checkouts.
- `--force --yes` now resets a host whose pid is an unreaped zombie: a zombie
  still answers `kill(pid, 0)`, which used to look like "still running" and
  abort the reset.

### Migration
- Replace 5s-idle assumptions: set `DSH_OPENTUI_HOST_IDLE_MS` explicitly to keep
  the old grace, or `0` for a resident host; the new default is 2000ms.
- Update tooling reading `opentui-host.<profile>.json` to accept `version: 2`;
  treat leftover v1 records as legacy and let stale cleanup remove them.
- Add `--yes` to every automation call that uses `--force`, or handle exit 2 and
  leave the host untouched while clients are live.

## [0.18.6] - 2026-11-17

### Changed
- The hints bar keeps `ctrl+g subagents panel` on narrow terminals: the segment
  now outranks history and newline, so 80-column layouts show it next to
  `ctrl+c ×2 quit`. `alt+enter newline` yields first.
- The publish-landed check waits up to 20 minutes (10s/20s/60s backoff) instead
  of 6, and its failure message explains how to confirm the registry directly and
  re-run only the failed steps. Provenance publishes are queued asynchronously by
  npm and 0.18.5 failed this check while the package was in fact landing.

## [0.18.5] - 2026-11-16

### Added
- `/stop` command: stops the active turn and every running subagent, matching
  the double-Esc confirmation. It is a no-op on an idle session — `interrupt()`
  clears the session binding, so it is only issued while a turn is running.
- `ctrl+g` opens the subagent activity panel (`/subagents`); `session.first`
  moves to `ctrl+home` (`home`/`alt+home` still work).

### Fixed
- The todo panel's right border was drawn two columns short: already-sized
  content rows were re-clipped by `clipToWidth`, whose whitespace pattern
  lacked the `g` flag and collapsed only the first run of spaces. Rows now go
  through `takeWidth`, which never rewrites interior whitespace.
- The footer `msgs` segment stayed hidden for the entire first turn of a fresh
  session: remote info was only refreshed on mount and after the turn ended, so
  the count was still unknown while the turn ran. The first streaming delta (and
  the first tool run) now triggers a throttled re-read.
- The `/subagents` transcript layer ignored `x` (stop one child) and `Enter`
  (steer): the panel handle was a plain variable read by a reactive `enabled`
  gate, so the layer's keymap never subscribed.
- The hints bar truncated mid-segment on narrow terminals, hiding
  `esc stop` and `ctrl+c ×2 quit`. Segments are now dropped whole by priority.

## [0.18.4] - 2026-11-16

### Added
- `--boot-timeout`, `--mux-timeout`, `--connect-timeout` (seconds) with
  matching `DSH_OPENTUI_*_TIMEOUT_MS` env overrides; the three wait budgets
  in the boot chain were previously hard-coded. `--boot-timeout` applies to
  the initial host cold-start only: `/reload` keeps its own hardcoded 30s
  restart budget and does not read this value.
- `-v` alias for `--version`.
- `--help` / `-h` usage output for the launcher.
- `--` separator: everything after it is passed to the client without validation.
- Client bundles ship sourcemaps (`.map`) so crash traces resolve to source.

### Changed
- Unknown launcher options are now rejected with `exit 2` and a usage block
  instead of silently booting the full client. A near-miss suggestion is printed
  when the typo is at least 3 characters long and within edit distance 2 of a
  known option (short flags such as `-x` get no misleading hint).

### Fixed
- The host mux probe aborted a still-connecting socket after removing its
  listeners, turning a normal "host not serving yet" timeout into an uncaught
  `WebSocket was closed before the connection was established` crash. The probe
  now keeps a no-op error listener, so the failure surfaces as `HostNotServingError`.

## [0.18.3] - 2026-11-16

### Added

- **The ask-user panel is rebuilt as a bottom-docked, full-width surface** (`docs/ask-user-panel-spec.md` §2). The batch now occupies the composer seat in the page's normal layout flow instead of a centered overlay: option rows are numbered and carry their per-option descriptions, the trailing `(Recommended)` token is stripped from the label and promoted to a `Recommended` badge (recommended rows are pre-selected but never auto-submit), digits `1`–`9` quick-pick a row, the free-text row is a resident inline input that replaces the sentinel row rather than a screen swap, multi-question batches get a `[1 ✓] · 2 · 3` tab strip, and the review page lists each question with its current answer and jumps back to it for editing on Enter.
- **One input-ownership stack routes the keyboard** (`docs/adr/0008-input-ownership-for-keyboard-routing.md`, ADR-0008). Frames are pushed as surfaces open and the top frame wins: page-level `mode:"global"` layers gate on `top() === "page"`, and every overlay layer gates on its own frame. Overlays now take the keyboard, so Esc, PgUp and the arrow keys no longer reach the page underneath `/settings`, `/agents`, `/history` or `/subagents-viewer`; the dialog provider and panel-kit push one frame per open entry/layer, and the ask dock participates with its own frame.
- **The transcript replays a settled ask as a structured block.** Each question paints `✓ <question>` with `→ <answer>` in accent, one pair per question; a `header` becomes a muted eyebrow, a `detail` a muted continuation line, and a declined question `→ declined`. The offered options are carried but not repeated.

### Changed

- **Ask no longer renders on the dialog stack.** A new in-flow dock host at the composer seat hosts the batch; the composer stays mounted but hidden while the dock is open, so its draft and history survive, and admission waits for page ownership and re-evaluates reactively, so a queued ask admits when the overlay in front of it closes instead of pushing its ownership frame above an absolutely-positioned surface.

### Fixed

- **A question left unanswered submits as declined, not as an empty selection.** The review page is reachable with questions still blank, so the submit path now sends the missing-pick shape (`selected: []` plus `custom: "declined"`) instead of a one-element `[""]` selection that the host would read as a chosen empty string. The answer envelope is otherwise unchanged.

### Removed

- **The dead legacy `Question` tool renderer** and its private `parseQuestions` / `parseQuestionAnswers` helpers are removed (spec §11); no live path imported them.

## [0.18.2] - 2026-11-16

### Fixed

- **The self-upgrade no longer forces a registry onto `npm i -g`.** `--registry` is passed only when the registry came from `DSH_UPGRADE_REGISTRY`; a registry read from an `.npmrc` is left to npm's own configuration, which resolves the same place without overriding the user's per-scope or per-package settings.
- **Two upgrades can no longer run over one profile at once.** The write phase (backup, install, override write) holds `<profile>/.upgrade.lock`; a second run reports the holder and exits 2 without writing anything: `upgrade: another upgrade is running (pid <pid>, started <iso>)`. A lock older than 30 minutes is treated as stale and reclaimed, and `--dry-run` never creates one.
- **Unknown or malformed entries in `upgrade-overrides.json` survive a rewrite.** The parser keeps entries it cannot interpret (no version string) and the serializer writes them back unchanged, so a hand-written entry is no longer silently deleted when the upgrade command records a new pin. They still never affect the effective pin.
- **The tail of `dsh plugin add` stderr is shown after a successful batch install.** Up to five lines are printed with a `dsh plugin add: ` prefix, so pnpm warnings from an install that exited 0 are no longer lost. The failure path is unchanged.

### Internal

- **`repository` field added to `packages/shell/package.json`** so `npm publish --provenance` can generate provenance.

## [0.18.1] - 2026-11-16

### Fixed

- **Provisioning stops re-installing a pin that cannot be reached.** Consecutive install failures are recorded per pin in `<profile>/.provision-state.json`; a failing pin backs off for 10 minutes and is skipped after 3 attempts, and the record resets after 24 hours. A missing or unreadable state file is read as "no memory", so the old behavior is the fallback.
- **`dsh plugin add` is verified by readback, not by its exit code.** After the install, provisioning reads the version that actually landed in `node_modules` and compares it with the effective pin (including a newer version raised by an `upgrade` override); a batch that exits 0 while leaving a package at another version no longer counts as installed.
- **Skipped and degraded plugins are named.** Each one gets a one-line notice with the state file path and a `dsh-opentui upgrade` suggestion; provisioning still exits 0 and the launcher still starts, so a degraded profile does not block boot.
- **A successful upgrade leaves no empty `.upgrade-backup` directory.** The stamp directory is removed and then its parent only when empty.

### Internal

- **stub-`dsh` integration tests for the provisioning script** (`test/provision-script.test.ts`), running the real script end to end against a stub host CLI offline.

## [0.18.0] - 2026-11-16

### Added

- **`upgrade` subcommand.** `dsh-opentui upgrade` moves the launcher and the opentui profile's plugins to the latest npm version, with `--dry-run`, a confirmation prompt, backup/rollback on a failed install, and an `upgrade-overrides.json` that stops provisioning from restoring the shipped pins.

### Fixed

- **A profile upgrade survives the next start.** Provisioning now reads `upgrade-overrides.json` from the profile and treats the versions recorded there as the effective pins, so a plugin installed past its built-in pin is no longer replaced by it on the following boot. A missing file keeps the old behavior, and an unreadable one degrades to the shipped pins with a warning.
- **An undeterminable target version fails the run.** When the registry query cannot resolve a package, `upgrade` exits non-zero and writes nothing — no `node_modules` change, no lockfile, no override file, `--dry-run` included — instead of reporting success.
- **A dead registry is answered in one request.** The version query runs with `--fetch-retries 0 --fetch-timeout 20000`, so an unreachable host reports `query-failed` without npm's retry ladder.

### Internal

- **`11-upgrade` e2e scenario** against a local registry fixture (`e2e/fixtures/upgrade-registry`), covering the profile upgrade path from query through `upgrade-overrides.json` to the next provision.

## [0.17.3] - 2026-11-16

### Added

- **Splash lists installed plugins.** The welcome hero shows the loaded plugin set tui-pi style — a root row plus `name@version` lines in loader order, a `+k more` overflow row and a `plugins N` summary. The row cap tracks the live terminal size (8 lines on tall terminals, down to a single example row below 30 rows, re-computed on resize without a restart); the list refreshes live through the plugin-change push channel, and the overflow/summary copy is localized (en/zh).

### Fixed

- **The footer msgs segment no longer fakes a count.** While the journal count is unknown the segment hides instead of falling back to the send count (which read like a turn counter), and its label rides the i18n table so /language hot-switches it.
- **The 🧠 context segment keeps its full used/window(x.x%) form on narrow terminals.** A long preset label (e.g. `dsh(Standard + Append)`) now degrades first instead of crowding the context segment down to a bare token count.

## [0.17.2] - 2026-11-15

### Added

- **append-system, ported from dsh-tui-pi.** `~/.dsh/APPEND_SYSTEM.md` is appended to the system prompt of every new main session. The additions ride an `agentPreset` persona row the client provisions into the opentui profile — zero host changes, and no other profile is affected. The file is seeded once when missing and never rewritten; edits apply after the next host restart; emptying or deleting the file disables the additions (the seed only ever runs on first provision). The persona read is capped at 64 KiB with a truncation marker. `/preset` lists the composition as "Standard + Append"; resuming an existing session carries the additions only when explicitly selected.

## [0.17.1] - 2026-11-15

### Fixed

- **Numeric activity gears clamp to the same two-thirds terminal budget as `all`.** Each block now gets `min(N, budget/2)` with `budget = floor(rows * 2/3) - 2`, so a 10-line gear can no longer crowd out the transcript on short terminals; 52-row terminals are unaffected (gear 10 still renders 10 lines).
- **Settings write path hardening.** The nested-key write now falls back to the merged view's `session` slice when the profile snapshot is missing, so a bare `{session: {…}}` patch can no longer drop sibling `session` keys; boot replay rejects an out-of-contract stored value silently (fail-open, no stderr before the first paint); the settings row displays the normalized (effective) value; and a non-contract gear write is rejected with `settings.error.invalidGear` instead of landing in the profile.
- Note: 0.17.0 was never published to npm — `latest` skips it and points at 0.17.1.

## [0.17.0] - 2026-11-15

### Added

- **Configurable activity panel height.** The `/settings` TUI-specific section gains an `activityPanelHeight` row (dsh-tui-pi parity: `1` / `5` / `7` / `10` / `all`, plus `default`). Numeric gears cap each think and tool block at N lines independently; `all` drops the per-block cap and clamps the whole frame at two-thirds of the terminal rows (the transcript keeps its one-third floor), trimming the longer block's oldest lines first when the two blocks together exceed the budget. Short terminals keep the compact two-row rule bar, where the gear is inert, and the unset gear is byte-for-byte the previous graded sizing. The choice lives in the profile config's `session.activity_panel_height` key: the settings row applies it live, boot replays it before the first paint, `default` unsets the key, and an invalid stored value warns while the default sizing keeps running.

### Fixed

- **The settings write no longer clobbers sibling `session` keys.** `configSave` merges top-level keys shallowly, so writing the nested panel-height gear now merges the profile's current `session` slice into the patch instead of replacing the whole section.

## [0.16.1] - 2026-11-15

### Internal

- **Screenshot text-leak gate for the `ui` test tier.** Boots the real client in both languages across eleven surfaces and fails on any painted run resolving exactly against a locale key (the `overlay.widgets.frameTitle` class of leaks); a packed-artifact pass repeats the scan on the installed `npm pack` tarball in red and green states, and a unit canary pins the scanner itself. The UI matrix's busy-ladder scenes now follow the double-Esc stop contract, and the harness pins its scratch language to `en`. No shipped code changed in this release.

## [0.16.0] - 2026-11-15

### Added

- **Live language switching.** `/language` now applies the chosen language immediately — the locale registry rides a solid signal, so every tracked `t()` read point repaints in place; the "restart to apply" copy is gone. Persisting to the unified `lang` config key is unchanged.
- **Double-esc stop confirmation (U6, tui-pi parity).** With a turn running the first Esc only arms a `Press Esc again to stop` hint (500 ms window); the second Esc opens a `Stop everything?` confirm dialog naming the blast radius (Keep Running / Stop, Esc cancels). Confirming stops the running turn and every live subagent through the existing client-side fallback chain; single-Esc semantics outside a busy turn are untouched.

### Fixed

- **The published bundle ships its locale files.** The npm package never contained `en.json`/`zh-CN.json` and the build did not copy them, so on any installed (non-source) run the locale registry came up empty, `t()` fell open to raw key names (`overlay.widgets.frameTitle` painted as a frame title), and `/language` degraded to English regardless of the persisted `lang`. The build now copies `packages/i18n/locales` to `dist/locales`, the `files` whitelist ships it, and a prepack gate verifies the packed archive byte-for-byte.
- **`/language` picker starts on the current row.** `pickOne` hard-coded the dialog selection to row 0, so arrow+Enter committed the wrong language and bare Enter silently switched to the first entry; the picker now opts into focusing the current language, with a real-renderer ft pinning open/Up/commit.
- **`setLanguage` refuses table-less ids** instead of parking the signal on a language with no table; the composer placeholder is keyed (`composer.placeholder`) so the zh UI no longer mixes an English prompt line.

## [0.15.0] - 2026-11-15

### Added

- **Two-language UI: English and 简体中文.** A new `@dsh-opentui/i18n` leaf package carries a flat-JSON locale contract (tui-pi parity: `{param}` placeholders, whole-file strict validation, key-by-key user overrides under `$DSH_HOME/locales`), and every user-facing surface is migrated onto it — commands, panels, settings, dialogs, docks, hints, transcript. `zh-CN` is fully translated (technical terms and key caps stay in English); the language is fixed at boot from the unified `lang` config key (the legacy `hintsLocale` still resolves as a fallback), and an explicit `ja`/`ko` request degrades to `en` with a warning.
- **`/language` command.** The ask-style picker lists the installed languages with the current one marked and persists the choice behind a "restart to apply" notice (unchanged semantics on esc/no-answer/same-language, tui-pi parity); `/hints lang` and the settings language row write the same unified key.

### Fixed

- **User locale overrides actually load.** `loadLocales` left the user-override directory undefined unless the caller passed it, so the `$DSH_HOME/locales` merge contract never ran on the real boot path — user files (and their strict-validation warnings) were silently skipped. The default now resolves `$DSH_HOME`, pinned by a boot-contract regression test.
- **The 61-btw render gap was a mock-keying artifact, not lost rows.** A Q2 request body embeds the Q1 marker and the e2e mock's first-match lookup re-served the first answer. The mock now keys by last match, an optional `DSH_OPENTUI_TRACE_FILE` traces the wire, and a settled-but-empty answer paints an `(empty answer)` placeholder so the signature is visible instead of absent.
- **Test/verify harnesses follow the locale-keyed copy.** The ui-matrix and agents-mount assertions and the 71/72 dependency gates matched hard-coded copy that i18n moved into locale files; they now assert the active-language copy and grep `t()` key names, so gate-dark no longer misreads a fresh bundle as stale.

## [0.14.0] - 2026-11-14

### Added

- **`/export` writes the session journal to JSONL.** The new slash command exports the active session's journal via the production sessionJournal seam (`session/page` pagination) to a JSONL file — default `~/Downloads/dsh-session-<id8>.jsonl`, an explicit `[path]` argument overrides it. The completion line reports the record count and absolute path and labels the output as the host journal format (no cross-client replay claim); no session or no face degrades to a notice instead of a crash.
- **Ask free-text answers.** Every ask question gains a `Type something.` sentinel row: selecting it switches to an inline input (Enter submits, Esc returns to the picker without declining the batch), the submission rides `Answer.custom` with strict option/custom mutual exclusion, and a `✎` marker tracks the typed answer through the review gate. Multi-question batches settle custom answers through the same review flow as picks.

### Fixed

- **Skills uninstall no longer follows links outside the managed root.** Uninstall resolves the link's realpath and refuses targets outside the skills source root (batch rows fold as `external target (not ours)`); dangling or looping dead links stay removable, and untestable errno states (EACCES/EIO) fail safe by refusing, mirroring the install-side discipline.
- **Blank `agentsHome` is visible instead of silent.** A set-but-empty `DSH_AGENTS_HOME` or an empty `agentsHome` config key boots with a notice explaining the client falls back to `~/.agents` while the host resolves the empty value to the cwd, naming the fix for each leg (and both); the resolution itself stays defensive on the client.
- **Ask scenario navigation is row-aware.** The `60-ask-user` e2e scenario walks the picker by the highlighted row instead of a fixed step count, so the sentinel row's wrap shift can no longer flip which option a blind arrow press toggles.

## [0.13.1] - 2026-11-14

### Fixed

- **Remote force-stop is honest about its outcome.** When the dedicated `subagents/interruptByParent` route is missing from the host composition, the remote subagents panel falls back to the api-session-controller's `session/cancel` on the child's own session id; both legs failing throws the combined error. `forceStop` now resolves its outcome from the wire — the cancelled settle and the hard-stop markers only fold when the stop actually landed, and a failed stop leaves the child running and reports nothing was stopped (no false ⏻ marker). The subagent policy accepts async stops and fires markers only on a resolved `true`.
- **Attachment read-back uses the full admitted wire ref.** `session/attachment` read-back now extracts the full admitted image refs (attachmentId, mediaType, bytes, width, height) from the follow journal's prompt content and sends them verbatim, instead of an id-only ref the host's strict codec rejects; a ref missing from the journal degrades to a placeholder that surfaces as a typed rejection rather than a wire fault.
- **Remote live-smoke no longer kills its own runner.** The `finally` port sweep excludes the runner's own pid, so a same-port restart's lingering carrier socket can no longer group-signal the test runner before it prints its summary.
- **E2E scenarios realigned with the current UI.** The settings scenario drives the v1.2 sectioned `/settings` modal (section navigation, instant-save enum editor, exit confirmation); the commands overflow assertion computes the count from the command registry instead of pinning a literal; gate-dark 72 boots the TUI before probing `/agents` and expects the registered-command not-mounted reply rather than the pre-C3 `unknown command` row; e2e 62 capability-gates the hard-stop ladder on the `subagents/interruptByParent` route before running it.

## [0.13.0] - 2026-11-14

### Added

- **`/history` two-pane turn browser.** A pure data layer plus a slash-host page: sessions on one pane, the selected session's turns on the other, with fork/resume from a chosen turn.
- **`/skills` Installed/Available manager panel.** The slash command opens a manager panel with Installed and Available sections; panel roots ride page props so it opens against the live client.
- **`/subagents` live transcript viewer.** The new slash command opens a large-window viewer over running subagent transcripts.
- **`/plugins` management panel.** The panel now drives the host pluginManager face end to end — toggling plugins, installing bundles, and reflecting bundle changes.
- **`/search` resume on Enter.** Confirming a search hit on the session layer resumes that session; a failed resume stays reachable.
- **`/logout` gate.** The command opens a confirm dialog onto the login seam, honoring the profile's own `apiKeyEnv`.
- **`/model` favorites.** The model picker gains favorite (`f`) and hide (`h`) keys over the stored option list.
- **Resume corrupt-log repair.** A failed store list with a corrupt log offers an explicit-confirm repair flow instead of reading as "no stored sessions"; a transcript read failure surfaces on first hydrate instead of silently rendering empty.
- **Home/End transcript navigation.** In pure transcript state the composer-area keys scroll the transcript to its first/last row.

### Fixed

- **History wiring and interactions.** `buildSlashDeps` now actually carries `openHistory` (real-machine `/history` answered "not mounted"); one `s` press opens one session layer with Enter reachable on it; the browse target is staged-aware, and forking carries a busy latch plus a switch-window guard.
- **Search key routing.** The global layer no longer swallows `j`/`k` inside search queries.
- **Plugins seam.** `installBundle` uses the correct wire shape and detects bundle changes; rejected panel mutations surface as a flash instead of unhandled rejections.
- **Model picker.** Fixed the crash and cursor drift in the favorite/hide wiring.

## [0.12.2] - 2026-11-13

### Added

- **`--version` prints `dsh-opentui <version>` and exits** without booting the TUI or provisioning.
- **`--force` kills stale host/client instances sharing the current DSH_HOME** (TERM→KILL ladder, prints `--force: killed N stale instance(s)`) before a clean boot.

## [0.12.1] - 2026-11-13

### Fixed

- **Confirm dialog buttons are framed on all four sides.** Both actions now carry a full border, and the focused one is filled plus heavy-bordered, so the two choices read as buttons in either state instead of the unfocused one looking like plain text. The exit prompt in `/settings` renames its actions 取消/退出 to 返回/确认退出, and the hint line's Esc verb follows the cancel label (`Esc 返回`).
- **Wide glyphs (CJK) are no longer lost on panels under an overlay.** Covered layers used to be dimmed by a per-layer translucent scrim, whose alpha background fill rewrites the cells it covers and drops the trailing half of a double-width glyph (opentui 0.8.1) — background panel text came out mangled. Layers below the top are now dimmed through a color projection of the panel theme (new `dim` prop / `dimTheme`), and the scrim is kept only on the bottom layer, where it dims the page behind; dimmed panels keep every grapheme.
- **`/settings` section counts share one right-aligned column.** The counts used to trail their own labels, so the nav column's right edge moved row to row; they now sit in a fixed column at the list's width edge (new panel-kit `descriptionAlign` prop, `descriptionTone` is color-only again). The header separator also spans the panel's full inner width, so the rule meets both side borders instead of stopping three cells short.

## [0.10.2] - 2026-11-13

### Changed

- **Default subagent registry plugin moves to 0.20.0.** The pinned default (`@aiwayds/dsh-subagent-registry`) is bumped from 0.19.1; provisioning stays idempotent, `--plugins=none` still disables it, and a failed install still degrades without blocking boot.

## [0.12.0] - 2026-11-13

### Changed

- **`/settings` saves instantly.** Picking a value writes it through the existing local/host channels the moment it is picked — the 确定/Ctrl+S commit step, the draft buffer and the 未提交 counter are gone. The status line flashes `已保存 · <row>`; a failed save keeps the editor open with the error. The top-level Esc opens an exit confirm (取消/退出) before closing, and command-jump rows close the panel and then dispatch, so `打开 /model` really opens the model picker.
- **Panel colours follow the theme.** Content rows, badges, N/A notes, section titles and editor options paint through new semantic theme roles (code/user/system/heading/danger) with a 4.5:1 contrast floor; `text.danger` previously resolved to the background colour in every shipped theme. Switching themes recolours the panels with them.

## [0.11.0] - 2026-11-13

### Changed

- **The `/settings` frame is fixed.** The modal pins its outer frame at 75% of the terminal height (clamped), so stepping through the seven sections no longer resizes the panel; overflow pages inside with the existing `x-y/N` indicator.
- **Layered chrome.** A title band, a raised nav column behind a separator, a surface content area and bordered footer buttons replace the single flat black box; every colour resolves from the panel theme (contrast pinned at >=4.5:1 on dsh-blue, tokyonight and gruvbox follow their tokens).

### Fixed

- **The discard-confirm dialog is fully keyboard-driven.** `←/→`, `Tab`/`Shift+Tab` move between 取消 and 丢弃, `Enter`/`Space` activate the focused action (the hint travels with the focus instead of sitting on one fixed button), and `Esc` cancels; both buttons carry visible borders so the unfocused one no longer reads as plain text.

## [0.10.1] - 2026-11-13

### Fixed

- **`/agents` read `DEEP` and `LIMITS` as one column.** The deep column was right-aligned inside a five-cell slot, so the only separation from the next column was the kit's single shared gap — the header printed as `DEEP LIMITS` and the values as `0 —`. The slot is now six cells and left-aligned, which turns the column's own padding into visible spacing at both 120x40 and 80x24 without changing the shared `COLUMN_GAP` (so the `/settings` row table is unaffected).

## [0.9.9] - 2026-11-12

### Added

- **The composer top border is the context bar** — it embeds a `steer · directory · git branch` title (segments joined by ` · `, no dash runs of our own; the directory is left-clipped when the terminal is tight and a failed branch probe silently degrades to directory-only). While a turn is steering, the `steer` segment gains a braille spinner whose rotation frames advance on the shared animation tick.

## [0.9.8] - 2026-11-12

### Fixed

- Upgrading from pre-0.9.x profiles no longer breaks plugin installs: a leftover `patchedDependencies` entry whose package is gone is retired automatically during provisioning.
- Provisioning no longer retries plugin installs that can never succeed (e.g. `ERR_PNPM_UNUSED_PATCH`); those now fail fast with an actionable hint while transient network failures keep retrying.

## [0.9.7] - 2026-11-12

### Fixed

- **Picking a model now applies it** — the picked route was read back through the staged value but the application step swallowed it, so a selection could silently fall back to the catalog default. Selection failures now surface in the transcript instead of vanishing into a console log, and bare `/model` asks for the effort level as one flow (`esc` abandons the whole pick).
- **The spin attention feed is back** — the per-turn attention feed lost in an earlier refactor is restored, refreshed at most once every 5 seconds.
- **The client bundle packs reliably** — the attention feed's optional probe import tripped the bundle leak guard in prepack; the probe specifier is now pinned so packaging succeeds, and a missing `@aiwayds/dsh-jev-core` still degrades silently at runtime.
- **Cold install retries a failed plugin add** — one flaky `pnpm add` used to be warned about and skipped, leaving the profile short a plugin; each failed spec is retried up to 3 times with a 5-second backoff and a final failure stays loud.
- **`ctrl+alt+f` opens session search** — keybind parity with `dsh-tui-pi`; `page.down` keeps pagedown.

### Changed

- **Cold plugin installs no longer false-fail on slow networks** — the e2e install wait for the npm-installed bin leg now allows up to 10 minutes (registry served 1.7–2.1 KB/s when measured), replacing the 3-minute timeout that fired before the 14-package install finished; the e2e round-limit staging also targets the profile `config.json` top-level keys the client ladder actually reads.

## [0.9.6] - 2026-11-11

### Added

- **Test tiers** — `test:unit|ft|ui|e2e|all` with a geometry×scene UI matrix and a real-client e2e flow suite (fake model).

### Changed

- **Session restore remains opt-in** (`--resume-last` / `autoResume: "last"`); startup defaults to a fresh session.

### Fixed

- **Footer no longer wraps on narrow terminals** — segments are dropped by priority and the context segment degrades instead of truncating mid-number.
- **Tool dock lines are clipped inside the activity frame.**
- **Message count is restored after `--resume-last`.**
- **Single shared terminal-size listener** — no more MaxListeners warnings.
- **Connection hardening** — stale host locks are detected by an HTTP probe and replaced (never killing foreign processes); readiness waits for HTTP + `$events` instead of a bound TCP port; first-connect retries are capped at 3 with the host stderr tail surfaced.

## [0.9.5] - 2026-11-11

### Added

- **`/flush`** — delivers a paused delivery queue now. A failed or aborted turn keeps the client-side queue and pauses the pump; `/flush` starts the head prompt immediately and the rest follow one per turn end, in submission order. Every outcome is reported (an empty queue is never silent).
- **Settings catalogs** — `permission.defaultPreset` reads the host `permissionPresets/catalog` RPC and offers its `defaultOptions` as real choices (the settings value, else the catalog default); without a catalog the row is read-only and shows the effective value plus why, never an empty picker. The slash skill registry keeps the boot disk snapshot and refreshes once after the first user message when `skills/list` becomes readable, so plugin-provided skills appear without a restart.

### Changed

- **A launch starts a fresh session; restore is opt-in** — a plain launch no longer reopens the last workspace session. Set `"autoResume": "last"` or pass `--resume-last` for a single launch (it overrides the config) to restore the newest non-empty session from the launch workspace that was active within the last 7 days (`autoResumeDays`); `--new` wins over both, and `--session <id>` still pins a session.

### Fixed

- **Skill rows survived a session switch** — the palette kept the previous session's plugin skill rows after `/new` or `/resume`; the session-scoped `skills/list` rows now reset to the boot snapshot.
- **`/flush` during a running turn** — the notice no longer promises delivery; it says the queued prompts wait for that turn to finish, matching the pause-on-failure behavior.

### Known Issues

- Engine paint defects remain: streaming diff-paint row loss, and wide-glyph loss under translucent overlays (upstream).
- Skills before the first message are the boot-time disk snapshot; plugin-provided skills appear only after the refresh.
- `permission.defaultPreset` choices depend on the host catalog schema; without one the row is read-only.
- The delivery queue is in-memory only and is lost on exit.
- CI cannot run the real-client tmux gate (no tmux/dsh on hosted runners).

## [0.9.4] - 2026-11-10

### Added

- **MCP by default** — the core plugin set now installs `@aiwayds/dsh-mcp-adapter`, and provisioning inserts a `mcp-context7` client row (streamable HTTP, no API key) so `mcp_list` / `mcp_call` have a server to catalog on a fresh profile. An existing row is never rewritten or duplicated; `--plugins=none` writes neither.
- **Steer or queue on a busy submit** — Enter on a busy turn opens a two-row choice (Steer is the default highlight; `esc` keeps the typed text). Queueing is client-side: one prompt per turn end in submission order. Failed or aborted turns pause the queue and notify; the next successful turn end resumes it. The transcript shows muted `⏸ 排队等待 #N` queue rows and `⤵ 已注入当前回合` steer receipts that flip to `✓ 已投递` at turn end.
- **cwd · git branch row** — one muted row directly above the composer with the workspace directory (`~/…` abbreviation, left-clipped tail) and the git branch (short SHA on a detached HEAD). Probed on mount and on each session switch; non-repos and probe failures degrade silently to the directory only.
- **Session restore on launch (opt-in)** — a plain launch starts a new, empty session. Setting `"autoResume": "last"` reopens the newest non-empty session from the launch workspace that was active within the last 7 days and prints one `resumed <title> · <time ago>` notice; `--resume-last` enables it for a single launch (overrides the config). `--new` always starts fresh and wins over both, `--session <id>` pins a session, and `autoResumeDays` changes the window.

### Changed

- **Footer context percent is compact** — the value uses its own digit width, so `(5.9%)` replaces `(   5.9%)` and the rolling leaf agrees with the static text at rest.

### Fixed

- **Transcript loss on `/resume` and after a host reconnect** — the reload carried the live session id instead of the picked one, so the read failed and the empty result was hydrated as history; and `storedTranscript` answered `[]` for any failed journal read, making "no history" indistinguishable from a transient host/RPC error. Reload now passes the picked id, errors propagate (callers keep their rows), and `/new` clears explicitly. Disk data was never affected.

### Known Issues

- Engine paint defects remain: streaming diff-paint row loss, and wide-glyph loss under translucent overlays (upstream).
- Skills are a boot-time snapshot of local directories; plugin-provided skills are not listed.
- `permission.defaultPreset` has no options in the current host schema.
- Input history is in-memory only.
- CI cannot run the real-client tmux gate (no tmux/dsh on hosted runners).

## [0.9.3] - 2026-11-10

### Added

- **Slash palette upgrades** — Tab completion, a 10-row window with a `… N more` overflow row, skills listed as `/skill-name` entries in italic with Tab completion, and usage-frequency ranking persisted to the profile `config.json`.
- **`/agents`** — an agent definition manager with table / fields / limits layers aligned with `dsh-tui-pi`; it writes the frontmatter the registry consumes (`model`, `thinking`, `deep`, `maxRounds`, `background`).
- **`/settings`** — a panel with local preferences, host settings (subagent caps, permission preset, session log), and read-only namespaces.
- **Pane focus** — `F6` or a click switches between transcript and composer; the transcript scrolls and draws focused/unfocused frames; the mouse is enabled (`Shift`+drag for native selection).
- **Dock** — think/tool blocks show 3 lines, linger for 2s, then fade over 0.3s, and are replaced by newer content within the window.
- **Provisioning** — the default plugin set (10) is installed on first launch with `[n/5]` progress; `tool-web` is enabled with the anysearch provider (keyless search); the legacy `@aiwayds/dsh-opentui` bundle entry was removed.
- **Host idle exit** — the resident host exits 5s after the last client disconnects (`DSH_OPENTUI_HOST_IDLE_MS`).
- **Verification gates** — `typecheck:entry`, `verify:assembly`, and a 42-check real-client tmux script.

### Changed

- **`/sessions` renamed to `/resume`** — no alias.
- **`/motion` bare output** — shows the configured preference and the effective tier (`auto → reduced`).
- **Default plugin provisioning runs on every launch** — idempotent, a no-op when already satisfied.

### Fixed

- **`PgUp`/`PgDn`/`Home`/`End` swallowed by the transcript and textarea layers** — the slash palette could not scroll past 6 rows.
- **Panel/command wiring** — `openAgents` never reached the command context, so `/agents` reported "not mounted".
- **Editing one frontmatter field deleted another** — model was lost on thinking-only edits.
- **Empty-corpus landing state** and **overlay open-state never reset on unmount** — the sidebar `Esc` stopped working.
- **`web_search` unavailable** — the web-app disables `tool-web` and the opentui patch never re-enabled it.
- **Copy-on-select used a no-op clipboard stub** — search no longer restored `stickyScroll`.
- **Idle reaper script path resolution in the source tree** — hosts were never reaped.
- **Think-only turns never painted the fade frames** — the clock signal was not consumed when collapsed.
- **Stale fade anchor on resumed thinking lines.**

### Known Issues

- Engine paint defects remain: streaming diff-paint row loss, and wide-glyph loss under translucent overlays (upstream).
- Skills are a boot-time snapshot of local directories; plugin-provided skills are not listed.
- `permission.defaultPreset` has no options in the current host schema.
- Input history is in-memory only.
- CI cannot run the real-client tmux gate (no tmux/dsh on hosted runners).

## [0.9.2] - 2026-11-09

### Added

- **Footer aligned with `dsh-tui-pi`** — provider icon, effort ladder display, context usage segment, tools/messages counters, tok/s, and subagent lines with `round N` plus a live tail. The context usage segment reads the `session/projections` token-meter projection and renders `used/window(pct)`.
- **Todos table with a five-row window** — terminals at 30 rows or fewer collapse the table to a single summary row.
- **Shell-style input history recall** — `↑`/`↓` recall with draft staging and restore, plus custom keybinding overrides.
- **Preset label in the brand segment** — the footer brand reads `dsh(preset)`.
- **Hint bar per-segment toggles** — eight segments, four locales, and the selection persists across restarts.
- **Semantic colors for think/tool rows** — think and tool activity lines get their own status colors.
- **Bright blue turn-lifetime activity frame border** — the active turn frame keeps one bright blue border for the whole turn.
- **Multi-hue luminance-ordered footer ramp** — the powerline gradient follows a hue-monotonic, luminance-ordered ramp.
- **v1 theme accent fidelity** — every v1 accent hex value is preserved exactly (59/59).
- **Transparent-surface fix** — the `lucent-orng` theme is readable in light mode.

### Fixed

- **Selected-row description contrast** — descriptions in the slash palette and dialogs go from 1.31:1 to at least 6.3:1.
- **Footer not refreshing after `/think` and `/model`** — effort and model segments now refresh immediately.
- **`/think` default level** — the default think level is `high` when unset.
- **Subagent tail concatenation** — the live tail no longer concatenates across tool results.
- **`↑`/`↓` swallowed by the keymap layer** — history recall now works in the real client.
- **Todos table right border** — aligned with the composer frame.
- **Stale context window denominator** — cleared and re-read after a route switch.
- **Preset label races** — staged presets, transient read failures, and unknown ids no longer leave a wrong or sticky label.
- **Slash palette height** — stable per keystroke, and rendered rows no longer overflow the frame.

### Known Issues

- Engine-level paint bugs remain: diff-paint row loss under streaming, and translucent overlays dropping wide glyphs.
- Input history is in-memory only — it is cleared on restart.
- Emoji in a powerline segment is hidden while an overlay is open (engine behavior).

## [0.9.1] - 2026-11-09

### Fixed

- **Slash palette height no longer shifts per keystroke** — the palette keeps a stable frame while filtering, eliminating the per-keystroke reflow flicker while typing a slash command.
- **Palette no longer renders rows beyond its frame** — rendered rows are capped so the overflow can no longer push into / overlap the composer input (pre-existing bug).

### Development

- **The test suite now runs with the real solid-js reactive runtime** — a bunfig `[test].preload` fix gives every suite the real runtime instead of a no-op stub, closing a long-standing blind spot where assertions ran against nothing reactive.

## [0.9.0] - 2026-11-09

### Added

- **New default theme `dsh-blue`** — dark and light variants, auto-selected from the terminal background; `/theme` pins an explicit choice, and the theme list marks entries with `●` and offers auto/dark/light items.
- **Focus visuals** — the focused element carries a thick-line accent frame; the transcript's current row gets a full-row background highlight; approval/question cards take warning accents.
- **Framed boxes** — the composer input gets a four-sided border (warning color and a steer title while busy); user messages render in a single-line frame; streaming code blocks draw a left rule while streaming that closes into a language-labeled frame when the block ends; the in-turn activity draws a frame.
- **Motion system** — letter-by-letter welcome wordmark fade-in, comet gradient trail, rolling powerline numbers, fade in/out transitions, pulsing reminder marker; borders never color-animate. `/motion full|reduced|off|auto` and `DSH_OPENTUI_MOTION` control it; tmux/SSH/non-truecolor terminals reduce automatically.
- **Cursor** — a vertical-bar cursor that changes color while busy.

### Changed

- **One-shot skin migration** — users who had already picked a theme are switched to `dsh-blue` once on upgrade, with a notice. The migration is accounted per profile: once any workspace has triggered it, other workspaces' previous theme choices no longer migrate automatically (switch with `/theme`).

### Known Issues

- Occasional flicker is more likely: dropped frames from the engine's reflow (paint bug upstream of the skin).
- Wide characters can vanish behind a popup's translucent overlay.
- Borders may flicker while typing a slash command.
- Rolling back to 0.8.0: `theme=dsh-blue` silently falls back to the old default theme; a workspace `.dsh/config.yml` that carries a `themeMode` key fails the old version's layer overlay validation (fail-closed) — delete that key to restore.
- With a popup open, the powerline's model emoji segment is not displayed (pre-existing engine behavior, not fixed in this release).
- The activity frame mounts/unmounts with a deliberate 60ms delay to prevent flicker; under extreme timing a single ghost frame can still appear and self-heals on the next frame.

## [0.8.0] - 2026-11-08

### Changed

- **Dock layout restructure (batches D1–D3): the session page composes as fixed dock slots, and the transcript goes chat-clean.** The page order is now status → widgets → editor → lastRequest → notices → powerline → hints: the whale comet status bar moves to the dock top while busy (zero rows idle, above the widgets dock); the widgets slot renders the Todos / Think / Tool single-line panels between the transcript and the composer (one pure pass over the shared seam-rows store); the lastRequest slot sits below the editor — the sent prompt echoes as a `●` line with one `├─/└─ <label> · Xs · <tail>` row per RUNNING child, cleared when the child settles and on session switch; notices stack directly above the powerline; the hints row is the last page row and the powerline drops the `Ctrl+Shift+F: search` segment (pure segments again). The transcript renders the chat-clean set only (user/assistant/echo/notice/ask) — tool blocks, think rows and the left-rail track line are gone from the flow, and the subagent tree left it entirely in D2. Tool call args humanize: `use_agent` reads `agent: <name> <prompt…>`, `ask_agent` reads `→ agent · content`.

### Added

- **Notices dock slot** — transient notice rows (the subagent steer echo, subagent-settled relay notices) paint as markdown above the powerline; each line retires on its own 8s timer (timer-only, never on keypress), capped at 8 with the oldest dropped.
- **`/hints`** — toggles the keybinding hints row (idle: enter send · alt+enter newline · ↑↓ history; busy: enter steer · esc stop; plus subagents/search/scroll/quit rows).
- **Unified widget hide law** — think/tool dock widgets fade out ~1s after their content stops; the Todos row hides when the list is empty or all completed; the Subagents surface is a single selection line (no second bordered roster dock) and its bar opens only while a child runs, auto-closing when none does (the ↓ key falls back to history); the `↓ subagents` hint shows only while a child runs.

### Fixed

- **Todos dock row renders against the real dsh host** — the tool-name match covered only the opencode spelling `todowrite`; the dsh host's model-side call name is `todo_write`. Both spellings match via an exact set (no other `todo*` tool feeds the panel), and the todo list is read from the call arguments' `todos` array first (the host's result brief carries rendered text only), falling back to the bare-array output brief (opencode shape); failed calls are skipped.
- **Subagent label bare-id fallback on late join** — the child-follow snapshot replay dropped the whole snapshot (the host only sends the delegation label in the journal records, never re-sends it on the live stream), so the running-child row showed `subagent <id8>`; the snapshot now folds its records through the same event path (display catch-up only — the maxRounds ladder stays live-frame fed so a replay cannot re-arm force-stop).
- **ask_agent tool row no longer renders raw JSON** — `{ agent_id, prompt | message }` reads `→ agent · content`; undiggable tool-result envelopes render their depth-2 string leaves or a `tool result` placeholder, never raw JSON.
- **Host-injected messages no longer leak into the transcript as user prompt lines** — `user/message` records with a non-user source are filtered out of the seam rows.

## [0.7.0] - 2026-11-08

### Added

- **Visual alignment batch (V1–V5): the client view matches the reference TUI.** Tool blocks in the transcript flow render name + subject with a spinner while running, finalize on reject, and clip CJK by display width (V1); the thinking panel is a phase machine in the transcript fed by `reasoning_content` deltas (V2a); live subagent rows appear in the transcript flow as a tree (V2b); a welcome hero with quotes gates on hydration and renders at 60 columns (V3); assistant markdown tables render with grid borders (V4); and the transcript moves to one status-color family with running/fail rails on tool blocks (V5).

### Changed

- **Client-only distribution (retirement batches B1–B5).** The npm package no longer ships or boots the in-process plugin mode: `scripts/build-client.mjs` bundles the self-contained client at `prepack` (B1); the `dsh-opentui` bin is a client-chain launcher — bun/dsh detection with install guidance, idempotent `opentui` profile provisioning, a one-time legacy-profile preference migration, and an SDK closure symlink for `@deepseek-ai/dsh-client-connection` (B2); `package.json` ships `bin/ + scripts/ + dist/client + dist/scripts` only (B3); the `--plugin` chain and its dist-host build are deleted (B4, −35k lines); and the e2e suite runs the client face only (B5). The retired plugin-face live scripts (`e2e-live.mjs` / `e2e-fork.mjs`) and the `test:e2e` script were removed with them; CI keeps the per-package `bun test` matrix, and the real-boot leg is covered by the release gate (fresh-install boot render check) before every publish.

### Fixed

- **Theme persistence** — `/theme` writes the choice to the profile `config.json` instead of evaporating on restart (67-theme).
- **`ask` multiSelect passthrough** — multi-select ask overlays deliver the full selection set instead of dropping it (63 scenario face store path).
- **Subagent ladder caps** — the client sources the ladder caps from the profile `config.json` (subagent-policy parity with the retired host path).
- **CJK display width** — tool-block rows clip by display width so CJK text no longer overruns the column.

## [0.6.1] - 2026-11-08

### Fixed

- **`/search` and `/plugins` client entries wired** — the batch-H3 slash deps (openSearch/openPlugins) and their overlay mounts existed only in `host-entry-v2.tsx`; the client entry (`packages/tui-base/examples/v2-entry.tsx`) now wires `openSessionsSearch`/`openPluginsPanel` deps on `createSlashHost` and mounts `SessionsSearch`/`PluginsPanel` in the root children.
- **Slash palette prefix shadowing on Enter** — a fully typed `/session` ran the longer `/sessions` prefix row and opened the Resume picker; `interceptSubmit` now resolves an exact-name match first, so highlighted-prefix rows no longer shadow the typed command.
- **Plugins panel cache + double solid instance on boot warm** — the plugins panel no longer rebuilds its cache per open, and the boot-warm path no longer spawns a second solid instance.

## [0.10.0] - 2026-11-13

### Changed

- **`/agents` rides the same panel-kit modal and `PanelStack`.** The eight drill-down levels (table → fields / limits → editors → model and effort pickers → prompt viewer) are eight stack layers, so Esc always pops exactly one layer (inner-first) and the consumer no longer owns an Esc chain. The table paints true multi-column cells (NAME / MODEL / THINK / DEEP / LIMITS) through the kit's columns/cells and pages at 12 rows with cursor-following windows under PgUp/PgDn/Home/End. The letter hotkeys (`m`/`t`/`d`/`v`/`l`) stay on the app's own keymap layer and answer only while the manager's layer is `panels.top`, so composer typing or a kit confirm can never be read as a command; the paged-list keys are gated the same way and only when the list overflows. Partial writes are reported honestly: a model save that lands while the effort half fails keeps the change, names the half that failed, and the exit summary lists the agent instead of claiming "Agents unchanged."; the zero-agent corpus still lands on its single `limits` layer, where Esc closes the manager.

- **PLUGIN MODE CUTOVER — batch C1 flips the dist-host build to the v2 view on the @opentui 0.8.2 node-paint stack.** `build-host.ts`'s v2 recipe (host-entry-v2.tsx, @opentui core/solid/keymap 0.8.2 + solid-js 1.9.17 externals, the 0.8.2-only node frame flush, tui-base's own solid plugin + the `#string-width` node-variant pin + the `./store` client-export route) is now the DEFAULT; `--v2` stays as a no-op alias and the frozen 0.4.3 recipe lives in git history. (1) F1c cold-boot attach stall landed in `host-session.ts`: `storedTranscript("")` now RESOLVES `[]` before touching persistence (cold boot has no session id; `persistence.open("")` rejects `session "" not found` and the v2 hydration loader's catch swallows rejections, so the loader never cleared) — pinned by two unit tests (empty id resolves without opening persistence; a real id still drains, `test/host-session.test.ts`). (2) The published-tarball root manifest (`packages/shell/package.json`) pins the 0.8.2 closure (`@opentui/core|solid|keymap` exact `0.8.2`, `solid-js` exact `1.9.17` — exact, not `^`, so a hoisting install can never drift past the `solid-js@1.9.17` patchedDependencies key), mirroring F1b's smoke workaround. (3) `scripts/solid-js-pin.mjs` generalized to 1.9.17: the patch is mechanically derived from the pristine registry package.json (hunk-context-exact — a hand-transcribed variant failed `ERR_PNPM_PATCH_FAILED`; pnpm's applier is stricter than `git apply`), and unlike the 1.9.12 patch it KEEPS a pinned `"./store"` entry (client store build) because the v2 view imports `solid-js/store` from the profile's copy; `SOLID_JS_EXPORTS` gains the same entry, `ensureSolidPatch` strips stale other-version `solid-js@` patch keys when registering, and `smoke-boot.mjs` imports the export set instead of its hand-copied old shape (which silently dropped `./store` and broke the boot with `ERR_PACKAGE_PATH_NOT_EXPORTED`). (4) Validation: `npm pack` → scratch profile via `install-profile.mjs` (`--dep file:`) — pnpm applies the patch, the direct re-pin reports "already" (patch is primary), hoisted closure `0.8.2 ×3 + solid-js@1.9.17`; `smoke-boot` PASS (real dsh boot, packed tarball renders, no loader hang); plugin-mode tmux 120x34: boot paints, `/model` opens, esc, `/new`, `/quit` clean. Gates ×3: shell 308 pass/3 skip/0 fail, tui-base 102/0, kit 22/0, runtime 5/0; `tsc --noEmit` ×3 — shell 0, kit 0, tui-base 58=58 budget. dist-host rebuilt (v2 entry, 0.8.2 manifest, dsh-llm symlink).

### Added

- **`packages/panel-kit` — one shared modal kit for interactive panels.** A new private workspace package (`@dsh-opentui/panel-kit`) that replaces the per-screen modal plumbing: `Panel` + `PanelStack` (layered routing, Esc pops exactly one layer), a shared-clock fade transition (enter/exit `FADE_MS`, driven by `onAnimationTick` so no timer runs once it settles, with a static-motion fallback), the controls `List` / `Button` / `Check` / `ConfirmDialog` / `Dropdown` / `InputRow`, true multi-column `columns`/`cells` row painting through wide-glyph-aware cell measuring, and page windows with cursor-following `first-last/total` indicators. Theme is injected once via `PanelKitContext`, and host keys go through `PanelKitProvider` so a panel sees keys only while its layer is `panels.top`. `/settings` and `/agents` are its first two consumers.

- **`/settings` opens as a panel-kit modal.** The inline block that ate ~23 transcript rows is gone: the screen is a `PanelStack` layer on the `xlarge` frame (116 cells, clamped to terminal width − 2), with a 160 ms one-shot fade in and out, no mouse path, and Esc walking editor → section → close one level per press. Seven sections: General (12 rows, web fields 1:1 — permission preset, language, appearance, working steps, session log and version are live; font size, link opening, developer tools, performance usage and the three working-step fields carry explicit N/A notes instead of dead controls), the TUI-only group, Host (the four whitelisted host rows, then every other namespace read-only), and the four command-jump sections (Models/Plugins/Agent presets/Account close the panel and dispatch `/model` `/plugins` `/preset` `/login`). Editing is draft-based: every change stages into a draft keyed by write target (so General 外观 and the TUI themeMode row share one staged value), `确定` / `Ctrl+S` commits them in one pass through the existing writers (host writes stay path-ops-only, each followed by a fresh describe with one conflict retry), a dirty Esc opens the kit's destructive discard confirm instead of dropping the buffer, and a failed commit rolls back only the rows it attempted — untouched drafts survive for a retry. Rows per page derive from the live terminal height (`rows − 15`, clamped 4–16): 120×40 shows all 12 General rows on the first screen, 80×24 pages with an `x-y/N` indicator, and PgUp/PgDn/Home/End are consumed only while the section overflows.

- **Turn-end paint-corruption DETECTION infrastructure (Batch B mitigation for the confirmed OpenTUI 0.7.0 engine bug).** A long streaming turn corrupts the native diff-paint state — reply rows bleed into the input box and SIGWINCH does NOT heal it (only a renderer state reset does; 0.8.2 tried and reverted). `packages/shell/src/client/turn-heal.ts` lands the detection half only: `createTurnHeal` wraps the client entry's session surface (same Proxy pattern as `aggregateTurnContext`, real-target accessors), churn-tracks every turn (content deltas + streamed chars + streaming seconds) and schedules exactly ONE deferred heal per threshold trip at turn end (settle delay 1000ms; a newer `turn()` voids a pending heal — never bounce the terminal mid-turn; the settlement `finally` anchor also covers error endings without `onTurnEnd`, idempotent per turn seq). Thresholds `maxChars 2000 / maxDeltas 400 / maxSecs 120` are tuned from the deterministic tear repro (60-sentence weather prompt: ~299 torn frames over ~150s, ~2.7k streamed chars — trips all three; an ordinary short turn ~<500 chars, <30s trips none). The heal ACTION is a deliberate no-op stub via the `heal` factory seam: the cheapest API candidate, `renderer.suspend()` → `resume()` (native terminal transition cycle + forceFullRepaint on resume), was FALSIFIED by the live tear repro (2026-11-05) — the turn froze at end, screen static and torn from the turn-end frame onward, idle placeholder never returned, subsequent input dead (suspend halts the render loop and its native transition never completes in this configuration, so resume is impossible). DO NOT RETRY the suspend/resume bounce. The remaining mechanism, threshold-based renderer recreation at turn end, needs ShellHost state (input buffer, transcript, dock, focus) externalized first — a ShellHost edit would break the dist-host zero-diff gate, so it is out of this batch's scope; the seam makes recreation a one-line swap once that refactor lands. Tests: `test/turn-heal.test.ts` (10 tests — threshold trips per counter, one-heal-per-turn, newer-turn voiding, error-path settlement, heal-factory-null skip, proxy pass-through). 10 tests ride the shell suite (277 ran / 3 skip / 0 fail); dist-host rebuild verified byte-identical (client modules not bundled).

- **e2e-sweep hardened to the 68-item gate + a `KNOWN_STALL` annotation.** The sweep's own false-PASS/false-FAIL classes are closed: the `/preset` probe now waits for the picker's real anchors (its dispatch is ASYNC via the host `listPresets` RPC — the old wait returned on a stale `/config` frame whose "minimal" text collided with the marker, then escaped at nothing and the late picker leaked into `/model`: a recorded false-PASS), and the pane settles (stable-frame poll) BEFORE the close esc fires so a late-opening picker is actually up; first-key-drop guards generalize — `submit()`'s verify/clean/retype (now RAW-verified; `flat()` strips the leading `/` and would pass the broken state) plus a new `typeVerified` for raw bursts (a dropped `/` turned `/login` into the plain prompt "login", a REAL turn); a vacuous `/search` anchor is dropped (`search:` matched the `/hotkeys` keybinding row under `flat()`, passing frames where the response row never painted); `settlePane` polls until two consecutive captures agree (digits stripped — the powerline clock ticks every second) instead of fixed sleeps; `ensureIdle` declines a pending ask overlay / disarms a stray stop-confirm before waiting; `cleanBuffer` verifies the idle row and re-sweeps once (full-load render stalls drop BACKSPACES too, leaking half-cleared buffers into the next command). The two render-paint stall items (`palette filter /lo`, `alt+enter newline` — both verified correct in isolation) print as `KNOWN-STALL` in the summary while still COUNTING as failures in the RESULT/exit gate. Validation run (batch D): 65 PASS / 2 KNOWN-STALL / 1 CHECK — the cleanest recorded sweep.

- **`DSH_OPENTUI_DEBUG` input-line trace layer.** kit `InputLine`'s key path appends per-event JSON lines to `/tmp/host-inputline.log` (same env-gate + lazy-fs pattern as ShellHost's `/tmp/host-keys.log`; no-op when unset): every key event (name/sequence/modifiers), whether the slash palette's `onKeyFilter` consumed it or it passed to the editor, history-nav up/down with the consumed verdict, and each `onContentChange`/`onSubmit` — the handler→textarea bisect for stall incidents.

- **`e2e-sweep.mjs` — the full command-surface sweep gate (client mode).** Drives EVERY slash command and keyboard surface through the real client topology in tmux 120x34 (one char per send-keys, ~60ms gap — burst writes drop keys in OpenTUI's input parser): the read-only commands, every overlay picker with item-text anchors (kit Select title rows paint blank — anchor on items), `/config` bare/set/invalid forms, the `/login` panel + headless REF forms, the slash palette (filter ↑↓ tab enter), input history recall (↑↑ across `/`-entries — the palette must NOT own the arrows), alt+enter newline, bracketed paste, PgUp/PgDn scroll, ctrl+t/ctrl+o dock toggles, and the esc stop-confirm arm→resume/abort — plus the keystroke-leak regressions (modal-consumed keys must never type into the blurred editor; see Fixed below). Runs under a scratch `DSH_HOME` (temp dir, mode 700) seeded from the real profile so login/logout/config/preset writes never touch the user's home; real turns only where a surface needs one, via the workingRoute pattern (no route → those items report BLOCKED loudly and everything else still gates); per-item captures land in a temp caps dir; self-skips (exit 0) when `dsh`/`tmux`/`bun` are missing so CI stays green. README documents the four live verification gates.

- **Client-mode gate hardening: full accessor audit through the real session wrapper (77 members) + e2e-client scenario h.** Closes the fake-coverage hole that shipped the `/login` crash (3dec270): until now the client-mode tests drove FAKE sessions through the `aggregateTurnContext` wrapper, so the proxy/accessor seam — the wrapper's `this` binding against the real class's `#field`-backed getters — had zero coverage, and the `Cannot access private method or accessor` crash reached a live TUI. (1) Accessor audit (`test/client-entry.test.ts`, +18 tests): EVERY public member of `RemoteHostSession` (77) is now driven through a REAL instance wrapped by the REAL `aggregateTurnContext` — the exact object ShellHost receives in client mode. The contract under test: behavior is IDENTICAL through the wrapper — no accessor error anywhere, and every documented result shape holds (the fake connection answers `{}` per RPC and the socket factory throws a business error, so degraded members surface their documented degradation: `[]` / error string / business-error rejection, the same shapes the raw instance produces). Coverage spans all surfaces: fields (identity — `usage`/`lastTurnStats` pass through as the same references, `remoteTailSink` SETS land on the real target for the ShellHost wiring), `status`, `settingsSeam` (the `/login` crash path: `describe()`/`mutate()` drive `#settingsClient`), lifecycle + turn control (start/turn/steer/abort/newSession/resumeSession/dispose — dispose is clean and idempotent through the wrapper), telemetry, model/session-ops/preset/settings-credentials/push-listener/config/wave-3-local (agents, repair, git)/plugins-skills-reload/tail-attachments/subagent surfaces, cold-guard sync-throw parity, the deep chain (failed turn adopts the session id → session-bound members run → abort clears), and the exit-path routing (shutdown, then the real `process.exit`). (2) `e2e-client.mjs` scenario h — `/login` provider directory: bare `/login` opens the provider picker through the aggregateTurnContext proxy (`settingsSeam` → `#settingsClient`), known provider names render, esc closes cleanly with the editor back to idle and the powerline intact (twice, for proxy state-machine stability), and no TypeError/crash markers appear in the pane scrollback or the exit; no credential writes (opening the picker touches nothing). The gate suite is now 8 scenarios (a–h); live run 8/8.

- **`ask_user_question` Q&A transcript block.** The model's ask now leaves a readable record in the message flow instead of evaporating with the ephemeral overlay: the durable `tool/call` (questions + options, the dsh-user-questions wire schema) pairs with its `tool/result` (the answer batch; declined arrives as `{selected: [], custom: "declined"}`) into ONE `ask` transcript item — question pops in accent, options sit dimmed, the user's pick is marked ✓ in the user color, and a declined question renders honestly as "declined" (kit `askLines` shared by the rich JSX path and the scrollback line window; the `ask` kind is additive — persisted items without it keep rendering). Live turn: ShellHost parses the call args at `onToolStart` and, because the live pipeline caps the result brief at 300 chars (multi-question batches truncate), the ask overlay stashes its own picks — `buildAskTranscriptItem` prefers the parsed result and falls back to the stash; with NEITHER available the block is skipped entirely (no fabricated answers; a hard-failed result renders declined, the honest outcome). Replay parity (client mode): `journalToTranscriptRows` folds the durable tool pair into `ask` rows, so resume, fork-at-turn and the re-attach wake rebuild the Q&A block from the journal — `StoredTranscriptRow` widens the seam end to end (the `shell-session.ts` compile-time conformance guard, `client-entry` drops its `as unknown as HostSession` cast, `model-select`/`history-fork` ride the surface). Known limitation: in PLUGIN mode the host's `storedTranscript` still returns user/assistant rows only, so the block paints live but does not replay on resume there. An ask call with no settled result renders nothing (mid-turn replay / errored read). Tests: `test/ask-transcript.test.ts` + the `remote-host-session` tool-pair→dock-callbacks test over the shared `client-fakes.ts` builders, plus kit `test/frames/ask-block.test.tsx`.

- **Client-mode two-process E2E gate (`packages/shell/scripts/e2e-client.mjs`, ADR-0005 P6).** The release gate drives the REAL topology end to end: `./dsh-opentui --client` inside tmux 120x34 panes, the resident `dsh --profile opentui` host it spawns, and real model turns. Seven scenarios: (a) boot + turn with the status-bar route/context assertions, (b) multi-TUI attach (second client JOINS the same host pid; both quit → the detached idle-reaper idles the host out), (c) crash-recovery adoption (SIGKILL the client → the host survives → the next client adopts it, no respawn), (d) `/reload` same-port restart (carrier reconnect + wave-2 re-attach; acceptance: transcript rows single-painted and the restarted host MANAGED — lockfile rewritten with the new listener pid), (e) host-death recovery (SIGKILL the host mid-turn → reconnecting state → a fresh client respawns and continues; also surfaced a renderer sampling gap in the reconnecting label swap, recorded for the UI follow-up), (f) THE ORIGINAL acceptance scenario — `用一个markdown表格列出两种语言和创建年份，再写一句总结` renders a real bordered table + summary + bottom anchor (capture to `/tmp/p6-mdtable.txt`, PNG via `/tmp/tmux2png.py`), (g) workspace config effect (dracula theme + model preference from `./.dsh/config.yml` verified through truecolor SGR capture). Every real-turn scenario rides the wave-3 workingRoute discovery (probe `session/modelCatalog` + turns until a route answers, export via `DSH_OPENTUI_MODEL`); when no route answers the non-turn assertions still run and the turn parts are marked BLOCKED loudly instead of hacked. Typing is one char per tmux `send-keys` (~60ms gap, burst writes drop keys); the script skips (exit 0) on CI-unfriendly environments (no global dsh/tmux/bun/profile). The scenario-d listener probe is LISTEN-only (`lsof -sTCP:LISTEN`): unfiltered `-ti tcp:N` also lists the client's ESTABLISHED sockets, which produced a false oldfox-P1#2 reproduction in the first gate run. Gate evidence at flip time: 7 pass / 0 blocked, zero oldfox-P1 reproductions. The known-P1 watch list it enforces doubles as the oldfox review summary (see Fixed below).

- **Launcher default flipped to client mode; `--plugin` is the transitional escape hatch.** Root `./dsh-opentui` now execs the bun thin client (`src/client-entry.tsx` with the solid-js preload) by DEFAULT — per ADR-0005, gated on exactly this P6 E2E gate passing 7/7 including the scenario-d single-paint + managed-host acceptance. `--plugin` keeps the OLD in-process plugin-mode boot (`dsh --profile dsh-opentui` + `NODE_OPTIONS=--experimental-ffi`) as a documented transitional escape hatch; `--client` is accepted as a no-op alias. Plugin path re-verified post-flip: boots in tmux, status bar renders (`dsh(native) · zai-coding-cn · glm-5.3-flash · 🧠 · ⎇ main`), clean quit.

- **Transport lazy-import (self-contained test graph).** `src/client/transport.ts` no longer imports `@deepseek-ai/dsh-client-connection` at module top level — the SDK is loaded lazily inside connect, so the unit-test graph (and CI) runs without the global dsh closure installed; CI stubs the closure packages anyway.

### Changed

- **View-layer v2 migration closure (batch 10e): the migration is functionally VALIDATED on the default path — the batch-10d reactive-prop law lands in the examples, and the final tear/steer/slash verdicts are all green.** (1) Same-family example fix: `examples/session.tsx` (the batch-5-8 fake-seam page) hung on "Typing… Ns" with the same disease the 10d fix removed from the v2 entry — bun's JSX emits eager prop objects, so the eager `busy()` / `segments()` / `now()` reads in the StatusBar/PowerlineFooter props were tracked by the root render effect and every 1s clock tick rebuilt the whole subtree, disposing the composer owning the in-flight turn (its `busy=false` dropped by its disposed guard). The two siblings now compose through `@opentui/solid`'s `createComponent` with getter props exactly like the v2 entry (`as never` bridges the vendored JSX child-slot Element/BaseRenderable gap); `examples/hello.tsx`'s `For` gets the same getter treatment for its `each={rows()}` read (the smoke still passes), and `examples/transcript.tsx` scans clean (single static prop). Guard tests extended in `test/v2-entry-reactive-props.test.ts` (+3 source-shape pins, red pattern = the eager reads). Live (tmux): fake turn settles to an idle composer (zero Typing/Writing matches post-settle), the busy indicator renders during the turn, and the full overlay flow (approval card → enter, two sequential ask pickers → answers) settles with all rows intact. (2) FULL tear verdict on the DEFAULT path (tmux 120x34, client on the tui-base view, real 60-sentence weather repro): the turn settles at ~150s; the durable journal carries 60/60 numbered sentence starts with zero gaps/merges (capture `/tmp/b10e-tear-full.txt`: settled tail pane + journal rows 1-23 + parity), the visible tail paints intact (sentences through 60, tool rows, the city note), and the bottom region is intact during (steer-mode composer line + rotating status verbs) and after (idle placeholder + powerline). Limitation documented: the transcript scrollbox is not focusable on the default path (PageUp/wheel reach it under no keybind), so rows 1-23 parity is read from the durable journal — the sanctioned fallback — not from an in-app scroll. (3) Slash/steer smoke on the default path: `/model` picker opens over the transcript and esc closes it clean; `/new` rotates the session (journal bucket `341560f9…` → `31c23440…`, "new session (unnamed)" row, view cleared); a mid-turn steer is accepted in steer mode and the settled reply incorporates the requested closing paragraph. Gates: `bun test` ×3 — shell 309 pass/3 skip/0 fail, tui-base 88/0 (85+3 new), kit 22/0, runtime 5/0; `tsc --noEmit` ×3 — shell 0, kit 0, tui-base 58=58 budget; `bun build-host.ts` → dist-host diff empty. CI on batch 10d (`42104352590`): PASS both legs. Remaining fill list (not blockers, carried): plugin mode stays frozen on published 0.4.3 pending the upstream 0.8.1-on-node frame-flush fix (`docs/upstream-opentui-paint-bug-draft.md` stays in-repo unposted); the transcript in-app scroll affordance (focus/scroll keybinds for the scrollbox) is the one view gap surfaced by this closure; the v2 plugin entry + adapter remain in-tree unused pending the same upstream fix.
- **View-layer v2 migration status (batch 10c): the tui-base (0.8.1) view is the DEFAULT client render; plugin mode is FROZEN on the published 0.4.3 stack.** The client entry (`packages/shell/src/client-entry.tsx`) mounts the rebuilt view unconditionally — the batch-9a `--v2` gate is gone (`--v2` accepted as a no-op alias, root launcher updated) and the old ShellHost client boot branch is removed: client mode never mounts the old stack again. `bootClient` survives as the tested boot seam with the old-stack modules (kit i18n / runtime / ShellHost) moved to LAZY imports inside its default-render closure — a static import would drag the 0.7.0 graph beside the 0.8.1 renderer context in every process importing the entry (the batch-9a resolution law: the v2 entry file lives under tui-base and loads through a computed runtime import, opaque to shell's tsc program). `build-host.ts` REVERTS batch 10a's entrypoint swap: the plugin dist-host builds the OLD `host-entry.tsx` again (0.7.0 @opentui pins, solid-js 1.9.12 manifest) — the plugin stack is frozen on the published 0.4.3 shape until upstream fixes the 0.8.1-on-node frame flush (the 0.7.0 NODE backend flushed frames, 0.8.1/0.8.2 never do — discriminator: same tree bun 148KB vs node 5KB); the v2 plugin entry (`src/host-entry-v2.tsx` + `host-session-seam-adapter.ts`) stays in the tree unused, documented as the upstream-blocked cutover candidate. The dsh-opentui profile was restored to the published `@aiwayds/dsh-opentui@0.4.3` (the batch-10a dist-host symlink removed; pnpm reinstalls the package with its OWN dist-host on the frozen @opentui 0.7.0 / solid-js 1.9.12 closure) — live-verified in tmux: `./dsh-opentui --plugin` boots the OLD UI, status bar renders, a real turn completes and replies, quit clean. Gates: shell 309/0 (tsc 0), tui-base 83/0 (tsc budget 58 = 58), kit 22/0 (tsc 0), runtime 5/0. KNOWN OPEN ITEM on the new default path (first live validation since batch 9b): the view boots (composer/powerline/status overlays live, route from first paint) and turns reach the host — the host generates and settles the turn (session journal turn 1, 45 output tokens) — but the client view never receives the settlement: `Writing…` never resolves, the composer locks, esc/abort is dead, and transcript rows never paint. A discriminator run of the UNTOUCHED batch-9a `--v2` entry shows the identical symptom, so this is NOT the 10c rewiring — prime suspect is the batch-9b remote-host-session turn-settle/onJournalRecord path, first exercised on the v2 view here; next batch's first item. The 60-sentence tear repro is UNCONCLUDED on the default path for the same reason (rows must paint before tearing can be judged; batch 9a remains the last CLEAN tear measurement). Upstream paint-bug draft docs stay in-repo unposted (`docs/upstream-opentui-paint-bug-draft.md`).
- **Rides the dsh 0.2.2-rc.1 dev closure.** The `@deepseek-ai/dsh-llm` devDependency re-pins `0.2.1-rc.5` → `0.2.2-rc.1` (no peerDependencies are declared in this workspace, so no floors involved; the `@deepseek-ai/cordis` exact pins ride the closure `4.0.5` → `4.1.0` in `packages/runtime`, `packages/shell` and `starter` — the rc.1 closure members peer-demand `~4.1.0`, so the pins match the tree typecheck/tests actually run against and the pnpm peer warning is gone). The boot-smoke tarball-name parser is hardened: `npm pack --json` output is now sliced from the first `[` before `JSON.parse`, because current npm prints the `prepack` lifecycle output (pack-meta's copy line) to stdout ahead of the JSON array — the old whole-string parse threw, fell back to the bare closing-`]` line, and failed the smoke outright. No CI change: this repo's CI has no host-closure install step (devDeps only + a connection stub).
- **LastPromptLine becomes session-persistent (tui-pi echo semantics, user decision "session常驻").** The ` ● ` last-request echo below the input no longer clears at turn end (the turn-finally `setLastPrompt("")` is gone) — it now persists across turns for the rest of the session, and the echo resets only when the SESSION itself changes, at 5 clear points: `/new`, fork (`resetDock`), and the three `/resume` selection paths. This supersedes the bottom-stack entry's "cleared at turn end" tightening — the echo is back to tui-pi's persistent shape, scoped to the session. Slash commands still never set it. Verified by `scripts/ft-last-prompt.tsx`, a new standalone functional harness (9/9: one turn per send, echo shows mid-turn, persists past turns 1 and 2, follows the newest prompt, `/new` clears it, slash-only turns leave no echo) — it runs the real ShellHost under solid-js, which `bun test` cannot (the JSX preload is not applied in test runs; pre-existing limitation, hence the script harness instead of a test file).

- **Bottom-stack dock layout (user spec).** The fixed stack around the input box reorders: the TodosWidget moves directly ABOVE the input (it renders zero rows when the list is empty, so it only occupies space while the current session has todos), and BELOW the input the order is now the NEW ` ● ` LastPromptLine → SubagentWidget. LastPromptLine is the latest submitted MODEL prompt as one dim, non-wrapping, truncated echo row (tui-pi's activityDoc shape): slash commands never set it, a multi-line prompt echoes its first line, steering updates it too, and it is visible only WHILE the turn runs — cleared at turn end, a deliberate tightening of tui-pi's persistent echo, per the user spec. `/new` now also resets the dock state (dock reset + todos + subagents clear — the same reset the fork path runs), so a fresh session never inherits the old session's panels.

- **Powerline tool segment ⚒ → 🛠.** kit gains `toolSegment(n)` — the tui-pi footer's tool-counter shape (`🛠 N` on the tools fill, `null` below 1 so callers omit the segment) — and ShellHost's powerline footer plus the `/session` info line switch to it; `e2e-live.mjs` asserts the 🛠 counter (19/19).

- **OpenTUI diff-paint replay guard (rowEqual ref-reuse).** Transcript replay paths (`/resume` replay, fork rebuild, re-attach wake) now reuse the previous item object when the incoming row is structurally equal at the same index instead of always allocating fresh ones: OpenTUI's diff-paint can drop an interior row when a whole sibling group unmounts and remounts in one flush (the same reconciler class the bumpSoon ref-replacement works around), and a replay that changes nothing must not remount the transcript.

### Removed

- **Old view stack deleted (batch C2, ADR-0006 cutover delete).** Both modes already run the v2 (tui-base) view: client mode through `client-entry.tsx` → `bootClientV2`, plugin mode through the `host-entry-v2.tsx` dist-host. Rollback is the PUBLISHED 0.4.3 tarball, not repo files. Removed: the whole `packages/kit` package (old components, 22 tests); `packages/shell/src/ShellHost.tsx`, `Shell.tsx`, `main.tsx` (direct mode), `host-entry.tsx` (old plugin entry); the ShellHost-only features `login.tsx`, `model-select.tsx`, `theme-select.tsx`, `dock.tsx`, `history-fork.tsx`; `test/login-paste.test.ts` (4 tests) and `test/last-prompt-persist.test-helpers.ts`; the ShellHost FT scripts `scripts/ft-last-prompt.tsx`, `ft-logout.tsx`, `ft-paste.tsx`; the direct-mode `try.sh` and `packages/shell/build.ts` (standalone binary from `main.tsx`), plus the `dev`/`build:bin` shell scripts and the root `shell` script. Import fixes: the three kit types the surviving client graph still used (`TranscriptItem`, `AskEntry`, `StoredTranscriptRow`) move verbatim to `src/client/seam-types.ts`. `client-entry.tsx`'s `bootClient` drops its lazy ShellHost default render and now requires an injected `render` seam (production boots `bootClientV2`). `build-host.ts` loses the dead old-recipe branch and is v2-only. `pnpm-lock.yaml` drops the kit importer. Kept: `packages/runtime` (`host-entry-v2.tsx` imports `mountEngine`, `starter/` imports the package, `client-entry.tsx` imports its types) and `features/ask-transcript.ts` (used by `client/remote-session-ops.ts`). Gates ×3: shell 313 pass/3 skip/0 fail, tui-base 102/0, runtime 5/0; `tsc --noEmit`: shell 0, runtime 0, tui-base 58 (= budget). dist-host rebuild produces zero diff on tracked files. tmux boot of client and plugin mode both paint the v2 view. Post-cutover backlog (missing from the v2 palette): `/login`, `/logout`, `/btw`, subagent viewer, `/todo` panel, `/history` fork, `/search`, multi-theme, i18n.

### Fixed

- **Installer broke on 0.4.3-era profiles: duplicate `patchedDependencies:` blocks (pnpm ERR duplicate mapping key) and a stale direct `solid-js` dep winning the root hoist.** Both defects surfaced in the live profile migration (backups `pnpm-workspace.yaml.bak-1793930433-dupfix` / `package.json.bak-1793930690-stale-solid`). (1) `ensureSolidPatch`'s `stripStale` line-filter never stripped a well-formed other-version key (`solid-js@1.9.12: …` — the negative lookahead `\d+\.\d+\.\d+:` matches it, so the `!test` guard kept the line) and then APPENDED a second top-level `patchedDependencies:` block; pnpm rejects the yaml outright ("duplicate mapping key") and the profile would not install. It is now a YAML-aware merge of pnpm's flat string map (`scripts/solid-js-pin.mjs`): every top-level block is parsed into its entries, any `solid-js@<≠current>` key is dropped, every other package's patch key is kept verbatim, and ONE merged block is written back at the first block's position — duplicate headers collapse, non-patch top-level keys are preserved byte-for-byte, a block the reader cannot parse is left untouched rather than half-rewritten, and a re-run is byte-idempotent. (2) The installer's dependency-unfold kept a 0.4.3-era `"solid-js": "1.9.12"` direct dep from the profile's package.json, which hoisted 1.9.12 (SSR build) over the patchedDependencies fix until hand-removed; `pinSolidJsDependency` (same module, wired into `scripts/install-profile.mjs`) now replaces any existing solid-js spec ≠ 1.9.17 in the unfold — an absent dep stays absent, the patch key alone owns the pin. Tests: `test/solid-js-pin.test.ts` (9 — fresh workspace, stale-key merge, unrelated patch key preserved, the exact live duplicate-block backup shape collapsed + idempotence, append-when-missing, dep replace/absent/kept, installer wiring source guard). Scratch round-trip from the live pre-state (published 0.4.3 closure really hoisting solid-js@1.9.12 + the real 1.9.12 patch from git history + the exact duplicate-block workspace backup + the stale direct dep): installer exits 0 with no ERR, one merged block, `"solid-js": "1.9.17"` in the profile, solid-js@1.9.17 client build hoisted, dsh-llm linked, real `dsh --profile` boot renders with zero hand fixes.

- **Login/logout panel boxes collapsed under a content-bearing transcript, and dock-adjacent cards clipped or grew unbounded (auto-height boxes in a flex column).** Root cause: once the `flexGrow` transcript holds rows, auto-height sibling boxes collapse inside the flex column — the `/login` entry, confirm and notice boxes overpainted onto a single mangled line (title/hint interleaved; the same kit-Select constraint, documented there). Every dock-adjacent card now pins explicit `width: "100%"` + a height computed from its rendered rows: login entry 7 / confirm 6 / notice 5 (border 2 + padding 2 + content rows, `login.tsx`); ShellHost stop-confirm 6, steer 5, subagent viewer 12 (was 10 — the last viewer rows clipped), the btw box sized to its content (5 + per-pair Q + up-to-4 A rows, last 2 pairs) instead of `maxHeight: 10`, and the queue box bounded to its LAST 6 messages with computed height instead of `maxHeight: 8` (unbounded growth clipped mid-list). Plus the empty-commit guard on the login entry stage: Enter on an empty buffer used to register a garbage route (writeRoute runs before the credential write) AND fire `credentials.set` with `""` — the host rejects it ("invalid payload for credentials.set") and the panel closed, so a re-sent Enter (dropped-keypress retry) destroyed the open stage with no user input; an empty buffer is now a swallowed no-op, esc stays the cancel path. Regression-covered by `scripts/ft-paste.tsx` §5 (three Enters keep the stage open, zero login calls, esc still cancels) and the e2e-sweep login/logout/stop sections against the live panel. `dist-host/index.js` rebuilt from source.

- **Consumed modal keys typed into the blurred editor (engine-focus ghost double delivery), and history recall left the palette owning the arrows.** Four related ghosts in `ShellHost.tsx`: (1) every modal key handler (stop-confirm, approval card, subagent viewer + steer entry, login panel stages, dock toggles, picker hotkeys, scroll keys) now `preventDefault()`s the keys it consumes — a consumed key was ALSO delivered to the editor holding the ghost engine focus, so the login confirm "y" typed itself into the input line and the next submit rode the residue (`/model` went out as the prompt "y/model"); (2) login panel close reclaims the focus imperatively via a `createEffect(on(panelOpen))` flip of the focus key (the same teardown guard the overlay paths run — the panel's menu Select holds the engine focus while mounted and its unmount can leave it on the blurred editor; the focused-prop flip alone does not reclaim the singleton); (3) history recall closes the slash palette — recalling a `/`-entry re-arms it, and up/down then moved the menu highlight instead of walking history; (4) the textarea's own `onContentChange` echo of programmatic writes (history recall, setValue) no longer re-opens the palette the recall just closed (echo skipped when the value equals the current signal — a typed edit never matches). `dist-host/index.js` rebuilt from the source (added `preventDefault` lines match the source diff 17 = 17). Verified: `bun run typecheck` (`tsc --noEmit`) exit 0 in `packages/shell`; the sweep harness (Added above) is the live regression gate for the leak scenarios. UI fixes unrelated to the 0.2.2-rc.1 closure ride — landed after it as their own commits.

- **`/model` kept showing a provider's models after `/logout` (client-mode catalog staleness).** Root cause: the client's `RemoteModelClient.modelCatalog` cache was never invalidated — the logout WIRE contract was always correct (route removed from `llm-pi-ai` + credential unset), but the host recomputes `session/modelCatalog` per call and the logged-out provider survived only in this client-side cache, so the picker kept listing its models until restart. The cache is now dropped on every route-affecting path: the local commits (`login`/`logout` credential halves and every settings seam write — `settingsSeam.mutate`, `settingsMutate`/`settingsUpdate`/`settingsReplace`) via a new `RemoteModelClient.invalidate()`, and the `settings/document-updated` + `credentials/reference-updated` pushes in `#onEmitEvent`, which also covers mutations from another surface (web Models page, second client). Bonus: a newly subscribed provider appears in `/model` immediately after `/login` (the stale-absence direction of the same bug). Tests: +2 in `test/remote-model-settings.test.ts` (the logout-inverse mutate frame; the full invalidation matrix — cache parity, logout/login invalidation, both pushes, all four local settings writes — with per-step `session/modelCatalog` call counts) and a new `scripts/ft-logout.tsx` functional harness (12/12 live through the real ShellHost: pre-logout picker frame, menu/confirm wording, the exact two-call commit contract, post-logout picker with the provider gone). Not fixed here (reported): in PLUGIN mode the staleness lives in the host-session's own provider cache (`host-session.ts` — off-limits for this fix's scope); client-mode is the affected and fixed surface.

- **Paste was dead in every custom key-capture input (`/login` key field, custom-provider flow, steer line).** Root cause: OpenTUI enables bracketed-paste mode (2004), so Ghostty/tmux Cmd+V delivers the burst as a `paste` EVENT with the `ESC[200~…201~` wrappers already stripped — the event never reaches keypress-level handlers, and the custom text-capture surfaces (which only listened to `useKeyboard`) silently dropped it. Fix routes paste explicitly via `usePaste` in ShellHost: login entry fields consume it through a new `loginFeature.handlePaste` (shared `printableRun` filter with the key path, which itself now also accepts multi-char unwrapped bursts); the steer line appends the printable-run of the paste; modal surfaces without a text field (menus, confirms, viewer-without-steer) swallow it so nothing lands in a blurred editor; the native transcript editor is untouched — it already handled paste natively, and so did the main input, which is why only the custom surfaces were broken. Tests: `test/login-paste.test.ts` (+4) and `scripts/ft-paste.tsx` (11/11 live: 40-char token pastes into the masked key field without ever echoing in clear, both paste modes, esc aborts clean, custom-flow baseUrl stage accepts paste). Copy finding (documented, not changed): OpenTUI enables mouse reporting by default, so terminal click-drag selection needs Shift+drag; a one-line `useMouse` flip would disable reporting if that ever becomes unwanted.

- **Client-mode `/login` crash (Proxy wrapper accessors).** The `aggregateTurnContext` Proxy wrapper computed accessors on the proxy receiver (`Reflect.get(target, prop, receiver)`), so private-field getters threw `Cannot access private method or accessor` the moment they touched a `#field` — `/login` crashed reading `settingsSeam` → `#settingsClient` (features/login.tsx). The `get` trap now resolves every property on the real target (`Reflect.get(target, prop, target)`) with functions still bound to it, so getters and methods uniformly run with the real target as `this`. Regression test drives the real instance through the real wrapper (`settingsSeam` shape + pass-through members) in `test/client-entry.test.ts`. Live evidence: `/login` provider directory renders, esc exits clean.

- **oldfox review P1×4** (client-mode review watch list, enshrined as the e2e gate's P1 watches). (1) Re-attach seq-baseline dedup: `RemoteFollowSession.attach` takes the last durable seq painted before the gap (`sinceSeq`) and skips every snapshot record at/below it whole — no re-journal, no re-fold, no re-announce — so reconnect/restart replays never double-paint transcript rows; a belt-and-braces `#announcedToolCalls` set stops duplicate `onToolStart` even for above-baseline replays (scenario d: `"❯ say ok"` rows=1, `"turns 0"` rows=1 after a live `/reload`). (2) `/reload` lockfile rewrite: `restartSamePortHost` re-writes the single-instance lockfile (lifecycle `writeLock` shape, atomic tmp+rename) with the NEW pid + same port after the respawn — the restarted host stays MANAGED, so the next `ensureHost` adopts it instead of double-booting on the port and the idle reaper holds the right pid (scenario d: lockfile pid = live listener pid). (3) Concurrent cold-boot mutual exclusion: the booter claims the lockfile as an atomic `booting` placeholder (pid = booter, port 0, create-if-absent via `link(2)`); a rival waits out the foreign claim (join on completion, takeover when the booter dies or the join budget lapses — foreign pid never signaled) and a superseded booter kills its own child (`HostBootSupersededError`) instead of clobbering the winner's lock — two simultaneously launched TUIs can no longer spawn dual hosts. (4) Events-source close-guard: closing a still-CONNECTING mux socket emits `'error'` asynchronously AFTER the pump listeners are removed; a noop handler stays attached so it can never surface as an uncaught exception (same fix pattern as remote-stream.ts).

- **oldfox review P2×2.** (1) Reaper adoption liveness bump: `adoptHost` touches the lockfile (fresh `startedAt`/mtime) and the detached idle reaper spares a lock touched within the last 30s even without an ESTABLISHED connection — a client that adopted at the grace edge can still be inside its ~15s cookie-mint budget when the reaper fires. (2) Re-attach budget aligned to the restart budget: `REATTACH_MAX_ATTEMPTS` 10 → 30 (30×1s ≈ the `/reload` readiness budget of 30s) — the re-attach no longer gives up (erroring the awaited turn) ~20s before the restarted host can even listen again; cadence and cap are injectable for tests.

- **Seam: `/reload` never acts on a `booting` placeholder.** With cold-boot mutual exclusion in place (P1#3), the lifecycle lockfile can transiently be a booting claim naming the BOOTER's pid with port 0; `restartSamePortHost` now parses `booting` and refuses with a typed `HostRestartError` (`code: "host-booting"`) instead of SIGTERMing the booting client, and its stale-lock clear step never deletes a rival's placeholder. Tested in `test/remote-btw-restart.test.ts` (booter pid stays alive, placeholder untouched).

- **panel-kit List: the cursor can no longer leave the painted page window.** With `pageSize` set, up/down moved only `activeId` and never the page index, so the active row left the visible window while Enter still opened the invisible row (review P0-3 / P1-2). The window now follows the cursor: when `activeId` moves outside the current page — up/down, Home/End, a controlled `activeId` change, or a filter reshuffle — the page index and the `first-last/total` indicator move to that row's page. PgUp/PgDn still page, and after the jump the cursor is clamped into the new page (first row forward, last row back) so a page is never painted without a visible active row. Empty lists, single rows, exactly-one-page lists and an `activeId` filtered out by the query stay safe (no page past the data, no throw); keys are still consumed only while the list exceeds one page. Contract updated in `contracts.ts`, pinned by `test/list-cursor-page.test.tsx` (15 tests). No scroll container, no render-structure change, no new dependencies.

- **One `@opentui` engine copy per process.** The workspace declared three different `@opentui/core` versions (shell 0.8.2, tui-base/panel-kit 0.8.1, runtime 0.7.0) and two `solid-js` versions (1.9.17 and 1.9.12), so one process could load three engine runtimes and two reactive runtimes — shared registries and reactive roots then split silently. Every package is now pinned to `@opentui/core|solid` 0.8.1 (shell's `keymap` too) with `solid-js` 1.9.17, and `import.meta.resolve("@opentui/core")` from all four packages lands on the same `.pnpm/@opentui+core@0.8.1...` path. 0.8.2 was not used because tui-base's `skin code-block forms > streaming increments keep the wrapper stable` fails on it.

## [0.5.0] - 2026-11-04

### Added

- **Client-mode foundations (ADR-0005 P1/P5).** The TUI-as-thin-client path gets its four base layers. `src/client/cookie-mint.ts` mints the Host API cookie from the persisted `client-connection/browser-session` grant in `$DSH_HOME/.credentials.yaml`, reproducing the Host's own recipe byte-for-byte (BrowserAuth/dsh-credentials: cookie name `dsh-auth-` + base64url(sha256(authority)); value `v1.<body>.<base64url(HMAC-SHA256(secret, body))>`), fail-closed on non-owner-only credentials and with no secret/cookie material in any thrown error. `src/client/mux-frame.ts` + `events-source.ts` + `transport.ts` give a `ClientConnection` carrier over one authenticated `/api/remote.mux` WebSocket (`ws`, cookie on the upgrade — the global WebSocket cannot send headers): unary RPC via `POST /api`, and the `$events` mux pump behind `dsh-client-connection`'s `ConnectionGenerationSource` — the pump is deliberately chosen over the gateway-native `ClientRemoteEvents` client because waterfall frames must reach the consumer's `onEvent` (v1 answers them in-process), while the gateway source intercepts waterfall frames and auto-answers them itself with a stub typert service. `src/client/lifecycle.ts` is the host lifecycle manager `ensureHost`: first-TUI spawn, single-instance lock with stale-lock takeover, refcounted attach/detach, idle exit after `idleExitSec` (default 60s, `0` = resident), respawn crash cap. `scripts/provision-opentui-profile.mjs` idempotently bootstraps the fixed `opentui` host profile via `dsh opentui --from-default-profile web --dump-config` (compose-and-exit, no boot; touches only that one profile). 64 green tests in `packages/shell`; design background in `docs/adr/0005-client-mode.md` and `docs/client-mode-protocol-audit.md`.

- **Client-mode session core + workspace config overlay (ADR-0005 P2 wave 1 / P4).** `src/client/remote-host-session.ts` is `RemoteHostSession` — the HostSession-shaped session facade the rendering layer consumes, driven over P1's `ClientConnection` (unary Remote RPC + raw `$events` pump). Wave-1 audit rows: turn lifecycle (`session/create` + `session/prompt`, `mode:'queue'` for fresh sends and `mode:'steer'` mirroring `agent.steer`; the message queue stays client-side), `session/follow({assistantStream:true})` consumption (`remote-follow.ts`: text/thinking deltas, usage, tool call/result frames with image-path extraction parity, durable turn/end + error mapping, `todo/write`), `session/cancel` abort, and generation re-attach — the follow stream re-opens on reconnect, the opening snapshot replays missed transcript rows through `onReattachedMissed` and an active turn's compact stream replays as deltas under a "reconnecting…" label. Waterfalls (`remote-waterfall.ts`): forwarded `$events` `approval/request` + `user-questions/request` frames are claimed by `frame.agentId === sessionId` and answered through the unary `$events/result` RPC with the host verdict payloads — `"allowed-once"` / `"rejected"` (+ `"unavailable"` fail-closed with no callbacks) for approvals, `{answers:[{id, selected[], custom?}]}` (declined envelope on UI throw) for questions — the waterfall route rather than `userQuestions/answer` + `attachWait`, since the TUI modal has no detach window and the waterfall is the exact-parity answerer chain the in-process TUI joins today. `src/client/workspace-config.ts` is the workspace-local config overlay (bucket d, decision 4): `./.dsh/config.yml` holds only theme + model preferences, precedence environment (`DSH_OPENTUI_THEME` / `DSH_OPENTUI_MODEL`) > workspace > global base, model subfields merge partially, unknown keys ignored on load and preserved verbatim on save, credential-shaped keys rejected on load AND save (denylist, fail closed), 0600/0700 atomic same-dir rename writes, and a strict no-dependency YAML subset that refuses to rewrite a file it cannot fully parse. `remote-host-session` plugs into the same `TurnCallbacks` seam as the in-process `HostSession`, so the UI swap is zero-change. Rest of the audit surface (rows 12–28, 30–33, 35–37) ships as HostSession-shaped wave-2/3 stubs. 116 green tests in `packages/shell` (116 pass / 1 env-gated live smoke skip); contract background in `docs/adr/0005-client-mode.md` and `docs/client-mode-protocol-audit.md`.

- **Model route provisioning for the `opentui` profile.** The shipped web template mounts no provider route, so a freshly provisioned `opentui` profile could not complete a real model turn. `scripts/provision-opentui-profile.mjs` now writes/merges the route into the profile's `cordis.patch.yml` after (re)creation: `--provider` / `--model` / `--reasoning-effort` flags (defaults `zai-coding-cn` / `glm-5.3-flash` / `high`, matching `scripts/install-profile.mjs`), same patch-body shape (an `llm-pi-ai` provider entry whose `apiKeyEnv` is derived the dsh way — uppercased, non-alnum → underscore, `+_API_KEY` — plus an `agent-default-model` row). Merge is per-entry idempotent following the installer's convention: an entry already present in the patch layer is left untouched (a re-run never duplicates and never downgrades a model the user edited), missing entries are appended after a backup (`*.bak-<ts>`) so template/user entries survive, and an entry-less document (the template's bare `[]`) is replaced instead of appended to — appending after the `[]` document terminator yields an invalid two-document YAML stream the host rejects at boot. The hard guard stands: only the one `opentui` profile is ever touched. The env-gated remote live smoke gained a `DSH_SMOKE_PROFILE` knob (default `web`); against the provisioned `opentui` profile it now completes a REAL assistant turn (`MODEL_CALL ok`, text `"ok"`, `turnEnd prompt=13734 completion=19` in ~4s) instead of settling on the provider auth error — the provider key needs no environment plumbing: the host resolves `ZAI_CODING_CN_API_KEY` through its credentials service (`$DSH_HOME/.credentials.yaml` refs), shared by every profile.

- **Client-mode RemoteHostSession wave 2 — session ops + peripheral clusters (ADR-0005 bucket (b) P2 wave 2; audit rows 12–28 + 17 + 22).** `RemoteHostSession` grows from the wave-1 turn core to nearly the full HostSession surface via three new modules. `src/client/remote-session-ops.ts` is the session ops cluster: `listSessions` (`session/list` + the client-side retention filter of host-session.ts:208-240 parity — subagent rows out, retention-days cutoff by updatedAt, newest first, capped), `storedTranscript` (the `session/follow` opening snapshot replayed on a SECOND facade, with backwards `session/page` fills), `renameSession` (`session/rename`), `forkAtTurn` (`session/fork {atSeq?}` — omission = latest completed-turn prefix — plus facade switch onto the host-minted fork id), `searchSessions` (`session/search` → items {sessionId, snippet} + hasMore; OPT-IN on the wire and disabled on this deployment — the index is `openAt: never`, so the facade degrades to the exact HostSession `[]` parity), `listSkills`/`refreshSkills` (`skills/list`, the session-composed human-invocable catalog, non-activating), `listHostCommands`/`executeHostCommand` (`commands/list` / `commands/execute`, agent-scoped), and `RemoteTailSession` — the read-only foreign-id tail (row 17) riding a non-activating `session/follow` with `session/page` gap repair, plus the client-side turn grouping (`historyTurns`) from the follow record ledger. `src/client/remote-model.ts` is the model cluster: `modelCatalog` (`session/modelCatalog` — provider groups with models/reasoning efforts, failures, and `default`, which IS the row-22 cold-boot label source; the in-process `agentDefaultModel.currentSelection()` one-shot has no 1:1 remote), `selectModel` (`session/selectModel` round-trip — the host-resolved selection is durable per SESSION and applies to its NEXT request; the facade applies it to the live session when one exists, else stages it onto the session the next turn creates, unlike in-process `switchModel` which only affected the NEXT session), and the provider catalog (`llm/listConfigurableProviders` / `llm/listProviders`). `src/client/remote-settings.ts` is settings + credentials (rows 24–25): `settingsDescribe`/`settingsMutate`/`settingsUpdate`/`settingsReplace` — `settings/describe` returns the DOCUMENT view ({writable, hasDocument, namespaces[]}) on the wire and is shaped client-side to the flat rows the /login route-registration double-write and the /settings browser consume; `mutate`/`update`/`replace` take the revision seen at read time as `expectedRevision` (a stale editor is refused, not silently overwritten); credentials cross the wire value-free (`credentials/describe(refs)` → {configured, source?, writable}, writes via `credentials/set`/`unset`; the /login registration double-write stays client-side), exposed as `credentialStatus`/`login`/`logout`; presets round it out (`agentPresets/list|read|select`). Facade polish on the wave-1 core: the mid-turn compact-stream replay now dedupes at the dense index already streamed (clean replay after reconnect, no doubled deltas), a journal gap the snapshot window cannot reach is repaired from `session/page` before the live frames resume, a fuller `status` surface ({connection, turn: idle|starting|running|reconnecting, sessionAttached, tailActive}), and wire-verified usage assignment semantics (row 5): every usage chunk ASSIGNS the fields it reports, completion accumulates over the session, and the context size is prompt + cacheRead + cacheWrite on cache-splitting adapters (their `prompt` is uncached input only). `$events` push frames route to facade listeners: `settings/document-updated` (ns, revision), `commands/change`, `plugin-manager/changed` (auto-refreshes the plugins cache), `credentials/reference-updated`; `listPlugins`/`refreshPlugins` ride `pluginManager/listPlugins` (+`listBundles` versions, built-ins out). Idle-release (row 16) is HOST-NATIVE — the host owns the writer lock and the follow read needs none, so there is no client-side lease machinery. Tests: `test/remote-session-ops.test.ts` + `test/remote-model-settings.test.ts` over the shared `test/client-fakes.ts` fakes, plus the extended env-gated live smoke (wave-2 capability sweep: list/replay/rename/fork/search/model/presets/commands/skills/plugins/tail, 2/2 with real model calls); 152 green tests in `packages/shell` (2 env-gated live-smoke skips); contract background in `docs/adr/0005-client-mode.md` and `docs/client-mode-protocol-audit.md`.

- **Client-mode entry — `--client` boots the end-to-end bun TUI client (ADR-0005 P3, bucket (c)).** `src/client-entry.tsx` chains the boot behind injectable seams (`bootClient()`, faked in `test/client-entry.test.ts`): `ensureHost({profile:'opentui', idleExitSec:60})` → `ClientConnection({authority, cookieHeader})` → `RemoteHostSession` → `bootRuntime` render of ShellHost — with ZERO ShellHost edits: the remote session rides the HostSession type under the compile-time `ShellSessionSurface` conformance guard (`src/client/shell-session.ts`, fails tsc on surface drift instead of surfacing as a boot crash), and the turn-end hand-off is wrapped client-side (`aggregateTurnContext`) so the 🧠 status-bar context percent reads `prompt + cacheRead + cacheWrite` (the wave-2 row-5 wire finding) while the plugin bundle stays byte-identical (dist-host zero-diff gate). Workspace is the launch cwd (decision 1 — session/create cwd, welcome banner, powerline git probe, workspace overlay all key off it); theme comes from `configLoad().theme` read AFTER `session.start()` (overlay cache warm; `DSH_OPENTUI_THEME` still wins in ShellHost); the render waits (bounded) for the cold-boot model label so the powerline paints the real provider/model from first paint. Every exit path (`/quit`, Ctrl+C, renderer exit, SIGINT/SIGTERM/SIGHUP) funnels through `dispose()` → `host.release()` — never `host.dispose()` — and a LAST-REF release spawns the DETACHED idle reaper (`scripts/idle-reaper.mjs`): the lifecycle's idle timer is `unref()`ed and would die with the quitting client, orphaning the resident host forever; the reaper idles the host out after the grace window (SIGTERM→SIGKILL) and clears the lockfile, unless a fresh boot replaced the host or a client re-attached inside the window (established connections to the host port = the adoption liveness marker; behavioral tests in `test/idle-reaper.test.ts`). The jsx preload lesson: bun transpiles the whole import graph before executing, so a runtime-only transform registration is too late for kit's .tsx modules — the `@opentui/solid/preload` import stays FIRST in the entry AND the launcher passes `bun --preload …/preload.js` explicitly (bunfig.toml only applies from packages/shell's cwd, while the client launches from arbitrary workspaces). Launcher `./dsh-opentui --client`: the DEFAULT stays plugin mode until P6 (E2E topology gates) flips it. Evidence (tmux captures): boot shows the provisioned profile's real model label (`zai-coding-cn/glm-5.3-flash`), workspace prompt and themed welcome from the first paint; a real turn ("say ok" → "ok") lands with the aggregated `🧠 13.7k(11%)` context segment plus `⎇ main` / `💬 2` on the status bar. 205 pass / 3 env-gated live-smoke skips in `packages/shell` (kit 12, runtime 5); contract background in `docs/adr/0005-client-mode.md` and `docs/client-mode-protocol-audit.md`.

### Changed

- **License switched from MIT to Apache-2.0.** The repo ports component-level code from MIT-licensed projects (opencode, `@opentui/solid`); their original MIT statements are preserved in the root `NOTICE` file, which also ships inside the npm package. Previously published versions remain MIT-licensed as released.

- **Client-mode RemoteHostSession wave 3 — full parity, no degradations (stub promotion).** The audit rows the wave-1 facade shipped as HostSession-shaped stubs (30–33, 35–37) are now real implementations, and the facade's config seam is no longer a passthrough: `configLoad()` reports the merged view (profile config.json base ⊕ workspace config.yml ⊕ environment) instead of the bare profile file, and `configSave()` splits the patch — overlay-managed keys (`theme`, `model`) route into the workspace `./.dsh/config.yml` (frozen `saveWorkspaceConfig` API: atomic 0600, credential guard), plugin keys (`retentionDays`, favorites, …) persist into the profile config.json — HostSession persistence parity on the same files plugin mode used (single machine). The v1-full-parity consequence stands: every in-process HostSession consumer seam behaves identically over the wire, with the only degradations being the audit-documented ones (search opt-out, exec-mode default not wire-visible), each with its client-side parity answer.

- **Client-mode RemoteHostSession wave 3 — full parity, no degradations (ADR-0005 bucket (b) P2 wave 3; audit rows 29–30, 35–39, 41 + gaps 2/4).** Five new modules close the last audit rows; the clusters: `src/client/remote-local-fs.ts` gives /agents read/write + the /repair scan over `<dshHome>/agents/*.md` client-locally (single-machine topology, no Remote FS namespace), with ONE deliberate divergence from host-session.ts: the host copy's "insert into existing frontmatter" branch is dead (its regex never matches), so adding a field to a file that already had frontmatter prepended a SECOND frontmatter block — the client copy fixes the regex and documents the bug in its header. `src/client/remote-restart.ts` is /reload (audit row 29 + gap 2 — no remote live-plugin reload exists): per the ADR-0005 user decision the host restarts in place on the SAME authority — lifecycle lockfile (pid + port), SIGTERM with SIGKILL escalation, stale-lockfile removal, detached respawn `--no-open --port <same>`, a port-quiet gate (the old listener must actually release before the wait-for-listener probe), then cookie re-mint with the first-boot retry window; P1's carrier keeps retrying its authority forever and wave-2's re-attach replays the missed durable rows, so the restart is invisible beyond the reconnect label. The narrow SIGTERM→fresh-listener port-reuse race window is documented and accepted for v1; the full lifecycle-managed restart lives behind the `restartHost` override seam (P3 rendering-decouple path). `src/client/remote-btw.ts` is /btw: no one-shot throwaway-agent RPC exists on the wire, so the client mints a real throwaway session (durable marker title prefix, main session's context untouched) and REUSES the previous throwaway id for back-to-back questions — a one-session pollution cap instead of one session per question — with client-side filtering keeping throwaways out of session lists. `src/client/remote-subagents.ts` is the subagent panel aggregation: adoption of in-flight children, child follow, and steer/interrupt, with a typed `subagent/not-resumable` error surface (one-shot/non-continuable children refuse remote resume instead of failing opaquely). `src/client/remote-attachments.ts` is /attach + tool-result images (audit rows 35–36): the audit offered receipts OR inline image parts, and the receipt route is rejected on live-verified evidence — a `{type:'file', receiptId}` prompt part answers `session/attachment-invalid` (ATTACHMENT_NOT_REFERENCED) on read-back because `session/attachment` serves admitted IMAGE references only, and a staged receipt goes stale across /new/abort; the chosen route is the inline image part (`{type:'image', mediaType, data}` admitted by the host BEFORE message creation into the durable ImageAttachmentRef, extension allowlist + leaf display name parity), with admitted ids read from the follow journal for the round-trip surface; tool-result image bytes ride the authenticated `GET /api/file?path=…` (cookie-authed, 20 MiB cap → 413). Plus two seams: `src/client/remote-exec-mode.ts` (audit row 37) drives executionMode from the preset document — the deployment default is NOT wire-queryable (audit §4 candidate), and the plugin-inventory route carries no config; `src/client/remote-git.ts` (audit row 39 + gap 4) keeps the powerline git segment on its client-local `git branch --show-current` probe (ShellHost.tsx:277-295 semantics: workspace cwd, 3s timeout, silent "" on non-repos). Tests: `test/remote-wave3-local.test.ts` + `test/remote-btw-restart.test.ts` + `test/remote-subagents.test.ts` over the shared fakes, plus the wave-3 live-smoke sweep (agents/repair/attach/btw/reload/git on a scratch DSH_HOME — 3/3 previously run); 192 green tests in `packages/shell` (3 env-gated live-smoke skips); contract background in `docs/adr/0005-client-mode.md` and `docs/client-mode-protocol-audit.md`.

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
[0.5.0]: https://github.com/fan56/dsh-opentui/releases/tag/v0.5.0
