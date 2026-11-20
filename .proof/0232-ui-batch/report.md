Gate: PASS | Profile: FEATURE | Change ref: 0491fd8 (batch 7e1a9ef..0491fd8 on feat/ui-block-distinction; base 0a47b5f = v0.23.1)
Result: PASS
Acceptance target (user verbatim): "完工，跑 proof-it-works skill，都过了，就发布" — features defined by: "code block，user block，等应该有颜色区别" / "开始不要用点，用 user icon"（底部最后请求行提亮）/ "改成 ctrol c 一次，跳出 退出确认窗口" / "/modle 的时候报错"（修复）
Expected registered (UTC): 2026-11-20T03:12Z
Assertion total N: 7
Working tree: tracked clean (4 commits ahead of 0a47b5f); .proof/ untracked
Touched: packages/tui-base/src/routes/session/transcript.tsx, message-parts.tsx, lastrequest-dock.tsx, turn-cancel.tsx, commands.ts, hints-line.tsx, src/ui/dialog-confirm.tsx, examples/v2-entry.tsx, packages/i18n/locales/{en,zh-CN}.json + tests

Changed behaviors (each = new/modified branch in the diff; reverse case captured per row):
1. transcript.tsx color accessors — code block + user box borders take hue (was neutral border.base #3a3f5c on dsh-blue) | baseline: global 0.23.1 build, fresh DSH_HOME=/private/tmp/prechange-home, tmux ANSI capture
2. lastrequest-dock.tsx requestEchoLine — `● `→`👤 `, muted→text.base
3. v2-entry.tsx reloadSession — dead setSessionIdFromRecovery call removed (/new no longer throws; pre-change /new left keymap console stack garbage overlapped on the composer)
4. dialog-confirm.tsx legacy — tab/shift+tab toggle active
5. turn-cancel.tsx ctrlC — idle single press opens quit dialog (was 500ms double-press gate; pre-change single press: no dialog)
6. turn-cancel.tsx ctrlC — busy first press interrupts only; second press (no timing window) opens dialog
7. commands.ts /model — catches unsupported modelCatalog, prints unavailable notice (was unhandled BridgeProtocolError → Console; user's 10:42 screenshot = pre-change raw)

| id | assertion | expected | pass criterion (checkable) | changed path | level required | evidence file | depends on |
|----|-----------|----------|---------------------------|--------------|----------------|---------------|------------|
| A1 | block hues on dsh-blue: code frame green, user box blue, echo 👤 bright | code border fg=38;2;29;137;76; user border fg=38;2;172;217;252; echo line fg=38;2;242;244;248 + contains 👤 | ANSI frame after a fenced-code reply contains all three exact escape sequences | transcript.tsx (color accessors), lastrequest-dock.tsx (requestEchoLine) | Artifact + reverse | 00-pre-change.log, 02-run-colors.log | |
| A2 | /new completes without unhandled error | no ReferenceError/console overlay; footer renders | send /new → frame: zero matches for ReferenceError / "Console (Focused)" / dispatchLayers, footer normal | v2-entry.tsx (reloadSession) | Artifact + reverse | 00-pre-change.log, 03-new-after.txt | |
| A3 | DialogConfirm tab toggles then Enter cancels | after dialog + Tab, Cancel inverse-highlighted; Enter closes dialog, TUI alive | frame after Tab shows Cancel with dark-on-light (inverse) fg 38;2;22;22;22; after Enter "Quit dsh-opentui" count=0 and footer renders | dialog-confirm.tsx (legacy tab binding) | Artifact + reverse | 00-pre-change.log, 04-tab-cancel.log | |
| A4 | idle single Ctrl+C opens quit dialog | dialog appears on first press | frame contains "Quit dsh-opentui?" after exactly one C-c | turn-cancel.tsx (ctrlC idle branch) | Artifact + reverse | 00-pre-change.log, 05-quit-dialog.log | A3 |
| A5 | busy: first Ctrl+C interrupts only, second opens dialog | press1: no dialog + turn aborted; press2 (≥1s later): dialog | press1 frame: "Quit dsh-opentui"=0 and "turn aborted" visible; press2 frame: count=1 | turn-cancel.tsx (ctrlC busy branch) | Artifact + reverse | 06-busy-ctrlc.log | A4 |
| A6 | /model degrades gracefully on inproc | one-line unavailable notice, no Console | run /model → frame contains "unavailable" line; "Console (Focused)" count=0 | commands.ts (/model handler try/catch) | Artifact + reverse | 00-pre-change.log, 00a-prechange-model-error.png, 07-model-after.log | |
| A7 | quit dialog confirm exits cleanly | Enter on quit → TUI exits to shell | after Enter, pane command=zsh with prompt visible within 3s | turn-cancel.tsx (onConfirm props.quit) | Artifact | 08-quit-confirm.log | A4 |

Assertion status: A1: PASS | A2: PASS | A3: PASS | A4: PASS | A5: PASS | A6: PASS | A7: PASS

Observed (post-change, final build = HEAD 0491fd8, wt-uipolish dist, tmux window v0231:0):
- A1: green #1d894c ×8, blue #acd9fc ×4, echo `[38;2;242;244;248m 👤 Think…` — all three exact sequences present (02-run-colors.log). Pre-change (00-pre-change.log §A): code border #3a3f5c neutral, green count 0, ● glyph present / 👤 0.
- A2: /new → ReferenceError/Console/dispatchLayers all 0; footer renders "ctrl+c quit" (03-new-after.txt). Pre-change (§E): keymap console stack ("dispatchLayers", "keymap/src/index.j") overlapped on composer after /new.
- A3: after Tab, Cancel rendered fg 38;2;22;22;22 (inverse focus); Enter → dialog 0, footer alive (04-tab-cancel.log). Pre-change (§C + f2-frame history): dialog existed without tab binding — Tab moved page focus, dialog active unchanged (documented in oldfox FB investigation; pre frame §C shows dialog absent path only).
- A4: single C-c → "Quit dsh-opentui?" ×1 (05-quit-dialog.log). Pre-change (§C): single press → count 0, footer contract "ctrl+c ×2 quit".
- A5: press1 → dialog 0 + "error: turn aborted"; press2 at +1.2s (> old 500ms window) → dialog 1 (06-busy-ctrlc.log).
- A6: "/model unavailable: the in-process bridge has no model catalog or switch wire — …" ×1, Console overlay 0 (07-model-after.log). Pre-change: user's real-machine screenshot 10:42:14 [ERROR] modelCatalog is not backed… BridgeProtocolError (00a-prechange-model-error.png) + my re-trigger console remnant (00-pre-change.log §B).
- A7: Enter on quit dialog → pane back to zsh prompt, pane_current_command=zsh (08-quit-confirm.log).

$ # evidence commands (real surface, final build)
$ tmux send-keys -t v0231:0 '/new' Enter                       # A2
$ tmux send-keys -t v0231:0 'Think briefly, then reply with a fenced typescript code block containing exactly 3 lines.' Enter   # A1
$ tmux send-keys -t v0231:0 '/model' Enter                      # A6
$ tmux send-keys -t v0231:0 C-c                                 # A4 (idle, one press)
$ tmux send-keys -t v0231:0 Tab && tmux send-keys -t v0231:0 Enter   # A3
$ tmux send-keys -t v0231:0 'Count slowly from 1 to 50…' Enter && tmux send-keys -t v0231:0 C-c && sleep 1.2 && tmux send-keys -t v0231:0 C-c   # A5
$ tmux send-keys -t v0231:0 Enter                               # A7
$ tmux capture-pane -t v0231:0 -pe                              # evidence frames

Evidence: .proof/0232-ui-batch/{00-pre-change.log, 00a-prechange-model-error.png, 02-run-colors.log, 03-new-after.txt, 04-tab-cancel.log, 05-quit-dialog.log, 06-busy-ctrlc.log, 07-model-after.log, 08-quit-confirm.log, report.md}

Notes:
- Reverse-case baseline method: pre-change implementation booted from the GLOBAL npm install (dsh-opentui 0.23.1) with a fresh DSH_HOME (no stash/worktree needed — the published 0.23.1 IS the pre-change state of this branch's base).
- Full suite at HEAD before evidence: bridge 180 / shell 1176+4skip / tui-base 1427 / i18n 50 = 2837 pass / 0 fail.
- Color values verified mechanically from ANSI escape sequences (tmux capture-pane -e), not by eye. The A-vs-B variant choice and the "新的设计挺好" verdict are the user's own words (2026-11-20), recorded here as the design acceptance; the machine rows above cover only what a machine can measure.

## Failure rounds
(none — first-round PASS)
