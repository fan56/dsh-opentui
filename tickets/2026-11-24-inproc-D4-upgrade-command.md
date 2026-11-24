# 子票：`upgrade` 子命令去向

- 类型：grilling（需用户拍板，可与 D3 合并决策）
- 阻塞方：D2 遗留插件怎么办
- 关联：地图 `2026-11-24-inproc-only-map.md`；证据 `research/2026-11-24-inproc-only/01-provisioning.md` §三.3–4

## Question

`dsh-opentui upgrade` 现在只服务老 profile（`upgrade.mjs:55-61,84,972,1133`，`PROFILE` 取自 `provision-plan.mjs:15`）。删掉老 profile 后它退役还是改造？

## 候选

| 方案 | 做法 | 影响 |
|---|---|---|
| A. 退役 | 删除 `upgrade` 子命令、`upgrade.mjs`、`lib/upgrade-plan.mjs`、`provision-plan.mjs` 的 pin 表 | 用户失去「一条命令升级受管插件」；inproc companion 升级目前只在 provision 时按 `npm view dist-tags` 自动做（`inproc-companions.mjs:199-213`），且明确**不降级** |
| B. 改造为 inproc companion 升级 | `upgrade` 改为对 companion catalog 做「检查新版本 + 装 + 写 manifest」，沿用 override/备份/回滚机制 | 保留用户习惯；需要把 override/backup 机制从老 profile 迁到 inproc |
| C. 先退役、后期再评估 | 随 D3 一起删；inproc 升级继续只靠 provision 自动跟随 | 最小改动；升级变成「重启即跟随」，没有显式命令 |

## 推荐

B 或 C，取决于是否还在意「显式升级」。历史事实：opentui profile 的插件版本被 pin 在 `provision-plan.mjs`，手动升级会被写回（0.9→0.10 的旧账）；inproc 侧不 pin 插件版本、只做不降级跟随，已经不需要 override 机制。按这个方向，C 更省事；若产品上要保留 `upgrade`，选 B。

## 决议记录

**2026-11-24 用户拍板：退役。** 删除 `upgrade` 子命令、`upgrade.mjs`、`lib/upgrade-plan.mjs`、`provision-plan.mjs` 的 pin 表；插件升级改为「启动时按 provision 自动跟随新版本、不降级」（`inproc-companions.mjs:185-213` 现有语义）。

