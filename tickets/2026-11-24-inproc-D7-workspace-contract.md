# 子票：pnpm workspace 契约（P0-3）

- 类型：task（实现前必须先设计）
- 来源：oldfox 评审 P0-3
- 状态：批次 1/2/3 已完成（provisioner step `[3/8] workspace` / `ensureWorkspaceContract()`；门禁 `fresh-home-provision` 的 `workspace:contract-keys`、`workspace:no-deepseek-copy`、`workspace:idempotent` 与负向场景 `workspace-conflict`）
- 关联：[评审记录](2026-11-24-inproc-only-review-oldfox.md)、地图 `2026-11-24-inproc-only-map.md`

## Question

删掉老 provisioner 后，全新机器上谁负责写 `pnpm-workspace.yaml` 的安装契约？

## 事实

- `initProfile()` 建 profile 时写 `nodeLinker: hoisted` + `autoInstallPeers: false`，理由：hoisted 让所有插件共用安装层唯一 cordis 实例；pnpm≥10 只从 `pnpm-workspace.yaml` 读这两个设置（`dsh-app-boot/src/profile.ts:178-217`）。
- inproc provisioner 只 `mkdirSync(profileDir)`，从不写该文件（`provision-inproc-profile.mjs:1519`）。
- 后果链：全新 `DSH_HOME` → `dsh plugin add` 用默认 `autoInstallPeers: true` → companion 的 optional peers（registry/cron/vault/mcp-adapter/anysearch/topics-memory 六个已核）被自动装进 `profiles/*/node_modules/@deepseek-ai` → step 5 硬 fail（`:1478-1486`）；最坏是插件各自解析到自己的 cordis 副本。
- 为什么 CI 没抓到：pack 门禁里 `dsh` 不在 PATH，step 4 直接 WARN 跳过（`:1029-1046`、`ci.yml:235-236`）。
- 老机器上「运气好」：老 profile 由 dsh 的 `initProfile` 建过，workspace 文件本来就在。

## 要求

1. 新 provisioner 自己承担 workspace 契约（`packages: [.]`、`nodeLinker: hoisted`、`autoInstallPeers: false`），**或**先委托 `dsh plugin --profile <name> add` 完成建目录再写 manifest。
2. 新增门禁 `fresh-home-provision`：空 `DSH_HOME` + dsh 在 PATH + `--repair-bridge` → 断言 workspace 契约文件存在、无 `@deepseek-ai` 拷贝、10 个 companion bundle 全部挂载。
3. 该门禁不能只放静态 fixture —— fixture 必须是「跑真 provisioner 到 scratch HOME」（oldfox 对 D5 的同一条要求）。

## 决议

> **2026-11-24 实测打脸（重要）**：P0-3 的前提**在两个 pnpm 版本上都不复现**。打包制品 + 全新 HOME + 真 dsh 下，`pnpm-workspace.yaml` 缺失，但 optional peers **没有**被装进 profile（`node_modules` 只有 `@aiwayds`），step 5 通过、退出 0：
> - pnpm 10.33（`09-verifyA-fresh-provision.md`）：断点是 pnpm 不安装 optional peers（`pnpm.cjs:156266-156274,157216`）
> - pnpm 10.18.3（`11-verifyA2-pnpm1018.md`，CI 钉版）：同样 PASS；对照组证明 `nodeLinker: hoisted` **只**把 companion 从 `.pnpm` symlink 变成真实目录（记录在 `.modules.yaml`，不在 lockfile），不控制 optional peers 安装
>
> **结论：D7 从 P0 降级为「一致性/防御性」工作**——与 dsh `initProfile` 对齐、消除对 pnpm 默认值的依赖仍值得做，但**不阻塞开工**，不占门禁优先级。T5 可后移。

**设计稿已完成并通过 oldfox 终审（GO-WITH-CONDITIONS）**：`research/2026-11-24-inproc-only/07-workspace-contract-design.md`（文首有修订记录）。以下为终稿口径，取代早前草稿：

- 根因：`dsh plugin add` 只在 `package.json` 不存在时才调 `initProfile`（`dsh-plugin-manager/src/operations.ts:603-605`），而 provisioner step 2 先写了 manifest → workspace 契约永不生成。
- 契约由 provisioner 自己在 step 4 前写（`packages: [.]` + `nodeLinker: hoisted` + `autoInstallPeers: false`）。
- **状态判定只有三种**：缺失 → 写模板；存在且三键语义相等 → 通过；**其余（冲突/不可解析/部分）一律在装 companion 之前 fail-fast**，文案点名 workspace 并给两条指引（手改文件 / `--repair-bridge` 备份后整体重写）。不再有「语义合并」「部分态」「WARN 放行」。
- **修复 = 删 `node_modules` + `pnpm-lock.yaml` 后按契约重装**；取消 quarantine 隔离与 symlink 豁免（两者都会被 guard 的 `existsSync` 判据或 CI 的 `find -path '*@deepseek-ai*'` 命中）。
- 门禁 `fresh-home-provision`：空 scratch HOME + **独立打包制品**（`npm pack` 装到独立 prefix）+ 真 provisioner；PATH 只按命令作用域给第二个 pass，第一个 pass 加 `! command -v dsh` 冻结唯一覆盖；四组断言（契约/无拷贝/companion 三视图/二次幂等）。与 D5 共用同一 fixture helper。
- companion 版本在 CI 钉版（checked-in pins + opt-in env），不随 `latest` 漂移。
- 门禁命令中的 profile 名从常量取，改名落地前不硬编码。

