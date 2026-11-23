# Proof Report: b2b-trace-v2 / composer trace 埋点迁到发行 v2 路由

- Gate / 门禁: FAIL
- Result / 结论: FAIL  （与 Gate 一致）
- Profile(s): FEATURE + 构建产物 grep
- Change ref: `75999cf`（V1–V5 主体：v2 composer contentChange / 7 个 setText 来源埋点 + `steer-queue` 枚举）；`0690166`（后续 C1/C2：`keyTrace !== undefined` 短路 + `history-refill` 来源，**改变了 V2/V4 冻结的调用形态**）。最终态以 HEAD 为准。
- Working tree: 本 agent 只新增本报告；他人未提交改动未触碰。
- Expected registered (UTC): 2026-11-23T05:09Z（见 `00-preregistered-expected.md`，write-once）。
- Assertion total N: 5（V1–V5）
- Acceptance target（用户原话，本轮文档任务）: "内容必须**只依据盘上已有的一手证据**……没有证据的项如实标 NOT RUN / CLAIM"。切片目标（预注册原话）: "发行 bundle 含 v2 埋点（调用点而非仅 sink 定义）"。

## 1. 切片目标与生效 commit

目标一句话：让发行客户端（v2-entry → session-composer）的文本变化与程序化赋值进入 key/input trace，env 关闭时零行为变化，v1 埋点保留不动。

生效 commit 链：
- `75999cf` —— `key-trace.ts` 增 `steer-queue`；`session-composer.tsx` 加 `keyTrace?.contentChange` 与 7 个 `traceSet`；新增 `key-trace-v2.test.ts`。
- `0690166` —— **最终态**：把 contentChange 改成 `if (keyTrace !== undefined && ...) { keyTrace.contentChange(...) }`（C2），并把 `/history` 灌入改为 `keyTrace?.composerSet("history-refill", ...)`（C1，在 `v2-entry.tsx`）；枚举加 `history-refill`。
- 注意：V4 冻结的「所有埋点为 `keyTrace?.`、无裸 `keyTrace.` 解引用」被 `0690166` 的 C2 直接改写；最终形态以 `0690166`（及 batch-review-followups 的 C2）为准。

## 2. Gate / Result 表

| id | 预注册 expected（摘要） | Result | 判定依据（原始输出行） | 证据文件 | 最终态归属 |
|----|------------------------|--------|------------------------|----------|-----------|
| V1 | 枚举保留 v1 七来源并加 `steer-queue` | PASS | `04-key-trace-v2-unit.log:5`（V1 pass，八来源全在）；`06-bundle-grep.log:14`（产物含 `steer-queue`） | `04-key-trace-v2-unit.log`,`06-bundle-grep.log:14` | 证据在 75999cf；0690166 又加 `history-refill`（现九来源），无新测试日志 |
| V2 | textarea `onContentChange` 调 `contentChange(value.length, value)`，head ≤32 | PASS | `04-key-trace-v2-unit.log:6-7`（V2 两条 pass）；`06-bundle-grep.log:6,23-27`（调用点在 onContentChange 块、plainText 取值） | `04-key-trace-v2-unit.log:6-7`,`06-bundle-grep.log:6,23-27` | 证据在 75999cf 的 `keyTrace?.` 形态；0690166/C2 改为裸调用 + guard，最终形态无新产物 grep |
| V3 | 7 个 setText 赋值点各带正确来源，映射与冻结表一致 | PASS | `04-key-trace-v2-unit.log:8-10`（V3 三条 pass：7 点相邻 trace、来源映射、v1 保留） | `04-key-trace-v2-unit.log:8-10` | 0690166 改的是 `v2-entry.tsx` 的 /history 点（C1），本断言域 `session-composer.tsx` 7 点未被改 |
| V4 | env 关闭零行为；所有埋点 `keyTrace?.` 形式、无裸解引用 | CLAIM | 证据 `04-key-trace-v2-unit.log:11` 是 75999cf 的 `keyTrace?.` 形态；最终 HEAD `0690166` 已改为 `if (keyTrace !== undefined ...) { keyTrace.contentChange(...) }`，冻结的「无裸 `keyTrace.`」字面**被后续 commit 取代且无新原始输出** | `04-key-trace-v2-unit.log:11`（旧形态）；最终形态见 `git show 0690166`，无同目录原始日志 | **最终态以 0690166 / batch-review-followups C2 为准** |
| V5 | build-client 退出 0；产物含 `keyTrace?.contentChange(`/`composerSet(` 调用点、各来源字面量、source map 含 session-composer.tsx | PASS | `06-build-client.log:1-4`（构建三产物成功）；`06-bundle-grep.log:4-17`（调用点计数=2，基线 0；contentChange 1、composerSet 1、history 3、submit-clear 2、steer-queue 1、other 5；source map 命中 4） | `06-build-client.log`,`06-bundle-grep.log:4-17` | 产物抓取于 13:12（75999cf 期）；0690166 在 14:07 之后未重抓 bundle |

汇总：PASS 4（V1,V2,V3,V5） / FAIL 0 / NOT RUN 0 / CLAIM 1（V4）。

## 3. 原始输出指针（存在性 + sha256）

| 文件 | sha256 | 说明 |
|------|--------|------|
| `01-env-snapshot.log` | `923a71b51245c66e61e9fdc6701ba61d151a2d4f40f90db25465c7b624281903` | 宿主/HEAD（head=7f89410，在 75999cf 之前） |
| `04-key-trace-v2-unit.log` | `261392a95ec8defa15d4f66f6312c3b62012ed9f922ce70567ccd1809d8c2f42` | 13 pass / 0 fail（含 V1–V4 + B2 既有 E1–E6） |
| `05-typecheck-entry.log` | `2b295264df12d2f2262aca8e0f641cbc25786e27cfcd9894e05d5b7fd72cc0b4` | 仅命令，无显式 exit 标记 |
| `06-build-client.log` | `c64bbd83bcf7fc4e9509bb865d4605232e6069a25b807aa93dbf687884e7019d` | build-client 成功 |
| `06-bundle-grep.log` | `77443bc87139969f34bdc9c92b74837f022e790b57f41cb38a026dd3ed1e6e52` | V5 调用点/字面量/source map 证据 |
| `07-full-tui-base-tests.log` | `004a48e0f58ef959d7a9e724cbd9eb8a9ef047ed71e9b7825965119bc4338bce` | 全量 1608 pass / 1 skip / 1 fail |
| `07-tests-and-typecheck.log` | `2dae1eaa274a980498ae63e1d9dd0a54dc1f0e04284ae35f2d64b2f9f7fc21be` | 合并输出，full 1 fail 同上 |
| `00-preregistered-expected.md` | `653638b1d1db073abf25e47b633657b1935d78d88521e2ea3e6a6f614d740511` | 已入库预注册 |

## 4. 已知偏离与诚实声明

- **证据 commit 归属**：`01-env-snapshot.log:3` head=`7f89410`，早于 `75999cf`；V1–V5 的测试与 bundle 证据抓于 13:11–13:13（75999cf 期），均早于 `0690166`（14:07）。V2/V4 的形态、V5 的 bundle 内容相对最终 HEAD 都是**陈旧证据**，本报告如实标注，不冒充最终态的在场绿。
- **V4 被取代**：冻结 criterion「无裸 `keyTrace.` 解引用」被 0690166/C2 的 bare guarded call 改写；新形态的原始测试输出不在本目录（在 batch-review-followups 的声明域内，而该目录无任何证据文件），故 V4 判 CLAIM。
- **全量套件有 1 fail**：`07-full-tui-base-tests.log` / `07-tests-and-typecheck.log` 末尾 **1608 pass / 1 skip / 1 fail**，失败项「approval card keys (ADR-0011 T5a)」与本切片 trace 面无关（属 ask 文案后续 df699fe 域），但预注册 PASS 判定式要求「受影响包全绿」，故 Gate 不自称全绿。
- `05-typecheck-entry.log` 只有两条命令、无 `exit=0` 标记；不据此断言「typecheck exit 0」有证据。
- 预注册 U3（trace 文件人工取证判读）自报 NOT RUN（使用阶段人工取证，代码层不可判），本片未做，符合预注册声明。
- 预注册明确不埋点的 `v2-entry.tsx:1287` /history onRefill 外部赋值缺口：正是 0690166/C1 后来补的 `history-refill`；V1 枚举由八变九。

## 5. 主 agent（协调者）真机复验结论（留空占位）

见 .proof/frame-pass-1123/report.md（主 agent 抓帧验收报告）。
