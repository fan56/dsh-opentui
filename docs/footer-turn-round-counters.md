# Footer `💬 N turns · ↻ M rounds` — feasibility recon

Read-only recon against `wt-activity-merge` @ `7554236` (released 0.20.0 content).
Baseline (already verified, re-cited for context): `messageCount` = count of durable
transcript rows of kind `user`/`assistant`, computed in
`packages/shell/src/client/session-seam-adapter.ts:290-316` (count at `:301-302`),
passed as `messages: remoteInfo()?.messageCount` in
`packages/tui-base/examples/v2-entry.tsx:641`, rendered by
`packages/tui-base/src/routes/session/powerline.tsx:746-749` and assembled at
`:1066`.

## 1. TURN — is "number of user rows" a correct turn count?

### How a `user` row is created
- The count is taken over `storedTranscript(sessionId)` rows
  (`session-seam-adapter.ts:301-302`). Those rows are produced by
  `journalToTranscriptRows` (`packages/shell/src/client/remote-session-ops.ts:76-148`).
- A `user` row is emitted for a durable `user/message` journal event ONLY when
  `source.kind` is absent or `"user"` (`remote-session-ops.ts:90-94`; `sourceKind`
  helper at `:220-223`). Non-user source kinds are host injections (runtime
  context, tool-registry, system-prompt, loop guards, notices) and are skipped —
  documented at `session-seam-adapter.ts:808-813` and the notice set at `:801`.
- Text-less user records produce no row (`remote-session-ops.ts:93`: `if (text)`).
- One nominal turn = one `turn()` call = one `session/prompt` with `mode:"queue"`
  (historical HTTP session facade, now retired), which yields one such
  `user/message` event → one `user` row. So the mapping is 1:1 in the nominal path.
- `SeamSessionInfo.turnCount` is a DIFFERENT counter: `#turns`, incremented per
  client `turn()` call (historical HTTP session facade, now retired; exposed
  through its session info surface), documented as "User turns this facade drove since attach"
  (`packages/tui-base/src/seams/session.ts:268`). It is client-local, not durable,
  and does not include resumed history — it is NOT the footer's source today.

### Exceptions and whether they inflate the count
- **steer** — `session/prompt` with `mode:"steer"` carrying user content
  (`legacy HTTP session facade:705-719`). Whether the host journals that steer text as
  a `user/message` with `source.kind:"user"` is **UNKNOWN from this repo** (the
  host is an external binary; no `host-session.ts` source is present — see
  `find . -name host-session.ts` → empty). If it does, it inflates the `user`-row
  count; the client mapper would count it (`remote-session-ops.ts:90-94`). The
  The retired 024 container e2e `70-steer` (offlined 025-w3-2, ADR-0013) confirmed
  "round" is the host's LLM-trip unit; its in-service takeover record is
  `verify/steer-queue-repro.mjs:316` ("the steer receipt flips to delivered at
  turn end", takeover-table row 18 in `.proof/025-w3-2/01-legacy-retirement/`).
  Neither says anything durable about steer journaling.
- **queued message** — the prompt queue is client-side in ShellHost
  (`legacy HTTP session facade:9-12`); each queued send is another real `turn()` →
  another genuine user turn. Not an inflation (it is a real turn).
- **fork** — `forkSession` (`session-seam-adapter.ts:204-206`) creates a session
  from a seq prefix; the forked journal inherits that prefix's `user` rows, so the
  count is correct for the forked session, not inflated.
- **resume replay** — the adapter reads the staged id before bind
  (`session-seam-adapter.ts:292-298`); durable rows are not duplicated by replay,
  so the count stays correct.
- **compaction / host injections** — injected `user/message` records carry a
  non-user `source.kind` and are filtered out (`remote-session-ops.ts:91-92`;
  `session-seam-adapter.ts:808-813`), so they do **not** inflate the count.
- **failure mode** — a transcript read failure degrades the count to 0
  (`session-seam-adapter.ts:299-305`), not an inflation but a wrong 0.

**Verdict (1):** "user rows" is a good durable approximation of user turns,
but not provably exact: steer's journaling is UNKNOWN, and text-less user records
are skipped. It is strictly better than the client-local `turnCount`.

## 2. ROUND — is any per-session round counter available?

- **Host facade `sessionInfo()`** (`legacy HTTP session facade:920-949`) returns
  `sessionId, model, turnCount, tokensIn, tokensOut, cacheRead, cacheWrite,
  lastTurnTps, sessionAvgTps, contextTokens, contextWindow`. **No round field.**
- **Seam type `SeamSessionInfo`** (`packages/tui-base/src/seams/session.ts:262-290`):
  no round field either.
- **`@deepseek-ai` host API (types only)** — `MessageSourceMap` kinds are
  `user | model | tool | system-prompt`
  (`node_modules/.pnpm/@deepseek-ai+dsh-llm@0.2.2-rc.1_.../lib/types/message.d.ts:100-107`);
  assistant messages carry model attribution, no round index (`message.d.ts:145-149`).
  The host does emit a per-attempt `turn`+`step` on LIVE assistant stream start
  frames (`packages/shell/src/client/remote-follow.ts:123-129`), but the frame
  parser reads only `attemptId` and ignores `turn`/`step` (`:432-436`). Durable
  `turn/start` events carry a `turn` number (`remote-session-ops.ts:159-162`) and
  `tool/call` test data carries `turn`/`step`
  (`packages/shell/test/remote-host-session.test.ts:343`), but no assistant-row
  round metadata is consumed by the client.
- **Assistant rows carry no round/tool-loop metadata**: the mapper keeps only
  text (`remote-session-ops.ts:95-97`), and the seam event projection emits
  `message.part.updated` with text only (`session-seam-adapter.ts:826-835`).
- **stats/tps sources** — `lastTurnStats` (`legacy HTTP session facade:387`),
  `lastTurnTps`/`sessionAvgTps` (`:941-945`), `usageSummary()` prints `turns`
  only (`:951-965`). These are per-turn decode rates, not round counters.

**Verdict (2): NO per-session round counter is available now.** It is derivable
by counting `assistant/message` events (the codebase's own subagent convention:
`packages/shell/src/client/remote-subagents.ts:603-611`, asserted in
`packages/shell/test/remote-subagents.test.ts:243` "rounds stay
assistant/message-counted; a tool result is not a round"). An authoritative
cumulative per-session round counter requires NEW host plumbing (new RPC/payload
field), because the host's `step` is on live frames only and is unconsumed.

## 3. If rounds are unavailable — cheapest truthful proxy

- **Count assistant transcript rows** (reuse the `storedTranscript` read at
  `session-seam-adapter.ts:301-302`): cheapest — zero new I/O — but **not strictly
  truthful**, because text-less tool-only assistant rounds are dropped
  (`remote-session-ops.ts:96-97` keeps a row only `if (text)`). It undercounts.
- **Count `assistant/message` durable events** (via the journal hook
  `onJournalRecord` at `legacy HTTP session facade:642-647`, or a journal read through
  `sessionJournal` at `session-seam-adapter.ts:195-197`): **truthful** in this
  data model (one assembled message = one attempt/round; subagent precedent above)
  and needs only client-side plumbing, no host change. This is the recommendation.
- **Count tool rows** — **a lie**: rounds have 0..N tool calls
  (`remote-session-ops.ts:98-143`; subagent test explicitly excludes tool results
  from rounds, `remote-subagents.test.ts:243`).
- **Count `llm`/`model` events in the seam row stream** — **not available**:
  `projectJournalRecord` emits only `message.updated`, `message.part.updated`,
  `session.error` (`session-seam-adapter.ts:803-843`).
- **Expose a host counter** — truthful but most expensive (new wire contract).

## 4. LIVE UPDATE cadence

- The footer's authoritative refresh is the turn-end effect:
  `createEffect(() => { if (!turnBusy()) { refreshFooterData(); ... } })`
  (`v2-entry.tsx:624-632`); the `messageCount`/`tps` signal is set at
  `:594-613` (`:610`). So a `↻ rounds` sourced like `messageCount` updates
  **only at turn end**; a 7-round turn shows one final jump, not 7 ticks.
- Mid-turn hooks already consumed by the client:
  - `onContentDelta`/`onThinkingDelta` are wrapped to call
    `refreshFooterIfUnknown()` (`v2-entry.tsx:216-228`), but that probe is a
    one-shot gated on "count still unknown" (`:517-529`, `:533-535`) — it does NOT
    re-read once a count exists.
  - `onToolRun` increments the LOCAL `tools` signal mid-turn
    (`v2-entry.tsx:241-244`): the only live counter, but tool-based (not round-based).
  - `tps` is NOT mid-turn: it comes from `sessionInfo()` at turn boundaries
    (`v2-entry.tsx:473-474,484-486,610`).
  - Journal events are deliberately suppressed during a turn
    (`session-seam-adapter.ts:770-775`, `#turnInFlight`; explained at
    `v2-entry.tsx:203-215` and `docs/activity-merged-widget.md`), so
    `onSessionEvent` is dead exactly mid-turn.
- Per-round signals exist on the wire but are unconsumed: assistant stream
  `step` (`remote-follow.ts:123-129`, parsed at `:432-436`) and per-request `usage`
  chunks (`onUsage` at `legacy HTTP session facade:2490-2502`). Piggybacking either
  requires new client plumbing, and `step` is the only true per-round index.

**Verdict (4):** yes — a sessionInfo-sourced rounds number updates only at turn
end. The piggyback candidates are the `step` frame field and `onUsage`; neither is
currently wired to a footer signal.

## 5. i18n / width cost

- Keys: `footer.messages` at `packages/i18n/locales/en.json:614` and
  `packages/i18n/locales/zh-CN.json:601`. Add `footer.turns` and `footer.rounds`
  (or one combined key with `{turns}`/`{rounds}`) to BOTH files; both locales are
  the bundled baseline (`packages/i18n/test/registry.test.ts:88-91`) and the
  registry loads them in footer tests (`packages/tui-base/test/footer-refresh.test.ts:20`).
- Segment builders / assembly / priorities: `messagesSegment` priority 80 at
  `powerline.tsx:746-749`; `toolSegment` priority 50 at `:756-759`; `cacheSegment`
  40 at `:798-801`; `elapsedSegment` 30 at `:781-789`; fit/shed law at `:888-964`
  (lowest priority shed first, `:916-935`). New segments need an explicit priority
  or they shed first (priority 0 default, `:915`).
- Tests that will need updating:
  - `packages/tui-base/test/powerline.test.ts:155-165` (builder assertions),
    `:168-205` (footer assembly golden order at `:180-188`, empty at `:191-195`,
    presence gate at `:197-204`),
    `:697-785` (width fitting: 80 cols `:712-722`, **45-col contract** `:724-731`
    and long-preset variant `:733-757`, degradation chain `:759-772`, hard clip
    `:774-778`, right text `:780-784`). Adding segments changes strip width and
    which segments survive at 44 cols (today `🔧` is already shed, `:730`).
  - `packages/tui-base/test/footer-quickwins.test.ts:93-111` (wiring/golden wording)
    and its width/fold suite `:208-431` if the new segments share the fitting law.
  - `packages/tui-base/test/footer-refresh.test.ts` (refresh/probe wiring) and
    `packages/tui-base/test/footer-first-turn-ft.test.tsx` (first-delta paint).
- Width cost: each segment adds `stringWidth(text)+2` plus one arrow
  (`powerline.tsx:911-913`); brand + full context are protected at 45 cols
  (`:928-935`), so a turns/rounds segment must be assigned a priority that decides
  deliberately whether it sheds before or after `💬`/`🔧`.
