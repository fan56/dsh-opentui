# 025 波3 — 宿主 rc 升级演练（W7，scratch 隔离，非生产）

- 时点：2026-11-21T19:28Z；分支 `feat/025-wave3`；执行仓 `/Users/qingguee/repo/dsh-opentui-wt-024-capir`。
- 纪律：**演练非生产升级**。全程 scratch prefix / scratch home，绝不碰本机日用 `~/.dsh` 与全局 dsh；显式版本（禁裸名 latest，规避 dsh-llm stub）；凭据零消费/零落盘；孤儿按 PID 复核。
- 一手证据：`.proof/025-w3-2/03-rc-drill/`（`00-precheck.log` / `01-drill.log` / `02-postcheck.log`）。

## 一、先说结果

演练路径**通过**：scratch 内 `rc.4 →（探测 latest/next=rc.5）→ 升级 rc.5 → 回滚 rc.4` 三步 exit=0、版本回读一致。未发现升级路径问题；不阻塞发版（现行钉 rc.5 稳定）。三处版本口径偏差如实登记（§三），均无产品回归。

## 二、只读 precheck（升级前）

| 项 | 实测 | 证据 |
|---|---|---|
| 本机现行宿主 | `/opt/homebrew/bin/dsh`，`dsh --version = 0.2.2-rc.5`；PATH 唯一 | `00-precheck.log` |
| npm dist-tags | `@deepseek-ai/dsh`: latest=next=**0.2.2-rc.5**（alpha=0.2.2-alpha.3，退役 tag）；新版本解析 = rc.5 | `00-precheck.log` |
| 候选版本可解析 | rc.3 / rc.4 / rc.5 均 `npm view ... version` 命中 | `00-precheck.log` |
| dsh-llm stub 风险 | `@deepseek-ai/dsh-llm`: latest=**0.0.1-rc.1**（stub）、next=0.2.2-rc.5 → **全程显式版本号**，不裸名 | `00-precheck.log` |
| 在跑宿主进程 | 无 `dsh --profile` 宿主；`dsh-jev-mcp` PID 28031（排除未动）；PID 98608 未 present（白名单未触碰）；zombie-parent.mjs 为单测夹具（非真宿主） | `00-precheck.log` |
| 日用 home 基线 | `~/.dsh` mtime `2026-11-22T02:51:58Z`；profiles = headless/node_modules/opentui/opentui-inproc/tui/web | `00-precheck.log` |
| 回滚命令 | `npm install -g @deepseek-ai/dsh@<old>`（0.24 手册 §5.4，旧版 rc.4 在 mirror 可解析，本次 rc.4 一手复验） | `00-precheck.log` + 0.24 `024-host-rc5-upgrade-precheck.md:18` |

## 三、钉版冲突表（precheck 对账，非停车）

| 钉点 | 版本 | 口径 |
|---|---|---|
| 任务 A-4 钉点（真源） | rc.5 | 本机现行、npm latest/next 均 rc.5；W7 0.24 已完成 rc.4→rc.5（`024-host-rc5-upgrade-executed.md`） |
| ci.yml pack-cold-start 宿主 | `0.2.2-rc.3`（`:229` env、`:287` install） | CI 冷启动装的是**下界** rc.3，非生产现行；bridge `HOST_PEER_RANGE = '>=0.2.2-rc.3 <0.3.0'`（`host-compat.test.ts:46`）同时接受 rc.3 与 rc.5 → 属**版本错位**非硬不兼容 |
| 测试夹具钉版 | rc.3 / rc.4（`bridge-failfast.test.ts:112`、`bridge-recover.test.ts:92` 等） | 单测固定输入值，非运行钉版 |

0.24 历史冲突（tui profile `dsh-cordis-host-runner@0.2.2-rc.4` 与 rc.5 硬冲突）已在 0.24 执行批按手册升到 rc.5 消除；本次 scratch 演练不改任何 profile，不重触该冲突。

## 四、演练执行（scratch prefix，非生产）

| 步 | 命令（scratch prefix） | 结果 | 版本回读 |
|---|---|---|---|
| 1 旧版基线 | `npm i -g --prefix $PREFIX @deepseek-ai/dsh@0.2.2-rc.4` | exit=0 | rc.4 |
| 2 探测 newest-of(latest,next) | `npm view ...@latest` / `@next` | latest=next=rc.5 | （解析值） |
| 3 升级 | `npm i -g --prefix $PREFIX @deepseek-ai/dsh@0.2.2-rc.5`（用解析值 `$LATEST`） | exit=0 | rc.5 |
| 4 回滚 | `npm i -g --prefix $PREFIX @deepseek-ai/dsh@0.2.2-rc.4` | exit=0 | rc.4 |

- scratch 路径 `/tmp/w3-rc-drill-AFNT8S`（演练后已清理）；DSH_HOME 独立子目录，全程未用作任何 dsh 启动。
- 无 provider key 消费；无孤儿宿主/mock 残留（POST-CHECK 空，过滤自身）。

## 五、postcheck（生产面零触碰证明）

| 项 | 演练前 | 演练后 | 结论 |
|---|---|---|---|
| 全局 dsh 版本 | 0.2.2-rc.5 | 0.2.2-rc.5 | 不变 |
| PATH dsh | `/opt/homebrew/bin/dsh`（唯一） | 同上 | 不变 |
| `~/.dsh` mtime | 02:51:58Z | 02:51:58Z | 不变 |
| `~/.dsh/profiles` | 6 项 | 6 项（同名） | 不变 |
| 演练相关孤儿进程 | — | 空 | 无残留 |

## 六、结论与停车与否

- 升级路径演练通过（安装 rc.5 / next-latest 探测 / 降级回滚均 exit=0、版本回读一致）；未发现升级路径问题。
- 三处版本口径偏差（A-4 rc.5 vs ci rc.3、dsh-llm stub、测试夹具固定值）均为已知/非冲突项，如实登记；不构成缺陷、不停车、不阻塞发版。
- 演练为 scratch 隔离的**演练**，不替代真实生产升级的 0.24 执行证据（后者在 `024-host-rc5-upgrade-executed.md`）；本机日用宿主全程未动。
