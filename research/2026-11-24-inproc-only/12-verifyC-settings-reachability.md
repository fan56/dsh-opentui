# 12 — 实测 C：`/settings` 可达写面与「设置被覆盖」缺陷的真实范围

- 日期：2026-11-24
- 方式：独立打包制品（`packages/shell` → `aiwayds-dsh-opentui-0.18.3.tgz` → 独立 prefix）+ scratch `DSH_HOME`，tmux 抓帧；全程未碰 `~/.dsh`
- 目的：验证「`/settings` 写入下次启动被覆盖」在今天是否**可达**

## 结论先行

1. **今天无可达的丢失路径。** seam 的设置写白名单只有 3 命名空间（`bridge-settings-route.ts:26-31`）：
   - `subagent.{maxActiveSubagents,maxDepth}`
   - `permission.{defaultPreset,presets}`
   - `session-log-deepseek.enabled`

   而 `patch-runtime-merge` 的 carry 列表**恰好就是这三个字段**（`maxActiveSubagents` / `defaultPreset` / `session-log-deepseek.enabled`）。可达可写的键 = 已被 carry 的键 → 改完重启不会丢。

2. **`subagent.maxDepth` 在 UI 里是只读**：真实 TUI 显示 `read-only · pinned by the profile to 1 (safety constraint)`（Host 段第 2 行）。所以它虽然是 allow-list 之外的字段，但用户改不到。

3. **`dsh-approval-policy` 的 `windowSeconds` 目前也只读**：装上该插件后，Host 段出现 `dsh-approval-policy rev 0`，但详情写 `read-only · not consumed by this TUI`——因为白名单不含该命名空间。**所以 300 秒窗口今天根本设不进去**，缺口要等我们把白名单扩到 `dsh-approval-policy` 才打开。

4. 因此「顺手修只保留 3 个字段的缺陷」**不是修一个现存用户可见 bug**，而是**为即将扩大的写面做前提**。06 设计的价值从「修 bug」转为「扩写面 + 迁移正确性」，优先级不变但叙事要改。

## 证据

| 观察 | 证据 |
|---|---|
| 设置段清单与字段数 | Settings 段：General 12 / TUI-specific 18 / Host 17（装上 approval-policy 后从 16 增到 17）/ Models 1 / Plugins 1 / Agent presets 1 / Account 1 |
| 可写字段与只读标记 | Host 段：`✎ subagent.maxActiveSubagents 3`、`subagent.maxDepth 1`（详情 `read-only · pinned by the profile to 1`）、`✎ permission.defaultPreset workspace-write`、`✎ session-log-deepseek.enabled on`、`agent-default-model rev 0`、`llm-pi-ai rev 0` |
| approval-policy 只读 | 装上后 Host 段出现 `dsh-approval-policy rev 0`，详情 `read-only · not consumed by this TUI` |
| 白名单 | `packages/shell/src/client/bridge-settings-route.ts:26-31` |
| carry 列表 | `packages/shell/scripts/lib/patch-runtime-merge.mjs`（3 个字段） |

## 对设计/票面的影响

- **D1**：保留「整块 config 三方合并」的设计（扩写面必需），但把动机改为「为 windowSeconds / providers 等新写面做准备」，不再声称修现存 bug。
- **D2**：300 秒窗口要生效，**必须同时**扩 `bridge-settings-route.ts` 白名单 + `local-config-faces.ts` 的 `NS_VALUE_FIELDS`（两表需同步，文件内注释已注明），并让它进 carry。
- **D8/Q3**：`providers` 走 `settings.mutate` 的前提同样是这两张表扩容。
- **06 设计**：不变；实测 B 已证明「宿主整份重写 → 下一轮误判覆盖」与「非 carry 键丢失」两条机制成立。

## 未做

- `/login` 的 live 验证（需要真实 provider key，且会写 `provider-keys.json`）。静态结论仍成立：宿主从不读 `provider-keys.json`，key 必须改走 `credentials.set`（D8/Q2）。等 D8 实现后连同三入口一起做真机验收。
