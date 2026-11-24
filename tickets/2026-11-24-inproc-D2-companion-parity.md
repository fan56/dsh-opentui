# 子票：遗留 18 个插件怎么迁进 inproc

- 类型：grilling（需用户拍板）
- 阻塞：无（可与 D1 并行）
- 关联：地图 `2026-11-24-inproc-only-map.md`；证据 `research/2026-11-24-inproc-only/05-companion-parity.md`

## Question

老 profile 里 18 个 `@aiwayds/*` 插件，哪些进 `opentui-inproc` 的 companion catalog、哪些默认装、哪些放弃？

## 现状（05 对账）

- 分类：1 个已默认装（`subagent-registry`）、8 个在 catalog 但 opt-in、9 个不在 catalog。
- **严格意义上 0 个因缺 web-app 服务而无法工作**：所需服务（`llm`/`settings`/`web`/`userQuestions`/`credentials`/`commands`）全在 `dsh-base`。`dsh-web` 是搜索后端，不是 web UI（05 §0.1）。
- 真正该补 catalog 的只有 3 个：`topics-memory`、`cron`、`workflow`（老 provisioner 的 recommended 层，inproc catalog 漏项）。
- feishu 是唯一实际不可用项：私有包不在 npm（catalog 装不了）+ 抢 `userQuestions` ask 槽且不回退 + 富功能依赖 web-app 的 `agentPresets`（`05 §0.4`）。

## 候选

| 方案 | 内容 | 结果 |
|---|---|---|
| A. 底线（推荐） | catalog 加 `topics-memory`/`cron`/`workflow` 三条，`defaultOn:false`；其余按老 provisioner 排除清单放弃；feishu 明确放弃并写清原因 | 与老 profile 的「用户实际常用集」基本对齐；不引入默认负担 |
| B. 尽量保功能 | 8 个 opt-in 全设 `defaultOn:true` + 新增 3 条 | 复刻老 recommended 默认层，但与 catalog「有 inproc 消费者才默认装」的设计意图冲突 |
| C. 点名保留 | 用户列实际在用的插件清单，其余放弃 | 最贴合真实使用，需要用户给清单 |

## 推荐

A。理由：`05 §2` 已证明老 recommended 层多数组件在 inproc 下「无消费者」；全默认装等于把空转组件塞进宿主。

## 附带决策（同票）

- 模型表 4 项漂移（`glm-5.4`、`mimo-v2.6-pro-ultraspeed`、`hy4-flash-free`、`qwen4-max`）是否补进 inproc 模板：模板是生成式权威，不补则用户模型选择器里这几项消失。
- 老 profile 的 `dsh-workflow` 是 `link:` 本地安装，catalog 走 npm 路径需先确认可发布（05 未知项 3）。

## 决议记录

**2026-11-24 用户点名（保留 10，放弃 1）：**

- 保留：`ask-router`、`approval-policy`、`llm-net-retry`、`model-sync`、`llm-stats`、`mcp-adapter`、`vault`、`web-search(anysearch)`、`topics-memory`、`cron`（`subagent-registry` 本来就是默认装）。
- 放弃：`workflow`（用户本机是 `link:` 本地安装；tui profile 仍可用该功能）。

## 由此产生的实现项与风险

1. **catalog 变更**：现有 8 个 opt-in 全部改为默认装（或让 provision 默认传 `all`）；新增 `topics-memory`、`cron` 两条。
2. **ask 槽仲裁（引入 surface 前必须解决；当前默认 roster 无需）**：源码核对推翻了「重复占槽」的旧判断（`05 §1 #2` 与 catalog reason 沿用旧说法）——0.7.0 的 `ask-router` 不提供也不抢占 `userQuestions` 服务槽，只提供 `askSurfaces` 并注册 `user-questions/request` waterfall 应答者；bridge 的 `ask.request` 是宿主→stdio 客户端的输出帧，不是 router 消费的共享槽，两者不会重复应答 / 重复弹 UI / 占槽失败。零 surface 时 router 调 `next()` 让位，approval 始终由 bridge 独占。**当前默认 roster 无 surface，运行时可共存；引入 surface 前必须做仲裁**（详见 `2026-11-24-inproc-ask-slot-arbitration.md`）。
3. **审批双层（评审已定性，不是「叠加」而是行为变更）**：`approval-policy` 以 `prepend` 进 `approval/request`，对 `origins:['subagent','scheduled']` 用 `windowSeconds / defaultOutcome:'rejected'` 去 race 下游；bridge 的 answerer 是「return 占住 waterfall」。**决议（2026-11-24）：保留该行为**，并把窗口调到 **300 秒（5 分钟）**。
   - 可配置性已核：`windowSeconds` 是 `z.number().min(0).max(86400).default(60).volatile()`（`@aiwayds/dsh-approval-policy/lib/index.js:54-60`），出现在 `/settings`，值持久化在 profile patch 的 `dsh-approval-policy` 条目 → **必须进「用户段必须保留」的键清单**，否则下次 provision 冲掉。
   - 动作：新 profile 模板里 `dsh-approval-policy` 条目 `config: { windowSeconds: 300 }`；`origins` 保持默认 `['subagent','scheduled']`。
4. **启动成本**：10 个 companion 默认装 ⇒ 每次启动串行 10 次 `npm view --json`（各 30s 超时，`inproc-companions.mjs:196-213`），在宿主 spawn 之前阻塞；黑洞网络下最坏约 300s，任一漂移再加一次最长 10 分钟的 `dsh plugin add`。
5. **catalog 文案要改**：这 8 条的 `reason` 现在都写着「no consumer / opt-in only」（`inproc-companions.mjs:41-99`），默认装之后注释自相矛盾。
6. **重复重试层**：`llm-net-retry` 叠在 base 的 `llm-retry` 之上，需确认不会双重重试。
7. **`vault` 无消费者**：装上即空转，可接受但要记在发布说明里。
6. **模型表 4 项漂移：不补**（2026-11-24 用户拍板）。以 inproc 模板现状为准，`glm-5.4`、`mimo-v2.6-pro-ultraspeed`、`hy4-flash-free`、`qwen4-max` 从模型选择器消失；模板已有的 `glm-5.2` 保留。发布说明需提示这一点。

