# 子票：真机门禁与老目录处置

- 类型：grilling（需用户拍板）
- 阻塞方：D1、D2
- 关联：地图 `2026-11-24-inproc-only-map.md`；证据 `research/2026-11-24-inproc-only/03-references-and-gates.md` §4–§6

## Question

删掉老 profile 后，真机门禁的 seed 从哪来？本机 52M 的老目录怎么处置？

## 门禁现状

- **不受影响**：默认 CI `test`、`pack-cold-start`（只用 `opentui-inproc`，`ci.yml:237,294`）、`00-pack-gate.sh`、release.yml。
- **会失效**：opt-in `real-client` job（`ci.yml:129-140`）、`scripts/real-client-gate.sh`（`§4`）、8 个 `verify/*` 脚本、e2e family seed（`e2e/families/lib/family-lib.sh:39`）、`e2e-client.mjs`/`e2e-sweep.mjs`、`scripts/test-tier.mjs` 的 ui/e2e 档。
- 后果：CI 全绿但真机覆盖为零（门禁空洞）。

## 候选

| 方案 | 做法 |
|---|---|
| A. 改 seed 源 | 所有真机脚本改为「inproc profile + 新配置目录（D1 选定）」seed；`real-client` job preflight 改判 inproc |
| B. 保留老 profile 仅作 fixture | 仓库脚本自带一份静态 fixture（不读用户 `~/.dsh`），真机门禁与用户环境解耦 |
| C. 暂时豁免 | 明确标注这些门禁本版不跑，登记为技术债 |

## 老目录处置（本机/用户机）

`~/.dsh/profiles/opentui` = 52M、20 bundles、5 份 patch 备份。
候选：① 迁移完配置后提示用户可删；② 自动重命名归档（如 `opentui.retired-<ts>`）；③ 保留只读不动。

## 推荐

门禁选 A + B 组合（脚本自带 fixture，真机验证不再依赖用户目录）；老目录选 ②：自动归档而非删除，避免误删 provider keys。

## 决议记录

**2026-11-24 用户拍板：门禁 seed 用「脚本自带固定假数据」**——仓库内放 fixture，真机门禁不再读 `~/.dsh` 里的真实 profile，换机器也能跑。

### 评审修正（oldfox P0-5 / P1-4）

1. **「默认 CI 不受影响」只在「只删不改名」前提下成立**。改名会立刻打断：`ci.yml:237`（`PROFILE_DIR=.../profiles/opentui-inproc`）、`ci.yml:317-320`（扫 `@deepseek-ai` 拷贝）、`scripts/verify-bridge-handshake.mjs:31`（硬编码 `--profile opentui-inproc`）。
2. **fixture 不能是「静态假 profile」**：pack 冷启动门禁里 `dsh` 不在 PATH、step 4 直接 WARN 跳过（`ci.yml:235-236`），10 个默认 companion 的真实安装路径零覆盖。fixture 必须是「**跑真 provisioner 到 scratch HOME**」，否则会掩盖 P0-3 那一类问题。
3. **改名清扫清单以机器产物为准**，票面手写清单漏了：`scripts/verify-capcontract-roundtrip.mjs:67`、`verify-s3-push.mjs:42`、`verify-s1-model.mjs:49`、`verify-s2-credentials.mjs:54`、`verify-sk-keymap-ans.mjs:62`、`e2e/families/lib/bridge-families.mjs:35`、`verify/agents-mount-repro.mjs:704`、`ledger/ledger.json` 与 `ledger/provenance.json`。
4. **fixture 的两个约束必须同时满足**（消解票面内部矛盾）：① 不读用户 `~/.dsh`（你的原始决议）；② 不是静态假 profile，而是**跑真 provisioner 到 scratch HOME**，且用**独立打包制品**（`npm pack` 装到独立 prefix）——源码 launcher 全绿不等于安装版可用。D5 与 D7 共用同一 fixture helper。
5. **负向路径也要门禁**（终审 N7）：CI 现在每次都传 `--repair-bridge`，不带 flag 的 fail-fast 零覆盖，需补负向用例。

老目录处置：`profiles/opentui`（52M）与 `profiles/opentui-inproc`（2.3M）**都保留原样**（不删不改名），README 给清理指引；`profiles/opentui` 是回退旧版的唯一依据。

