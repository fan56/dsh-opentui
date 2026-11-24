# 子票：迁移设计（旧 `opentui` / `opentui-inproc` → `opentui-monday`）

- 类型：task（设计稿；实施拆成阶段 1 的子任务）
- 阻塞方：D1（profile 名与配置落点已定）
- 证据：`01-provisioning.md`、`02-http-host-residual.md`、`05-companion-parity.md`；本机只读快照 2026-11-24

## Question

新版本首次启动时，如何把用户从旧 profile 无损搬到 `opentui-monday`？

## 一、迁移面清单（本机实测所得，不是推测）

| 项 | 现状（`~/.dsh`） | 迁移动作 | 冲突策略 |
|---|---|---|---|
| `profiles/opentui/config.json`（525B） | 键集合：`retentionDays`(14)、`theme`(carbonfox)、`skinMigration`、`slashUsage`、`footerHints`、`lang`(zh-CN)、`session` | **整份拷贝**到新 profile | 新文件已存在则按 marker 跳过（只迁一次） |
| `profiles/opentui/cordis.patch.yml`（19.9KB） | 3 个 `- insert:` 块（:346 tool-ask-user / :381 mcp-context7 / :401 append preset）+ `permission` 块（`presets` + `defaultPreset: danger-full-access`）+ 78 条模型条目 | **只做白名单抽取，禁止整段搬运**（见下「评审修正」）：可搬 `agent-default-model`、`subagent` 上限；`permission` / `llm-pi-ai` / append preset **不搬** | 抽取前把旧 patch 备份到 `<新profile>/.migrated-from/` |
| 旧 `permission.defaultPreset: danger-full-access` | 老 profile 是放开沙箱；新模板是 `workspace-write`（ADR-0011 硬化） | **不迁**：迁移不得静默把沙箱放宽；用户要放开就自己在 `/permission` 里改 | 发布说明提示「默认审批档位变严」 |
| 旧 `preset-opentui-append-system`（约 100 行 standard 副本 + `!!js`） | inproc 下从未生效；bridge 无 section 通道 | **不迁**，`.bak` 留底 | 若将来 `agentPresets` 回归，陈旧副本会 shadow 新预设 |
| 模型表 | 比新模板多 4 个 ID（`glm-5.4`/`mimo-v2.6-pro-ultraspeed`/`hy4-flash-free`/`qwen4-max`） | **不迁**（用户已定） | 发布说明提示选择器少 4 项 |
| provider 路由 / `apiKeyEnv` | 与新模板逐字等价（`05 §2`） | 不迁 | — |
| `provider-keys.json` | **不存在**（用户没用过 `/login` 存 key） | 存在时整份拷贝（0600） | 本机跳过 |
| `~/.dsh/.credentials.yaml`（559B） | home 级授权文件，**跨 profile 共享** | 不动 | 新 profile 直接可用 |
| `~/.dsh/sessions/` | 两 profile 共享 | 不动 | `/resume` 历史自动可见 |
| `~/.dsh/APPEND_SYSTEM.md` | home 级 | 不动 | inproc 下本就不生效（M3 未落地） |
| `keybindings.json` | 不存在 | 存在时拷贝 | — |
| `profiles/opentui`（52M）、`profiles/opentui-inproc`（2.3M） | 两代旧目录 | **保留原样，不删不改名** | 回退旧版可用；README 给手动清理指引 |
| `~/.dsh/opentui-clients/`、`opentui-host.idle.log` | 旧 HTTP 宿主产物 | 新版不读，保留 | — |

**结论**：真正的迁移载荷只有两件——`config.json` 一份 + 旧 patch 里少量用户意图行。不做 52M 目录搬运，也不做「就地改造」。

## 二、执行时序（首启 provision 阶段内，严格按序）

```
T0 检测     清点旧目录（opentui / opentui-inproc）、读 <新profile>/.migration.json
            marker 存在 → 跳过 T2/T3，只做幂等 provision
T1 先 provision 新 profile    manifest(bundles) → patch 托管段 → companions(10) 
                              → compatibility.json → bridge 拷贝
T2 再写用户段                config.json 拷贝（tmp+rename 原子）
                              patch 用户段合并（白名单抽取）
                              旧 patch 备份到 .migrated-from/
T3 写 marker                 .migration.json {from, at, version, digest}
T4 汇总一条 notice           迁了什么 / 没迁什么（模型 4 项）/ 旧目录位置
```

顺序不可换：provision 会重写托管段，用户段必须在之后写；反过来会被覆盖。

## 三、失败与半态

| 场景 | 行为 |
|---|---|
| T1 失败（pnpm 装不上、磁盘不足） | **fail-fast 启动失败**，带可执行提示（`--repair-bridge` / 检查磁盘）；不写 marker，下次重试；旧版本完全不受影响 |
| T2 中途失败 | 两个文件各自原子写；marker 未写 → 下次重跑；已拷贝文件按内容相等跳过 |
| 只读 home | 同 T1：fail-fast，不静默降级到旧 profile（新版不认旧名） |
| 用户手删新 profile | marker 随目录消失 → 下次重跑迁移，幂等安全 |
| 迁移后用户又改旧 patch | marker 已存在 → 不再读旧 profile，改动被忽略（发布说明写明） |

## 四、并发

- **两个客户端同时首启**：`provision.lock` 采用 06 修订后的新语义——**活持有者只按 pid 探活、永不按年龄判 stale**；等锁 30s（退避 50→500ms），超时 `exit 2`；`.provision.lock` 与宿主 `package.json.lock` 的边界见 06 §6.3。marker 作第二道闸。
- **旧版本客户端仍在跑**：它继续读写 `profiles/opentui`，迁移不碰该目录 → 无冲突；但 `sessions` writer lock 仍按原语义（`writer-held`，内核 flock 仲裁）。
- **旧 inproc 宿主残留进程**：新客户端自起新宿主，不接管旧进程；不主动 kill（避免误杀别的客户端）。`--force` 才按 D3 的击杀清单处理，且先杀 provisioner 再清锁（N3）。

## 五、回滚

- **新版 → 旧版**：旧版只认 `profiles/opentui`，目录未被改动，直接可用；代价是迁移后在新版里做的设置改动旧版看不到。
- **反向迁移**（新配置 → 旧 profile）：不做，只在文档给手动拷贝指引。

## 六、真机验证矩阵

| 场景 | 期望 |
|---|---|
| 干净 home（无任何 profile） | 直接创建 `opentui-monday`，不走迁移分支 |
| 只有 `opentui` | 迁移成功：主题 carbonfox、中文、`/resume` 历史在 |
| 只有 `opentui-inproc`（从 0.27.x 升上来） | **有配置可迁**（终审 P0-7 修正）：抽取 carry-enabled 行的 literal 用户值（`session-log-deepseek.enabled`、`subagent.maxActiveSubagents`、`subagent.maxDepth`）；`permission.defaultPreset` 在当前 patch 是 `!!js` 模板表达式 → 视为模板权威、不迁 |
| 两个都有 | 以 `opentui` 为源（它承载客户端配置 `config.json`），`opentui-inproc` 只补 patch 里的 literal 用户值；同键冲突时 `opentui` 优先 |
| 连续启动 3 次 | marker 生效，patch/config 不被覆盖 |
| 迁移后 `/settings` 改主题 → 重启 | 改动存活（依赖 D1 的托管/用户段协议） |
| 迁移后回退旧版 | 能启动，配置是旧的 |

## 七、风险

1. **用户段边界划错** → 用户设置丢。缓解：迁移前备份旧 patch；白名单只取「模板没有 + 明确是用户选择」的键。
2. **config.json 键漂移**（新版客户端不认旧键）→ 白名单校验 + 未知键保留并告警，不静默丢。
3. **companion 安装失败**被 WARN 吞掉 → 首启必须把「装了哪些、哪些失败」写进 notice，而不是只打日志。
4. **52M 旧目录长期占盘** → README 给清理指引，不自动删（里面可能有用户手写内容与备份）。

## 八、评审修正（oldfox P0-4 / P1-7，2026-11-24）

- **禁止「老 patch 整段转用户段」**：cordis patch 的合并是 `target[key] = value` **整块替换**，不是深合并（`cordis-plugin-include/src/patch.ts:95-104`）。整段搬运的后果：
  - 老 `permission` 行把模板的 `workspace-write` 覆盖回 `danger-full-access`（静默放宽沙箱）；
  - 老 `llm-pi-ai` 行把模板模型表整体替换（D2「以模板为准」当场失效）；
  - 重复 `- insert:` id（`mcp-context7`、`tool-ask-user`）变不可寻址（`dsh-config-editor/src/index.ts:38-43` 把重复 id 行从 `entries()` 剔除）。
- 因此本设计坚持**新目录 + 白名单抽取**，旧 patch 只读、只备份。这条也是选新名相对「就地改造」的第二个收益。
- **依赖剪枝**（若未来改回就地改造才适用）：老 profile 19 个旧依赖含 `link:/Users/qingguee/repo/dsh-workflow`，转换时必须备份后剪枝，否则后续任何 `pnpm` 会整批失败。
- **顺序**：转换必须在第一次写新 patch 之前完成，且可重入；`marker` 写在转换之后。
- **写权时序**：`config-editor` 整文件重写（锁 `profiles/<p>/package.json`）与 provisioner 写可能交错；约束为「启动期 provisioner 写、运行期只允许宿主写、客户端本地面只读」。
