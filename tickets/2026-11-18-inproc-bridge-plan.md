# 2026-11-18 in-process bridge 阶段一执行计划

对应 ADR-0009 / ADR-0010。只覆盖 0.22.0（阶段一）；0.23.0 拆包作为后续阶段列出，不排入本计划的任务清单。

> **部分已过期（superseded）**：T15「把 `opentui-append-system` 映射为 `standard` + 一次 warning」及其下游 T17 的映射前提由 `a45a052` 撤销——旧 id 在 inproc 为惰性元数据、不传 `preset`，append 由 bridge section 无条件注入。当前语义以 ADR-0010 条款 A/B 为准；本文其余任务与决策作为历史执行计划保留。

## 决策摘要

- 采用方案 D：宿主进程内 cordis bundle 直调 `ctx.agents.resume` / `sessionPersistence`，对外 stdio JSON-lines；TUI 仍是 bun 进程、命令仍是 `dsh-opentui`，这是两进程而非单进程方案。
- 0.22.0 分发：bridge 产物内嵌 dsh-opentui tarball（`packages/shell/package.json` 的 `files` 加 `dist/bridge`），bin 运行时落绝对路径 symlink，不用 `link:` / `file:` 语义，0.23.0 再拆独立 npm 包。
- 新 profile `opentui-inproc` 共享同一个 `~/.dsh`，bin 首启幂等 provisioning 带跨实例互斥，护栏校验 name@version（或 integrity）而非 realpath 前缀。
- append-system 改为 bridge 内 `systemPrompt.section`（scope 注册、禁 global、`order: 200`）；存量 `opentui-append-system` 会话 resume 前映射 `standard` + 一次日志 warning，不写持久化数据。
- 发布门 required：CI 必须有 `npm pack → 全新 scratch prefix 安装 → 冷启动 → 四门禁冒烟`，不可 skip。
- 包名与发布 scope：`@aiwayds/dsh-opentui-bridge`；0.22.0 只作为内嵌产物随 `@aiwayds/dsh-opentui` tarball 分发，不单独上 npm。

## 护栏（全局，适用于所有任务）

- **profile 目录严禁出现 `@deepseek-ai` 副本**：野包遮挡是历史事故，provisioning 与护栏必须阻止任何 `@deepseek-ai` 包被拷贝/安装进 profile 目录；依赖保持 external，由宿主闭包提供。
- **bridge 不能独立 DSH_HOME**：`opentui-inproc` 必须与其它 profile 共享 `~/.dsh`，否则看不到存量 sessions。

## 里程碑与放行判据

### M1 — 分发与装配地基

范围：tarball 内嵌 bridge；绝对 symlink provisioning（含跨实例互斥）；name@version 护栏；`protocolVersion=1` 握手 + `--repair-bridge` 自愈；CI pack→scratch→冷启动→四门禁冒烟（required）。

放行判据：`pack → 全新前缀安装 → 冷启动（`--repair-bridge`）→ bridge 加载 → 身份校验 → 握手 protocolVersion=1` 全过。**门禁① 不在 M1 放行**——M1 不做 seam 切换、桥也没有 session 方法，三入口跑不起来；门禁① 随 M2 一起放行（2026-11-18 排期订正）。

### M2 — 默认路径切换

范围：默认 seam 换成 `BridgeSessionSeam`；bridge 落地 `session.open/send/close`、`turn.abort`、`journal.replay`；`--remote` 标 deprecated 且文档可见；fail-fast 错误自包含三要素（诊断 + 修复命令 + 该模式无 append）。
范围补充：`session.open` 的 replace 语义与错误码全集（见 ADR-0010 错误码全集小节）。

放行判据：门禁①（`/resume`、`--session`、`--resume-last` 三入口恢复历史）+ 门禁②（abort 后同会话）+ 双向崩溃用例（bridge 崩 / TUI 崩两侧都验证）。

**M2-1 已完成事实（2026-11-18）**：桥内 `resume` 已通过门禁③——能答出原会话首条消息；旧 thin client 对照组复现失忆（模型答不出原会话首条消息）。该对照差异即"两个数据源分裂"缺陷，in-process bridge 的 eager resume 已修复它。

### M3 — append 合并与清退

范围：section 接入；ride 删除；bridge 映射 + 单次 warning；合成 preset 声明清理（按 T/W 分支定时点，与 ride 删除同一变更单元，用 `managedSpan()` marker 定位，写前备份、原子写、写后 YAML 复验）。

放行判据：门禁③ + ④ + 双 profile 双开 writer-held + footer 显示 `dsh(Standard)`。

### 0.23.0（后续阶段，不排入本清单）

拆双发布物（bridge 独立 npm 包）；分支 W 时执行合成 preset 声明清理；删除 `--remote`。

## 前置实测（排在任务清单最前，M1 的前置）

- **T1 — 实测宿主 `session/open` 遇未知 preset id 的行为**：容忍（T 分支）→ 0.22.0 执行合成 preset 声明清理；抛错（W 分支）→ 推迟到 0.23.0。本项是 M1 的前置，结论决定 M3 中声明清理的定时点；必须在 M1 装配任务开始前完成。
- **结论 = T 分支（容忍）**：宿主对已不存在的 agentPreset id 静默降级——三条入口（`-- --session <id>`、`-- --resume-last`、应用内 `/resume`）全部无报错、退出码 0、历史照常渲染、footer 从 `dsh(Standard + Append)` 变为 `dsh(Standard)`，无 warning、无错误文案。因此 T16（合成 preset 声明清理）按 T 分支**排入 0.22.0**。
- 实测还顺带复现了 ADR-0009 的主缺陷（与 preset 无关）：三条入口的模型上下文均未恢复，各自新建了 `session-<uuid>`，问题"这个会话第一条消息是什么"答不出。对照实验（preset=standard 的会话）同样复现。

## 任务清单

每项 ≤30 分钟、单一动作、可独立验收。标注：依赖 / 放行门。不要把调研、实现、验证混进同一任务。

### 前置（M1 前置）

- **T1 实测 session/open 未知 preset id 行为** — 在宿主 `session/open` 传入未知 preset id，记录是容忍（T）还是抛错（W）（依赖：无 / 放行门：M1 前置，决定 T16 定时点）。

### M1 — 分发与装配地基

- **T2a bridge 包骨架与构建产物** — 新建 `packages/bridge`（cordis bundle 源码：`package.json` 带 `dsh.bundle.patch`、`cordis.patch.yml` 带 `insert` 条目、最小 `apply(ctx)` 入口），并加构建步骤把产物输出到 `packages/shell/dist/bridge`（T2 的 `files` 白名单依赖它存在）。包名用 `@aiwayds/dsh-opentui-bridge`（不是 `@deepseek-ai/*`——那是厂商 scope）。约束：零 dependencies、零 install 脚本、peer 只钉宿主 `dsh-base` 精确版本（依赖：无 / 放行门：M1）。
- **T2 tarball 内嵌 bridge** — 在 `packages/shell/package.json` 的 `files` 加 `dist/bridge`，使 bridge 产物随 dsh-opentui tarball 分发（依赖：无 / 放行门：M1 门禁①）。
- **T3 实现绝对 symlink provisioning** — bin 首启向 `opentui-inproc` profile 落绝对路径 symlink，指向内嵌 bridge 产物；不使用 `link:` / `file:`（依赖：T2；护栏：禁 `@deepseek-ai` 副本、禁独立 DSH_HOME / 放行门：M1）。
- **T4 加跨实例互斥** — 为 provisioning 过程加跨实例互斥，避免并发首启重复写入（依赖：T3 / 放行门：M1）。
- **T5 实现 name@version 护栏** — 校验 profile 内 bridge 的 name@version（或 integrity），不用 realpath 前缀硬绑（依赖：T3 / 放行门：M1）。
- **T6 实现 protocolVersion=1 握手** — 首帧交换 `protocolVersion` 与宿主版本，版本不符走 `OPEN_FAILED{VERSION_INCOMPATIBLE}`（依赖：无 / 放行门：M1）。
- **T7 实现 --repair-bridge 自愈** — 护栏失败时提供 `--repair-bridge` 重建 symlink（依赖：T5 / 放行门：M1）。
- **T8 CI pack→scratch→冷启动门禁冒烟** — 在 CI 加 `npm pack → 全新 scratch prefix 安装 → 冷启动 → 四门禁冒烟`，required（依赖：T2–T7 / 放行门：M1 门禁①）。

### M2 — 默认路径切换

- **T9 默认 seam 换 BridgeSessionSeam** — 把默认 `RemoteSessionSeam` 换成 `BridgeSessionSeam`（依赖：M1 / 放行门：M2 门禁②）。
- **T10 --remote 标 deprecated** — 保留 `--remote` 为可见的 deprecated flag，并在文档中标注（依赖：T9 / 放行门：M2）。
- **T11 fail-fast 错误三要素** — 错误自包含诊断 + 修复命令 + "该模式无 append"提示（依赖：T9 / 放行门：M2）。
- **T12 双向崩溃用例** — 分别验证 bridge 崩溃与 TUI 崩溃的可恢复行为（依赖：T9 / 放行门：M2 放行判据）。

### M3 — append 合并与清退

- **T13 section 接入** — 按 ADR-0010 append section 契约接入 `systemPrompt.section`（依赖：M2 / 放行门：M3 门禁③）。
- **T14 ride 删除** — 删除旧的 append ride 路径（依赖：T13 / 放行门：M3）。
- **T15 bridge 映射 + 单次 warning** — resume 装饰层把 `opentui-append-system` 映射为 `standard`，记一次日志 warning（依赖：T13 / 放行门：M3 门禁③）。
- **T16 合成 preset 声明清理（T 分支）** — 用 `managedSpan()` marker 定位、写前备份、原子写、写后 YAML 复验清理声明；与 T14 同一变更单元；仅当 T1=T（容忍）时排入，T1=W 时推迟到 0.23.0（依赖：T1=T、T14 / 放行门：M3 门禁④）。
  - 备注（实现约束）：清理 `~/.dsh/profiles/opentui/cordis.patch.yml` 的合成 preset 声明时，**必须保留 managed marker 注释两行**（实测位于 393–394 行，`- insert:` 声明本体在 395–540 行）。若 marker 一并删除，客户端 `syncAppendSystemPreset()` 会在每次宿主启动把整块重新追加回去。保留 marker 后 `managedSpan()` 判定 present，声明不再写回（实测清理后该 id 计数恒为 0）。
- **T17 footer 显示 dsh(Standard)** — 状态栏 footer 在映射后显示 `dsh(Standard)`（依赖：T15 / 放行门：M3）。
- **T18 双 profile 双开 writer-held** — 验证两个 profile 同时打开同一会话时后开者显式收 `writer-held`（依赖：M2 / 放行门：M3）。
- **T19 门禁③+④ 回归** — 跑门禁③④连续 20 轮上下文与 compaction/截断交互（依赖：T13–T18 / 放行门：M3）。

## 工作量

- 0.22.0（阶段一，M1–M3）：约 **14–19.5 人日**。
- 0.23.0（拆包与清理）：另 **1–2 人日**。
