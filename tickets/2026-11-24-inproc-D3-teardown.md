# 子票：HTTP 通路拆到什么程度、什么节奏

- 类型：grilling（需用户拍板）
- 阻塞方：D1 用户配置放哪
- 关联：地图 `2026-11-24-inproc-only-map.md`；证据 `research/2026-11-24-inproc-only/02-http-host-residual.md`

## Question

删 HTTP 宿主是「一步删干净」还是「先停启动、后拆代码」？分几批发版？

## 现状（02 结论）

HTTP 宿主在 v2 boot 里只剩四件事，其中三件是本地文件 I/O：

| P0 | 内容 | 位置 |
|---|---|---|
| P0-1 | 删 `ensureV2Host`→`ClientConnection`→`RemoteHostSession`→`start()`；`host.dshHome` 换源 | `v2-entry.tsx:1616-1660`；替代源 `resolveDshHome()`、`seam.settings.identity()` |
| P0-2 | skin migration 写改走 `seam.configSave`，补 `LocalConfigStore` 白名单（缺 `skinMigration`/`workspaceTheme`/`workspaceThemeMode`）+ workspace overlay 写回 | `local-config-faces.ts:69-85,367-376` |
| P0-3 | theme/themeMode/motion 启动读改走 seam，补 overlay 解析（现只解析 `theme`，缺 `themeMode`/`model`） | `local-config-faces.ts:380-395` vs `workspace-config.ts:593-606` |
| P0-4 | 退出路径去 HTTP：heartbeat/watchdog/last-one/reaper 全删 | `v2-entry.tsx:1860-1892` |

P1：冷启动 label 空转 4s（删循环即可）、整套 HTTP 进程治理失去对象、`/reload` 失效（命令已不存在）、inproc 无「最后客户端退出」机制（需重做）。

## 候选

| 方案 | 节奏 | 风险 |
|---|---|---|
| A. 一步到位 | 一个版本内：配置迁移 + P0-1~4 + 供给链退役（provision-opentui/upgrade/launcher step3+6a）+ 门禁改 seed | 改动面最大，但不会留「两套并存」的半态 |
| B. 两步 | 版本 N：停启动（不再 `ensureV2Host`/预启），保留代码与老 profile 只读；观察一版；版本 N+1：删代码与目录 | 中途存在「代码在但没人跑」的死路径，容易被误判为回归 |
| C. 三批 | ①配置迁移 + LocalConfigStore 补齐（可单独发）②拆 boot 链 ③清供给/门禁/文档 | 每批可独立验收，但发版次数多，用户要跨多个版本 |

## 推荐

A，但按 C 的**内部顺序**执行（同一版本内合并）：先把配置迁移与 LocalConfigStore 缺口做完并真机验证，再拆 boot 链，最后清供给与门禁。理由：B 会长期留死代码路径，且 `--force`/watchdog 这类机制在半态下语义不清。

## 附带决策（同票）

### `--force` 语义（2026-11-24 用户拍板）

**杀本机所有 dsh-opentui 相关进程，不管在哪个 cwd / 哪个 DSH_HOME；但绝不碰其他 profile 的进程（`tui`/dsh-tui-pi、`web`、`headless` 等）。**

实现约束（实施按此写，避免 oldfox P1-2 的误杀）：

| 项 | 定义 |
|---|---|
| 杀谁 | ① launcher（`node .../bin/dsh-opentui.mjs`）② bun 客户端（`bun .../dist/client/index.js`）③ 桥宿主（`dsh --profile <我们的 profile 名>`） |
| 我们的 profile 名白名单 | `opentui-monday`（新）+ `opentui` / `opentui-inproc`（过渡版兼容，迁移后一版内保留） |
| 绝不匹配 | `--profile tui` / `web` / `headless` / `acp` / `sdk*`；以及其他产品的 dsh 进程 |
| 匹配方式 | 按 argv **精确 token** 匹配 + argv[0] basename 校验；**禁止** `pgrep -f` 子串匹配（会命中编辑器、日志路径） |
| 范围 | 当前用户的所有进程（只能 signal 自己的）；不做 DSH_HOME 过滤（用户明确「不管在哪里」） |
| 升级 | SIGTERM → 等待（约 2s）→ SIGKILL |
| 收尾 | 清 `<DSH_HOME>/profiles/<我们的 profile>/.provision.lock`；不删 session 锁（内核 flock 自动释放） |
| **评审补充 N3** | **`--force` 必须先杀 provisioner 子进程再清锁**：否则被杀 launcher 的 provisioner 还可能活着，锁被清后下一个窗口会并发再跑一轮。击杀清单补 `provision-inproc-profile.mjs` 进程；清锁放击杀之后，并校验锁内 pid+nonce 属于已杀进程 |
| 发布说明 | 明确「`--force` 会杀掉本机所有 dsh-opentui 窗口与宿主，包括其他终端里的进行中会话」 |

### inproc 跨客户端生命周期（2026-11-24 用户拍板）

**接受「每客户端一个宿主、没有共享 server」**：N 个客户端 = N 个宿主子进程；同一会话并发写由内核 `flock` 仲裁（`dsh-session-persistence-jsonl/lib/index.js:615-648`，持有者进程死亡自动释放）；不支持两个客户端看同一会话。
→ 因此**不新建** registry/heartbeat/reap 机制；这类机制随 HTTP 宿主一并删除。

**附带决策（仍待定）**：老 profile 里 append 的 `defaultPreset` 等用户值是否要在迁移时保留（当前定为不保留）。

## 决议记录

**2026-11-24 用户拍板：一个版本内按序做完**（配置迁移与 LocalConfigStore 缺口 → 拆 boot 链 → 清供给/门禁/文档），不拆成多个发版，不留两套并存的半态。

### 评审修正的顺序（oldfox，覆盖上面的粗略顺序）

1. **改名必须是最后一个提交**：改名会让 `ci.yml:237,317-320` 与 `verify-bridge-handshake.mjs:31` 立刻失效，门禁清扫必须在改名之前完成，否则中途全程门禁红。
2. **门禁（D5）要提到「删 boot 链」之前**：判定拆除是否安全的那道门，不能拆完才修。
3. **改名与 kill 路径必须原子提交**：改名后 `--profile opentui` 正是 bridge 子进程 argv，`launcher.mjs:42,452-455` 与 `safe-kill.ts:31,151,227` 会把活宿主识别成可杀对象。
4. **`--force` 与多客户端写锁必须先定**（见「附带决策」），它们是被删机制的唯一使用者。
5. 阶段 0 实测项改写：**「写路径」才是最大未知**——(a) 一次真实 `/settings` 写 → 重启 → 字段保留；(b) fresh HOME + dsh 在 PATH 的 provision；(c) 真降级尝试。双开不是最大未知。

