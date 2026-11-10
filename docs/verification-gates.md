# 验证门禁（Verification Gates）

本文把"真机验证"从口头约定变成机制：每类改动需要哪类证据、怎么跑、什么算过、失败长什么样，以及
**为什么"测试全绿"不能替代真机证据**。

三类证据（单测 / 类型 / 真机）互相不可替代。缺任何一类，结论只能写到它覆盖的那一层。

---

## 1. 三类证据

### 1.1 单测（行为 / 装配）

| | |
|---|---|
| 适用面 | 纯逻辑（状态机、命令表、行高计算、补全规则）、装配契约（entry → host 的 deps 传递）、headless 帧测试（`test/*-ft*`，真 renderer，无终端） |
| 命令 | 分包含跑（根目录 `bunfig.toml` 的 preload 与包内不同）：`for p in packages/*/; do (cd "$p" && bun test); done`；装配门禁单跑：`bun run verify:assembly`（等价 `cd packages/tui-base && bun test -t 'verify:'`） |
| 通过标准 | `0 fail`；`skip` **不算过**（见 §5） |
| 失败长什么样 | `(fail) <describe> > <test name>` + `error: expect(received).toEqual(...)` + 堆栈；`N pass / M fail` |
| 盲区 | 测试自己造的 ctx/依赖只能证明被造的那一段；不经过真实 entry 装配、真实 keymap、真实 host、真实终端 |

### 1.2 类型（入口装配链）

| | |
|---|---|
| 适用面 | 命令层 `SlashCommandContext` ↔ 面板层 opener ↔ 入口 deps 的**声明完整性**与**漏传**；新增/重命名 hook 时必须改到的所有位置 |
| 命令 | 入口链：`bun run typecheck:entry`（= `cd packages/tui-base && bun run typecheck:entry`，即 `tsc -p packages/tui-base/tsconfig.entry.json`）；shell 全量：`cd packages/shell && bun run typecheck` |
| 通过标准 | 两个命令都 `0 error TS`，退出码 0 |
| 失败长什么样 | `src/.../file.ts(行,列): error TS2322/TS2339/TS2304: ...` + `Found N errors`，退出码 2 |
| 范围 | `tsconfig.entry.json` 只 root 入口装配链（`examples/v2-entry.tsx` + `src/routes/session/slash-deps.ts` + `slash-palette.tsx` + vendor stubs），**不**把 tui-base 全包拉进来。tui-base 的全量 `typecheck` 仍有 58 个历史错误（2026-11-10），**不是门禁**，也不许借这次改动扩围 |
| 盲区 | `// @ts-nocheck` 文件体不受检（v2-entry 的 JSX/渲染段仍是），所以入口对象写入侧另由 §1.1 的 `verify:` 契约测试兜底 |

### 1.3 真机（真实 launcher + tmux）

| | |
|---|---|
| 适用面 | 命令面（`/xxx` 真打开）、面板挂载/层级/焦点、键位与 Keymap 冲突、入口装配的运行时结果、真实终端尺寸下的布局/溢出 |
| 命令 | `node verify/agents-mount-repro.mjs`（默认 120x34；`--cols`/`--rows`/`--keep`）；或 env 门控单测：`cd packages/shell && DSH_AGENTS_E2E=1 bun test test/agents-mount-client.test.ts` |
| 前置 | `tmux`、`bun`、全局 `dsh` CLI、`~/.dsh/profiles/opentui`（由 `dsh opentui --from-default-profile web --dump-config` 生成）、可用的 provider key；`DSH_HOME_REAL` 可指向非默认 home |
| 通过标准 | 退出码 0 且 stdout 每条都是 `PASS ...`；`verify/agents-mount-out/summary.json` 的 `results[].ok` 全为 true；`fallbackSeen: false` |
| 失败长什么样 | `FAIL  <check> — <detail>`、`N/M checks passed`、退出码 1；退出码 2 = 环境问题（缺 tmux/bun/profile/launcher）。抓屏与日志留在 `verify/agents-mount-out/`（`*.ans`、`*.err.log`、`summary.json`），close 失败时另有 `05-close-frame.txt` |
| 隔离 | 从 `~/.dsh` 只读复制 profile 到临时 `DSH_HOME`，不写真实 home；tmux session 单独命名并单独 kill，不 `kill-server` |

---

## 2. 必须先真机跑通才能合 main 的改动

以下任何一类，PR 必须附真机证据（命令 + 环境 + 抓屏/`summary.json`），否则不合 main：

- **命令面**：新增 slash 命令、命令改为打开面板/覆盖层、命令参数解析变化；
- **面板**：新增/移动/删除 overlay 或 panel 的挂载点、层级（table → fields → limits）、焦点回收；
- **键位 / Keymap**：新增或改动快捷键、Keymap.Provider 层级、Tab/Esc/Enter 拦截；
- **入口装配**：`client-entry.tsx`、`v2-entry.tsx`、`buildSlashDeps` / `createSlashHost` 的 deps 变化；
- **布局常量**：composer 高度、palette 行数、powerline/footer 高度、任何会改变首屏行占用的常量（动了就必须看 80x24 与默认两种几何）。

流程：

1. 单测 + `typecheck:entry` + shell typecheck 全绿；
2. 真机：`node verify/agents-mount-repro.mjs`（必要时加 `--keep` 复现），退出码 0；
3. PR 里贴：命令、终端几何、`N/M checks passed`、关键抓屏（`verify/agents-mount-out/*.ans` 或截图）、失败项的原始 detail；
4. **谁跑谁贴**：没有真机证据的 PR，评审按未验证处理。

---

## 3. 本次 `/agents` 事故案例（2026-11）

**现象**：真实客户端 `/agents` 显示
`/agents: the manager panel is not mounted in this entry`，
尽管 `AgentsPanel` 已挂进渲染树、seam 的 agents face 也在。修复 commit `e0843bb`（"carry openAgents
through the slash host so /agents mounts"）。

**根因**：三层之间掉了一环。

1. `examples/v2-entry.tsx` 把 `openAgents` 传给了 `createSlashHost`；
2. `createSlashHost` 的 deps 类型里**没有** `openAgents` 字段；
3. 函数体构造 `SlashCommandContext` 的展开列表里**也没有**它。

于是 `ctx.openAgents === undefined`，命令走"未挂载"降级分支。入口文件有 `// @ts-nocheck`
（它组合 shell 未类型化的 client 类），所以这个多余属性没有被编译器报出来。

**哪一层本可拦住**：

- **类型层**：如果入口是受检文件，`openAgents` 对 deps 类型就是 excess property（TS2353）；
  本次交付把装配收进受检的 `buildSlashDeps` / `ENTRY_SLASH_HOOKS`，并给入口链单独
  `typecheck:entry`。deps→ctx 这一层也不再手写清单：`carrySlashHooks` 用同一份 hook 列表，
  并且列表相对 `SlashHostDeps` 与 `SlashCommandContext` 两边的可选键做穷尽断言，新增 hook
  漏写清单直接编译失败；
- **契约测试层**：当时的命令单测手工构造 ctx，天然看不见"entry → host"这一段；本次新增
  `test/entry-slash-deps.test.ts`，直接调用 entry 用的同一个装配函数并断言 hook 身份传递；
- **真机层**：只有 tmux 脚本能看见"面板没打开"这个事实。这次事故正是靠真机脚本定位的——它证明
  真机层不能省，而不是可以拿单测替代。

---

## 4. CI 判定（结论与依据）

**结论：CI 不跑真机 tmux 门禁；真机是发版前/合 main 前的本地必跑项。** 依据：

- **tmux**：`actions/runner-images` 的公开镜像清单（2026-11-10 查 `Ubuntu2404-Readme.md`、
  `macos-15-arm64-Readme.md`）**未列出 tmux**；即使临时 `apt-get/brew install tmux` 可装，
  也只是把不确定性往后挪。
- **`~/.dsh` profile 无法离线造**：`packages/shell/scripts/provision-opentui-profile.mjs`
  依赖全局 `dsh` CLI（`dsh opentui --from-default-profile web --dump-config`）生成 profile；
  GitHub-hosted runner 没有全局 dsh（CI 注释与 stub 步骤都记录了这一点），profile 里的依赖
  闭包也需要 registry。仓库内没有可离线复用的 fixture（profile 约 192 MB，且含本机 provider 路由）。
- **还需要 provider key**：脚本要完成真实模型 turn，CI 无凭据。

因此 CI 只跑**不依赖 `~/.dsh`** 的两类证据：

- `.github/workflows/ci.yml` 的 `test` job：
  - `cd packages/tui-base && bun run typecheck:entry`（入口链类型，0 容忍）；
  - `cd packages/tui-base && bun test -t 'verify:'`（装配契约）；
  - 原有的 `for p in packages/*/; do (cd "$p" && bun test); done`。
- `real-client` job：`workflow_dispatch` 可手动触发，且需要仓库变量
  `DSH_REAL_CLIENT_GATE=true` + 带 `dsh-profile` 标签的 self-hosted runner（已装 dsh、profile、
  provider key、tmux）。默认跳过；**跳过不是通过**。

已知取舍：GitHub-hosted CI 上没有真机证据。这条风险由 §2 的"本地必跑 + 谁跑谁贴"承担。

---

## 5. "测试全绿"为什么不能当真机证据

判据（任一命中，绿就不能升级为真机结论）：

1. **测试自造依赖**：手工 `createSlashHost({...})` / 手工 ctx / mock seam，只证明被测对象给你造的
   输入，不证明真实入口会这样喂它（`/agents` 事故正是此类）。
2. **文件被 `@ts-nocheck` 或 `include` 之外**：编译器没看过的地方，"类型全绿"不覆盖。入口文件当前
   仍是 `@ts-nocheck`，所以入口对象写入侧由 `verify:` 契约测试 + 真机补足。
3. **没经过 entry / renderer / keymap**：单测里的组件树不等于真实 reconciler + Keymap.Provider +
   焦点管理；键位冲突、焦点抢回、Tab 拦截只在真机出现。
4. **没有真实进程/终端**：真实 `dsh` host、seam adapter、真实终端几何与时序（打开面板、切层、Esc
   回收）都不在单测里；80x24 的溢出/palette 高度只有抓屏能证明。
5. **skip 被当 pass**：`DSH_AGENTS_E2E` 未设、缺 tmux/profile 时测试是 skip（例如本机
   `packages/shell` 套件里 4 个 skip）。skip 必须显式记录为"未验证"，不能计入通过数。

一句话：**单测证明"我以为它接上了"，类型证明"声明上接上了"，只有真机证明"它真的接上了"。**

---

## 6. 本次新增的命令速查

```bash
# 入口装配链类型（0 error 是硬门禁）
bun run typecheck:entry

# 装配契约（不依赖 ~/.dsh / tmux）
bun run verify:assembly

# 两个包的单测（CI 同款）
for p in packages/*/; do (cd "$p" && bun test); done

# shell 全量类型（0 error 是硬门禁）
cd packages/shell && bun run typecheck

# 真机门禁（合 main 前必跑；退出码 0 = 全过）
node verify/agents-mount-repro.mjs
# 等价 env 门控单测：
cd packages/shell && DSH_AGENTS_E2E=1 bun test test/agents-mount-client.test.ts
```
