# AMENDMENT — SK 预注册补充（oldfox S2 评审 §四 终裁意见，捕获前落盘）

- Amended at (UTC): 2026-11-20T17:55Z
- Source: `/Users/qingguee/repo/wayfinder-web-profile/research/024-s2-review-oldfox.md` §四（lines 57-64），coordinator 11-21 转达生效
- 本文件不修改 `00-preregistered-expected.md` 任何 expected 值；只补充判定口径与合法 PARTIAL 条件。

## A1 真机渲染类断言：BLOCKED 口径先立后跑（§四.1）

- 本地可达层：tmux + `capture-pane -e` 采集脚本必须真实执行，stdout/stderr 原文落 `.ans` / `.log`；采不到就是采不到，原文如实保存。
- **合法 PARTIAL 条件**：若 provisioned runner（e2e 清单 B3/C4 通道）不可得或 TUI 90s 未达 composer，E7 的「逐项帧归属判定」记为 `BLOCKED`（四行声明：Reason / Tried / Excluded scope / Remaining risk），同步登记入统一清单 `024-e2e-requirements.md`；**禁止**用单测/源码扫描替代真机帧自称 PASS。
- E7 的机器可判、环境无关部分（脚本是否真实执行、raw 文件是否落盘、退出码是否如实）单独判 PASS/FAIL；渲染归属部分走 BLOCKED。报告 Result 按 proof-it-works §7 取 `BLOCKED`（有 BLOCKED 行且无 NOT RUN 行时），机器部分单列 `machine part: PASS`。

## A2 criterion 机器可判且环境无关（§四.2）

- E2/E3/E4 的键位归属断言一律写成**可观测行为口径**（哪个 surface 收键、transcript 是否滚动、quit 是否触发），不写 `present=true` 类运行时状态断言。
- 预注册 E4 的 `sessionTabs.enabled` 等门控只作为配置/单测级观测，不作为真机环境依赖子句。
- 已知可能字面未达成的项（真机帧）在上文 A1 当场写合法 PARTIAL 条件，捕获后不放宽任何 criterion。

## A3 落点复用 S1/S2 定型模式（§四.3）

- 四层栈只做 shell/tui-base 输入路由；**不碰 bridge 四层栈、不碰 cordis inject、不新增服务键、READY 75/75 不变、W descriptor 不变**。
- 复用 S1/S2 已验证的 provider/bridge 结构：FocusRouterProvider 嵌套 InputOwnershipProvider（等价 panel-kit 的 `push/pop/owns` 桥接模式），不改生成链、不改 ledger。

## A4 ADR-0008 架构依据 + 禁顺带（§四.4）

- ADR-0008（Accepted 2026-11-16）是架构依据；本片只在其上收紧 tiered 视图，不另建 ownership 状态。
- **settings/\\* 属 S5 config 宿主清偿范围，本片不碰**：不修改 `settings-modal.tsx` 及任何 settings 域文件（该文件的 pager 层保持原样，PanelKit 通用层仍由桥接注入 overlay tier）。

## A5 stream 语义不动（§四.5）

- 无长按/重复 stream 语义引入；不改任何 stream/AbortController 代码。

## A6 脱敏扫描复用（§四.6）

- 证据包采集完成后对 `.proof/024-sk-keymap/` 执行一次 `scripts/scan-stdio-secrets.mjs`，按 S3'(b) 把 sink 路径枚举为显式参数，结果落 `13-desens-scan.log` 并入包。
