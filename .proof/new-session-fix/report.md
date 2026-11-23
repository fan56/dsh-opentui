# Proof Report: new-session-fix / `/new` 后下一条消息绑定新会话

- Gate / 门禁: PASS（按最终 HEAD `13411a7` 原始证据改判；改判前 FAIL。E9 门禁阶梯的「shell 全量 0 fail」在最终 HEAD 达成）
- Result / 结论: PASS（与 Gate 一致；改判前 FAIL。E1–E8 保持 PASS 并补最终 HEAD 具名证据，E9 FAIL→PASS）
- Profile(s): FEATURE + 真机 tmux 数值帧 + 反例基线
- Change ref: `f08fa9d`（唯一 commit，"fix(seam): /new closes the old session before opening the new one (ADR-0010 OPEN→CLOSING→OPENING)"）。
- Working tree: 本 agent 只新增本报告，并把未入库的 4 个 `.ans` 帧纳入本批；他人未提交改动未触碰。
- Expected registered (UTC): 2026-11-23T06:00Z（见 `00-preregistered-expected.md`，write-once）。
- Assertion total N: 9（E1–E9）
- Acceptance target（用户原话，本轮文档任务）: "内容必须**只依据盘上已有的一手证据**……没有证据的项如实标 NOT RUN / CLAIM"。切片目标（预注册原话）: "`/new` 后下一条消息必须成功绑定新会话；close-before-open（ADR-0010）"。

## 1. 切片目标与生效 commit

目标一句话：`/new` 时先 close 旧会话再 open 新会话（open 永不 `replace:true`），close 失败的各类错误码按规格分类恢复，保证下一条消息绑定新 id。

生效 commit：`f08fa9d`（HEAD），预注册 pre-change HEAD `36dc77a` 为基线锚点。无后续 commit 取代本切片做法。

## 2. Gate / Result 表

| id | 预注册 expected（摘要） | Result | 判定依据（原始输出行） | 证据文件 | 最终态归属 |
|----|------------------------|--------|------------------------|----------|-----------|
| E1 | attached `/new` → 下次 turn wire 为 `[session.close, session.open{mode:"new"}]`，无 `replace:true`，`/new` 与 turn 之间 close=0 | PASS | `04-seam-test.log:45`（"newSession clears the bound id; the next turn closes the old session then opens {mode:new}"，170 pass/0 fail） | `04-seam-test.log:45,171-173` | f08fa9d 最终态 |
| E2 | close 回 `SESSION_NOT_OPEN` → 仍发 open-new、绑定新 id、turn resolve | PASS | `04-seam-test.log:46`（用例 pass） | `04-seam-test.log:46` | 同上 |
| E3 | close 本地拒绝/状态未知（DEAD/RECOVERING/TIMEOUT/CLOSED/WRITE_FAILED）→ 拒绝不 open、保持 attached、id undefined；恢复后下次 turn 重试 `[close,open]` | PASS | `04-seam-test.log:47-51`（逐 code 用例 pass，含 F1 回归） | `04-seam-test.log:47-51` | 同上 |
| E4 | close 成功但 open-new 失败 → turn 拒绝、attached=false、下次 turn 自愈发裸 open（无 close） | PASS | `04-seam-test.log:52`（用例 pass） | `04-seam-test.log:52` | 同上 |
| E5 | resume 分支不变：attached 时 resume(B) → `{mode:"resume",id:B,replace:true}`、不发 close | PASS | `04-seam-test.log:53`（用例 pass） | `04-seam-test.log:53` | 同上 |
| E6 | bridge 守卫有测试：`{mode:"new",replace:true}` 有绑定时回 BAD_PARAMS、原绑定不受影响 | PASS | `05-bridge-guard-test.log:4-9`（1 pass / 0 fail / 10 expect） | `05-bridge-guard-test.log:4-9` | 同上 |
| E7 | 真机 a/b/c/d 帧 + journal 两条消息同属新 id | PASS | `06a:8-15`（A2/A3 输入 + `PONG_A`）、`06b`（`PONG_A`/`PONG_B`）、`06c`（`NSFIX-C`/`PONG_C`）、`06d`（`NSFIX-D-cold`/`PONG_D`）；`07-journal-check.log:10-18`（新 id `54ed8a9f…` 下 A2-after-new=12、A3=3、B2-second=2、PONG_A=3、PONG_B=3，同属一个 id） | `06a/06b/06c/06d-*.ans`,`07-journal-check.log` | 同上；见 §4 的 `error: turn aborted` 偏离 |
| E8 | 5 个「应保持绿」文件字节不变且全绿 | PASS | `08-keep-green.log:末尾`（205 pass / 0 fail，5 files）；`git show f08fa9d --stat` 只含 4 文件（prereg + bridge 新测试 + seam + seam test），无 keep-green 文件 | `08-keep-green.log`,`git show f08fa9d --stat` | 同上 |
| E9 | 门禁阶梯：seam 0 fail、bridge 0 fail、**shell 全量 0 fail**、typecheck:entry 成功 | PASS | 最终 HEAD（13411a7）四阶梯全部由原始输出覆盖：seam `final-2/04-pert-shell-bridge-session-seam.out` 170 pass / 0 fail；bridge `final-2/03-full-bridge.out` 381 pass / 0 fail；**shell `final-2/03-full-shell.out` 1356 pass / 5 skip / 0 fail**（改判前 fail 的 dock-hide 用例现为 `final-2/04-pert-shell-render-regression-ft.out:9` 具名 `(pass)`）；typecheck `final-2/04-typecheck-entry.out` exit 0（`00-summary-2.md:78`）。改判前依据的 `11-shell-full.log` / `11b-render-rerun.log` 1 fail 为 733e859 陈旧结果，根因见 `.proof/dock-frame-regression/00-preregistered-expected.md`（过时测试前提，13411a7 测试侧修复） | `.proof/final-gate/final-2/04-pert-shell-bridge-session-seam.out`, `03-full-bridge.out`, `03-full-shell.out`, `04-pert-shell-render-regression-ft.out:9`, `04-typecheck-entry.out`；`00-summary-2.md:78` | PASS：预注册 PASS 判定式「全量 0 fail + typecheck 成功」在最终 HEAD 达成 |

汇总（改判后）：PASS 9（E1–E9） / FAIL 0 / NOT RUN 0 / CLAIM 0。改判前：PASS 8（E1–E8） / FAIL 1（E9）。E1–E8 在最终 HEAD 由具名 pass 再次确认（E1/E6 见 `final-2/04-pert-bridge-session-open-replace-guard.out:4` 与 `04-pert-shell-bridge-session-seam.out:45-53`）；E9 因 shell 全量 0 fail 改判 PASS。

## 3. 原始输出指针（存在性 + sha256）

| 文件 | sha256 | 入库状态 |
|------|--------|----------|
| `00-pre-change.log` | `da1e92ad087505383c1a2dff155d23dc63f89557bc2e97a8d3e6d95adf8afc30` | gitignored，登记校验和 |
| `01-env-snapshot.log` | `c371d6983df9e090ca8a76d2db92c340b0ddfd558bb5b6a9c74a087547f51cd` | gitignored |
| `04-seam-test.log` | `dfb4612ce4a3f5e1614bc193d693dab92d61612384d55083975005641d112fce` | gitignored |
| `05-bridge-guard-test.log` | `5fd5845084e986e8c68a7a35d6d3a00abbb69e0d61e947b26c4d71f8eac13c41` | gitignored |
| `06a-new-then-message.ans` | `f66602861bccbe6bfa9a99036b2b127063e5ef2da09d959d024337853d28140c` | 本批 `git add`（8677 B，未入库） |
| `06b-second-message.ans` | `00bd705cc7aa430283367568b9de607221304bd1ebabd0419941ce0d841aef8f` | 本批 `git add`（9257 B，未入库） |
| `06c-fast-message.ans` | `3a1edef0775919910d1f1c8f5b2ecb3732e15091583d464a9d21acdce1f5ff69` | 本批 `git add`（8118 B，未入库） |
| `06d-cold-new.ans` | `392d24b3c94d277b98635c5a8369a1ad485fddd50433f202f1d46859f692ee78` | 本批 `git add`（8118 B，未入库） |
| `07-journal-check.log` | `eb7d6ab198a9214cf7272ed1944d4938cfe262aee0714268c853b3178f2f675f` | gitignored |
| `08-keep-green.log` | `49a76cd2e3697be3faa0671f5941482214e71513f385a46be35eb5866a4ec905` | gitignored |
| `09-typecheck-entry.log` | `fe595961cf87445bdca75dd240d1aa980aac8868bd679e4a8ff2636d63067167` | gitignored |
| `10-bridge-full.log` | `04687d50f72bda540f287c9c9c7769bebc0c4298a9ebd09ba8aacfe069a03eb5` | gitignored |
| `11-shell-full.log` | `47fa953b2a4651c592f4e0c90803b66ed21e6764c1ba5eba582f5c627e48c6c9` | gitignored |
| `11b-render-rerun.log` | `c9d3dd490cd5dc6305c8342c58e945aad04d7ee6ba9dd5152ef3b14e7a2a1a65` | gitignored |
| `00-preregistered-expected.md` | `d6ed34ac725d9e72f2801b0db905e7f3bb1c9fc626ec588f246edd210a661f74` | 已入库预注册 |

## 4. 已知偏离与诚实声明

- **E9 失败项——已在最终 HEAD 消解**：shell 全量 `11-shell-full.log` 与复跑 `11b-render-rerun.log` 的同一用例 FAIL（「dock activity frame appears during a turn and hides after end + linger」，733e859 期）经 `.proof/dock-frame-regression/00-preregistered-expected.md` 二分为过时测试前提（36dc77a 的焦点回收属有意行为），由 13411a7 测试侧重钉解决。最终 HEAD `final-2/04-pert-shell-render-regression-ft.out:9` 具名 `(pass)` + `03-full-shell.out` 0 fail 为证，E9 改判 PASS。
- **E7 帧内 `error: turn aborted` 两行——真机复验已裁决**：主 agent 最终包帧 `frame-pass-1123/07-new-then-message-card.ans` 与 `08-new-second-message.ans`（§2 第 5/6 项）判「`/new` 后 1 秒发消息 → 新会话绑定、**无 Console 报错**、无未确认输入」PASS 与「新会话第二条消息正常」PASS；`results.txt` 记 `newflow: card=1 console_err=0` / `second msg F2=1 console_err=0`。原切片帧的 aborted 行未出现在主 agent 最终包复验中，E7 PASS 维持。
- `09-typecheck-entry.log` 只有 `$ tsc -p tsconfig.entry.json` 命令、无 `exit=0` 或错误输出；「typecheck:entry 成功」无显式退出码证据，作为缺口登记（不影响 E9 已因 shell fail 判 FAIL 的结论）。
- 预注册合法边界：`SESSION_LOCKED`/`JOURNAL_CORRUPT` 等非本次分类的 open 失败码不在 E 表内，未声称覆盖。
- USER-JUDGMENT U1（过渡态 UI）/U2（错误文案）按默认记录、不进门禁。
- 真机使用自有 tmux server + 自有 scratch HOME，未碰 `uibatchframe` 或用户 `~/.dsh`。

## 5. 主 agent（协调者）真机复验结论

依据 `.proof/frame-pass-1123/report.md`（最终包 sha `aff2afb9…`，13411a7）：§2 第 5 项「`/new` 后 1 秒发消息 → 新会话绑定、无 Console 报错、无未确认输入」PASS（帧 `07`）、第 6 项「新会话第二条消息正常（不再静默写旧会话）」PASS（帧 `08`），`results.txt` 的 `console_err=0` 直接覆盖 E7 的 Console 报错疑点；§3 D8 记录 `/new` 修复根因与 commit `f08fa9d` 一致。真机复验支持 E7 PASS 与整片改判 PASS，无相反证据。

## 6. 最终 HEAD 复跑（13411a7）

数据来源：`.proof/final-gate/final-2/` 与 `.proof/final-gate/pertests/`。

- 三包全量（`final-2/03-full-*.out`）：shell 1356 pass / 5 skip / 0 fail；tui-base 1639 pass / 1 skip / 0 fail；bridge **381 pass / 0 fail**。exit 均 0。
- typecheck：`final-2/04-typecheck-entry.out` exit 0（`00-summary-2.md:78`）。
- 本切片相关明细 pass 计数：`final-2/04-pert-shell-bridge-session-seam.out` = **170 pass / 0 fail**（E1–E5，含 `:45` newSession close→open、`:46-51` 各 close 码、`:52` open 失败自愈、`:53` resume 分支）；`final-2/04-pert-bridge-session-open-replace-guard.out:4` = 1 pass / 0 fail（E6 W3 replace guard）；`pertests/tui-base-commands.out:21,31`（`/new` 清 transcript + 重新加载）pass。
- 真机帧：`frame-pass-1123/07,08`。
