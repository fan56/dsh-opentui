# Proof Report: inproc-only-refactor / 证明报告：inproc-only-refactor

Gate: PASS
Profile: FEATURE
Change ref: 9b06e44 (9b06e44c79dfcf395c903bc0deef4feb73ddd432)
Result: PASS
Expected registered (UTC): 2026-11-24T16:45Z
Assertion total N: 8
Working tree: tracked clean; .proof/ .v2c/ .video_agent/ untracked

Acceptance target (user verbatim): "完成这个改造，最后用 skill proof it works 证明真的完成了"

登记说明：A1–A6 的 expected 于 2026-11-24T15:58Z 登记；A7 作为任务扩展于 16:29Z 登记；A1–A7 的最终判据于 16:45Z 汇总登记；A8 于 16:47Z 登记，早于 16:50Z 的真机重跑冒烟。self-declared preregistration，无 hash 或落盘仪式。

- Task / 任务：单 profile（opentui-monday）收敛、pnpm workspace 契约强制、一次性旧 profile 迁移、退役 force/yes 并改为 repair-bridge、删除 HTTP 宿主面，最后用 proof-it-works 证明。
- Change ref 说明：9b06e44 是包含被验证改动的提交；本报告提交是另一提交。A8 所依赖的 P0 修复位于同分支提交 7ed13aa，打包件由 9b06e44 构建。
- Changed behaviors / 改动行为：
  - usage 生成器增加 --repair-bridge 并移除退役 flag 帮助行 -> A1；baseline: main 153c8ce 的既有 checkout。
  - ensureWorkspaceContract 失败即拒绝 + repair 备份重写 -> A4；baseline: 同一 checkout。
  - 旧 opentui-inproc patch 一次性迁入 opentui-monday（marker + 备份，旧目录只读）-> A3；baseline: 同一 checkout。
  - --force/--yes 降级为 deprecated no-op，--provider 不再是 launcher 已知 flag -> A5；baseline: 同一 checkout。
  - HTTP 宿主面 5 处死引用清理 -> A6；baseline: 同一 checkout（00 号 B4）。
  - default profile 常量改名并贯通 -> A2/A3。
  - 全量门禁覆盖 packages/shell/src、packages/shell/scripts、packages/bridge/src 与 tui-base 回归 -> A7。
  - v2-entry 首屏 profileName 绑定修复 -> A8；反向前置为 09 号旧版崩溃日志。
  Baseline method: main 153c8ce 的既有 checkout /Users/qingguee/repo/dsh-opentui（node_modules 已存在），未执行 git worktree add；同一批命令结果存于 00-pre-change.log。
- Touched paths / 本次改动：packages/shell/bin/lib/launcher.mjs (formatUsage/validateLauncherArgs)；packages/shell/bin/dsh-opentui.mjs (flag handling)；packages/shell/scripts/lib/profile-name.mjs (DEFAULT_PROFILE)；packages/shell/scripts/lib/migration.mjs (planMigration)；packages/shell/scripts/lib/migration-io.mjs；packages/shell/scripts/provision-inproc-profile.mjs (ensureWorkspaceContract/assertWorkspaceContract/workspaceContractError/migration wiring)；packages/shell/src/client/token-estimate.ts、packages/shell/test/bridge-session-seam.test.ts、packages/shell/test/m3-ride-isolation.test.ts、packages/tui-base/src/routes/session/slash-usage.ts、packages/tui-base/test/settings-panel-panelkit.test.tsx（9b06e44 的 5 处清理）；packages/tui-base/examples/v2-entry.tsx (profileName binding)；packages/tui-base/test/v2-entry-profile-name.test.ts；packages/shell/test/provision-inproc-migration.test.ts。
- Evidence directory / 证据目录：.proof/inproc-only-refactor/

## Acceptance assertions / 验收断言

| id | assertion | expected | pass criterion (checkable) | changed path (file:function/route) | level required | evidence file | depends on |
|----|-----------|----------|---------------------------|------------------------------------|----------------|---------------|------------|
| A1 | 打包安装后 CLI 版本与帮助可用 | PACK_EXIT=0；INSTALL_EXIT=0；dsh-opentui 0.18.3；VERSION_EXIT=0；HELP_EXIT=0；--repair-bridge 命中 3 次 | npm pack 退出 0；npm install -g --prefix /private/tmp/dsh-acceptance3/prefix /private/tmp/dsh-acceptance3/aiwayds-dsh-opentui-0.18.3.tgz 退出 0；安装后 bin 的 --version 退出 0 且 stdout 为 dsh-opentui 0.18.3；--help 退出 0 且 grep -c -- --repair-bridge 输出 3 | packages/shell/bin/lib/launcher.mjs (formatUsage，usage 构造器) | Artifact | 17-pack-install-rerun2.log | |
| A2 | 干净 HOME 只装新 profile 且 workspace 契约正确 | PROVISION_EXIT=0；第 8/8 步 shim 落在 opentui-monday；packages=["."] / nodeLinker="hoisted" / autoInstallPeers=false；profiles 仅 opentui-monday；legacy 0；@deepseek-ai 0 | 全新 scratch HOME 上运行安装版 provisioner 退出 0；解析后 YAML 三键等于上述值；find profiles 顶层目录集合等于 opentui-monday；opentui-inproc 目录计数 0；profile node_modules 下 @deepseek-ai 目录计数 0 | packages/shell/scripts/provision-inproc-profile.mjs (ensureWorkspaceContract) | Artifact + reverse | 18-fresh-provision-rerun2.log, 25-pre-change-rerun.log, 00-pre-change.log（首次尝试记录（含未执行 grep）） | A1 |
| A3 | 一次性迁移携带三个叶子且旧目录字节与 mtime 不变 | 新 patch 第 434/435/477 行为 maxActiveSubagents: 7 / maxDepth: 3 / enabled: false；.migration.json 的 from 为 opentui-inproc 且 migrated 含三路径；备份 cmp EXIT=0；旧文件 stat 与 sha256 前后相同 | grep 命中上述三个行号；marker JSON 的 from 数组等于 opentui-inproc 且 migrated 含 subagent.maxActiveSubagents、subagent.maxDepth、session-log-deepseek.enabled；cmp 旧文件与备份退出 0；迁移前后 stat 的 mtime 与字节数相同且 sha256 相同 | packages/shell/scripts/lib/migration.mjs (planMigration)；packages/shell/scripts/lib/profile-name.mjs (DEFAULT_PROFILE) | Artifact + reverse | 19-migration-rerun2.log, 00-pre-change.log（反向口径：00 的 B1 只证明旧代码产出旧 profile、无 opentui-monday/无迁移 marker；25 补充旧代码路径；未在同一输入上跑旧代码，反向依据是旧代码无目标 profile/无 marker 路径） | A1 |
| A4 | 坏 workspace 契约被拒绝并可由 repair 恢复 | NO_REPAIR_EXIT=1；stderr 含 nodeLinker expected hoisted, got string "isolated" 与两条 Repair 指引；REPAIR_EXIT=0；.bak 文件与 repair 前参考文件 cmp EXIT=0；重写后三键正确 | 不带 --repair 运行退出 1 且 stderr 同时含文件名、nodeLinker、expected hoisted、got string "isolated"、Repair by hand、Repair with backup；带 --repair 运行退出 0；存在 pnpm-workspace.yaml.bak-* 文件；cmp 参考文件退出 0；重写后 YAML 三键等于 A2 | packages/shell/scripts/provision-inproc-profile.mjs (ensureWorkspaceContract repair 分支) | Artifact + reverse | 20-negative-workspace-rerun2.log, 25-pre-change-rerun.log, 00-pre-change.log（首次尝试记录（含未执行 grep）） | A1 |
| A5 | 退役 flag 语义正确 | PROVIDER_EXIT=2 且 unknown option '--provider=x'；FORCE_HELP_EXIT=0 且 stderr 中 --repair-bridge 计数 1；YES_EXIT=2 且 reserved 计数 0 | --provider=x 退出 2 且 stderr 逐字含 unknown option '--provider=x'；--force --help 退出 0 且 force.err 中 --repair-bridge 计数 1；--yes 退出 2 且合并输出中 reserved 计数 0 | packages/shell/bin/dsh-opentui.mjs (flag handling) | Artifact + reverse | 21-negative-flags-rerun2.log, 25-pre-change-rerun.log, 00-pre-change.log（首次尝试记录（含未执行 grep）） | A1 |
| A6 | 退役 HTTP 宿主面无残留 | 两条 git grep 均 exit 1 且零输出；tarball 33 项中六个退役名字 TAR_GREP_EXIT=1 | git grep -n -E ensureV2Host 或 RemoteHostSession -- packages scripts e2e verify 输出为空且 exit 1；git grep 六个退役文件名在同样路径范围输出为空且 exit 1；tar -tzf 的 33 项经同一 grep 零命中且 exit 1 | packages/shell/src/client/token-estimate.ts (estimateTextTokens 注释)；packages/shell/test/bridge-session-seam.test.ts (footer telemetry parity 注释)；packages/shell/test/m3-ride-isolation.test.ts (文件头注释)；packages/tui-base/src/routes/session/slash-usage.ts (模块头注释)；packages/tui-base/test/settings-panel-panelkit.test.tsx (fakeSeam 注释) | Artifact + reverse | 22-retired-surface-rerun2.log, 00-pre-change.log | |
| A7 | 全量测试、类型检查、构建与契约门禁 | 3241 pass / 0 fail / 3 skip；typecheck 仅 tui-base 58 且与 main 相同；typecheck:entry、build、capcontract exit 0；fresh-home no-dsh 3 PASS / 6 NOT RUN | bun test 五包合计 fail=0 且 skip=3；pnpm -r typecheck 非零诊断仅 tui-base 58 条且与 14 号日志的 main 计数一致；typecheck:entry、build-client、check-capcontract 退出 0 且 capcontract 22 PASS 0 FAIL；fresh-home no-dsh 退出 0 且 3 checks PASS 6 NOT RUN | packages/tui-base/test/v2-entry-profile-name.test.ts (executed)；packages/shell/test/provision-inproc-migration.test.ts:497-536 | Artifact | 23-gates-rerun2.log, 14-main-typecheck.log | |
| A8 | 真机安装版能启动并渲染首屏 | 3s 与 60s 帧 plain 2910 / -e 5286 / raw 8376 字节；命中 dsh-opentui 和 deepseek；28 次轮询 session alive；profiles 计数 1（精确数字 2910/5286/8376 来自 24 号重跑；09 是修复前崩溃版；A8 登记时间 16:47 早于 24 号 UTC_START 16:50） | 两帧 plain_nonspace_chars=2910、e_nonspace_chars=5286、raw_bytes=8376；已知字符串命中 dsh-opentui 和 deepseek；5s 至 61s 的 28 次轮询均为 session alive；find profiles 顶层仅 opentui-monday 且计数 1 | packages/tui-base/examples/v2-entry.tsx (profileName binding) | Artifact + reverse | 24-tui-smoke-rerun2.log, 09-tui-smoke.log | A1 |

映射说明：任务映射中 A1 的 usage 构造器写作 buildUsage；packages/shell/bin/lib/launcher.mjs 中实际导出名是 formatUsage（第 298 行），表格按真实函数名填写，指向同一处 diff。depends on 图为 A2/A3/A4/A5/A8 指向 A1，A6/A7 无前置，无环。expected 与 pass criterion 为同一条件的两侧表述，未在运行后改写。反向机器证据以 25-pre-change-rerun.log 为准；00-pre-change.log 仅作首发记录，标注为「首次尝试记录（含未执行 grep）」，不单独作为断言行；09-tui-smoke.log 只作为 A8 的反向前置。

## Evidence index / 证据清单

| file | level | what it captures | captured at (exact command/action + time) | redaction | sha256 |
|------|-------|------------------|-------------------------------------------|-----------|--------|
| 00-pre-change.log (9523 bytes) | Artifact (baseline) | 基线已由 25 号完整重采，00 保留为首次尝试记录（含未执行 grep） | main checkout 上同批 provisioner/bin/git grep 命令，scratch HOME /private/tmp/dsh-acceptance/prechange，2026-11-24T15:59:10Z | n/a | 58e3904c7e0f3b9162666071e4c06782b04f7b13c16e44ba2f6d19b89faceb54 |
| 09-tui-smoke.log (13749 bytes) | Artifact (reverse for A8) | 修复前真机冒烟：0 字符帧、ReferenceError profile | 安装版 6a18606 的 tmux 真 TTY 冒烟，2026-11-24T16:30:20Z 至 16:31:21Z（该文件在引用前被同一 harness 的后续运行覆盖过，以当前内容为准） | n/a | fd0451671b726935e4f647e5332f7664e290cffa4464154132ba4b2822d80c80 |
| 14-main-typecheck.log (22285 bytes) | Artifact (baseline for A7) | main 153c8ce 的 typecheck 错误计数 58 | /Users/qingguee/repo/dsh-opentui 上 pnpm -r typecheck，2026-11-24T16:31:55Z | n/a | 6a06a0b3043fdbcb2f8d1f06d9b32711fcb0a5c2d727481cf8a5a1031cf5ae32 |
| 17-pack-install-rerun2.log (6424 bytes) | Artifact | A1 的 pack、全局安装、版本、帮助 | npm pack 到 /private/tmp/dsh-acceptance3，npm install -g --prefix /private/tmp/dsh-acceptance3/prefix，安装后 bin 的 --version 与 --help，2026-11-24T16:46:12Z | n/a | 12c3048b0f02d1c5123af180dd1238429e804b114dd926079b4208700c058c6b |
| 18-fresh-provision-rerun2.log (4944 bytes) | Artifact | A2 的干净 HOME 供给、三键、profile 集合、@deepseek-ai 计数 | 安装版 provisioner 加 find、cat、以绝对路径 import yaml 解析，2026-11-24T16:46:22Z | n/a | 902d2aebf8e4e2435f54770e726dcf92e17f07e8e29076ff8502bb3ff90951ca |
| 19-migration-rerun2.log (5991 bytes) | Artifact + reverse | A3 的三叶、marker、备份字节相等、旧文件前后 stat/sha | 播种旧 patch 后运行安装版 provisioner，加 grep、cat、cmp、stat、shasum，2026-11-24T16:46:27Z | n/a | 43ccc40a50ff3cf90ad7e1a5a59867f9cf564e74834297d91a2f656d3506715c |
| 20-negative-workspace-rerun2.log (6510 bytes) | Artifact + reverse | A4 的无 repair 拒绝与 repair 备份重写 | 播种坏契约、cp 参考文件、两次运行 provisioner、cmp、shasum、cat，2026-11-24T16:46:32Z | n/a | f6bd02c7b13c9fb3c85a03bfe99153146b260dd98ed44c6cbba6964a66801cee |
| 21-negative-flags-rerun2.log (5518 bytes) | Artifact + reverse | A5 三条 flag 命令的退出码与 stderr | 安装版 bin 的 --provider=x、--force --help、--yes，2026-11-24T16:46:37Z | n/a | 7ac878f09b2cad41d78febb2d8b0ffca7222054234e045f0c67745f4fc10a526 |
| 22-retired-surface-rerun2.log (1530 bytes) | Artifact + reverse | A6 的两条 git grep 与 tarball 六名检索 | git grep 两条、tar -tzf 加 grep 与 wc，2026-11-24T16:46:41Z | n/a | 7d56b585f975ab726952c1a1a008edccee2e98292c665f87277cc1e6da8beb88 |
| 23-gates-rerun2.log (439214 bytes) | Artifact | A7 的五包 bun test、typecheck、entry、build、capcontract、fresh-home | 串行全量门禁，HEAD 9b06e44，2026-11-24T16:45:40Z 至 16:47:12Z | n/a | c6b39896290ffd97231a16aadc8bd2aedf824eb4423239a17d7e1ccd2b285cf6 |
| 24-tui-smoke-rerun2.log (32156 bytes) | Artifact + reverse | A8 的 3s/60s 帧、28 次轮询、退出手势观察、profile 计数 | 安装版真 TTY tmux 冒烟，HEAD 9b06e44，2026-11-24T16:50:10Z 至 16:56:28Z | n/a | 372ab6e46c58448c95f67183be5839786d0902710963b6812c43375f1db52d65 |
| 25-pre-change-rerun.log (40755 bytes) | Artifact (baseline, complete re-collection) | 153c8ce 的 B1 旧 profile/无 opentui-monday/无迁移 marker、B3 坏 workspace 被接受、B4 退役符号存在、B2 旧 launcher 行为 | 153c8ce 的 detached worktree /private/tmp/dsh-prechange-25 上四条完整命令，scratch HOME /private/tmp/dsh-acceptance3/prechange/25-b1-20261124T181644Z，2026-11-24T18:16:44Z | n/a | aa1b93a3b22d651616ede97587cb431a1e7f75e08f7b402ff468157c03233666 |

反向机器证据以 25 为准，00 仅作首发记录。

所有 12 个文件均为本任务采集的完整原始 stdout/stderr，采集后未手工编辑（09 号被同一 harness 的后续运行覆盖，以当前内容为准，见索引）；无令牌、口令、密钥需脱敏，故 redaction 全为 n/a。24 号日志按原样保留终端帧的 ANSI/NEL 字节，需控制字符过滤工具阅读；下文只引用其逐字文本行。23 号与 14 号作为完整原始证据直接引用，不重复整篇粘贴。以下每个代码块均为对应文件的逐字行，标注了来源文件与 sha256，完整内容见索引。25-pre-change-rerun.log:36 的裸 `EXIT=0` 是 B1 段头 echo 的退出码，紧跟的 :37 才是 B1 命令；不是省略命令。

### First-attempt verbatim lines: 00-pre-change.log（首次尝试记录（含未执行 grep））

```
$ cd /Users/qingguee/repo/dsh-opentui && git rev-parse HEAD
153c8cedfa25be5242fc9cd9f04a275ec5dbc7d5
GIT_EXIT=0
--- BASELINE B1: clean HOME provision -> OLD profile name 'opentui-inproc' ---
/private/tmp/dsh-acceptance/prechange/home/profiles/opentui-inproc
PROVISION_EXIT=0
--- BASELINE B2: old launcher --force/--provider semantics ---
$ DSH_HOME=/private/tmp/dsh-acceptance/prechange/home node packages/shell/bin/dsh-opentui.mjs --provider=x --version
dsh-opentui 0.18.3
PROVIDER_VERSION_EXIT=0
  --force                    reset the singleton host before starting (needs --yes if clients are live; no-op under --dry-run)
FORCE_HELP_EXIT=0
--- BASELINE B3: pre-change provisioner has NO workspace contract guard ---
nodeLinker: isolated
autoInstallPeers: true
BAD_WS_PROVISION_EXIT=0
--- BASELINE B4: pre-change source HAS retired symbols (reverse for A6) ---
packages/shell/src/client-entry.tsx:105:	ensureV2Host,
GITGREP_EXIT=0
```

### Decisive verbatim lines: 09-tui-smoke.log

```
UTC=2026-11-24T16:30:20Z
REPO=/Users/qingguee/repo/dsh-opentui-wt-inproc-only HEAD=6a18606816482ab5c562a9fe0dde49bcc78dc2bc
[frame-01] UTC=2026-11-24T16:30:23Z elapsed=3s pane_dead=n/a raw_bytes=0 plain_nonspace_chars=0 matched_ui=NONE
[frame-02] UTC=2026-11-24T16:31:20Z elapsed=60s pane_dead=n/a raw_bytes=0 plain_nonspace_chars=0 matched_ui=NONE
[v2 render error] ReferenceError: profile is not defined
																						profileName: profile,
P1 CONCLUSION: FAIL — no non-empty UI rendered within 60s.
```

### Decisive verbatim lines: 14-main-typecheck.log

```
$ git -C /Users/qingguee/repo/dsh-opentui rev-parse HEAD
153c8cedfa25be5242fc9cd9f04a275ec5dbc7d5
HEAD_EXIT=0
--- step 3: count 'error TS' ---
$ grep -c "error TS" /private/tmp/dsh-acceptance/a7-main/typecheck-full.log
58
COUNT_EXIT=0
```

### Decisive verbatim lines: 17-pack-install-rerun2.log

```
Change ref: 9b06e44c79dfcf395c903bc0deef4feb73ddd432
PACK_EXIT=0
$ npm install -g --prefix /private/tmp/dsh-acceptance3/prefix /private/tmp/dsh-acceptance3/aiwayds-dsh-opentui-0.18.3.tgz
added 106 packages in 3s
INSTALL_EXIT=0
$ HOME=/private/tmp/dsh-acceptance3/scratch-home DSH_HOME=/private/tmp/dsh-acceptance3/scratch-home/dsh /private/tmp/dsh-acceptance3/prefix/bin/dsh-opentui --version
dsh-opentui 0.18.3
VERSION_EXIT=0
HELP_EXIT=0
$ grep -c -- --repair-bridge /private/tmp/dsh-acceptance3/a1-help.out
3
GREP_EXIT=0
```

### Decisive verbatim lines: 18-fresh-provision-rerun2.log

```
PROVISION_EXIT=0
PARSED packages=["."]
PARSED nodeLinker="hoisted"
PARSED autoInstallPeers=false
PARSE_EXIT=0
$ find /private/tmp/dsh-acceptance3/a2/home/profiles -mindepth 1 -maxdepth 1 -type d | sort
/private/tmp/dsh-acceptance3/a2/home/profiles/opentui-monday
FIND_EXIT=0
$ find /private/tmp/dsh-acceptance3/a2/home/profiles -mindepth 1 -maxdepth 1 -type d -name opentui-inproc | wc -l
       0
FIND_LEGACY_EXIT=0
$ find /private/tmp/dsh-acceptance3/a2/home/profiles/opentui-monday/node_modules -type d -name @deepseek-ai | wc -l
       0
DEEPSEEK_COUNT_EXIT=0
```

### Decisive verbatim lines: 19-migration-rerun2.log

```
STAT_BEFORE_EXIT=0
dsh-opentui(inproc): 迁移完成：迁入 3 项，丢弃 0 项，备份 1 份。
PROVISION_EXIT=0
$ grep -nE maxActiveSubagents:\ 7|maxDepth:\ 3|enabled:\ false /private/tmp/dsh-acceptance3/a3/home/profiles/opentui-monday/cordis.patch.yml
434:    maxActiveSubagents: 7
435:    maxDepth: 3
477:    enabled: false
GREP_EXIT=0
{
  "from": [
    "opentui-inproc"
  ],
  "at": "2026-11-24T16:46:27.680Z",
  "version": "0.18.3",
  "digest": "d4a0122ecb2867499db383cbbb2c48e0619362469f9d65a3cfa684c04620c3ac",
  "migrated": [
    "subagent.maxActiveSubagents",
    "subagent.maxDepth",
    "session-log-deepseek.enabled"
  ],
  "dropped": []
}
CAT_MARKER_EXIT=0
$ cmp /private/tmp/dsh-acceptance3/a3/home/profiles/opentui-inproc/cordis.patch.yml /private/tmp/dsh-acceptance3/a3/home/profiles/opentui-monday/.migrated-from/opentui-inproc-cordis.patch.yml
CMP_EXIT=0
STAT_AFTER_EXIT=0
SHA_AFTER_EXIT=0
```

### Decisive verbatim lines: 20-negative-workspace-rerun2.log

```
NO_REPAIR_EXIT=1
dsh-opentui(inproc): FAIL — /private/tmp/dsh-acceptance3/a4/home/profiles/opentui-monday/pnpm-workspace.yaml: nodeLinker — expected hoisted, got string "isolated"
Diagnosis: /private/tmp/dsh-acceptance3/a4/home/profiles/opentui-monday/pnpm-workspace.yaml: nodeLinker — expected hoisted, got string "isolated"; refusing to start with a conflicting workspace contract.
Repair by hand: edit /private/tmp/dsh-acceptance3/a4/home/profiles/opentui-monday/pnpm-workspace.yaml and set nodeLinker to hoisted; provisioning left the file untouched.
Repair with backup + rewrite: run `dsh-opentui --repair-bridge` (backs up a conflicting /private/tmp/dsh-acceptance3/a4/home/profiles/opentui-monday/pnpm-workspace.yaml to /private/tmp/dsh-acceptance3/a4/home/profiles/opentui-monday/pnpm-workspace.yaml.bak-<timestamp>, then rewrites the managed template).
REPAIR_EXIT=0
$ cmp /private/tmp/dsh-acceptance3/workspace-bad-reference.yaml /private/tmp/dsh-acceptance3/a4/home/profiles/opentui-monday/pnpm-workspace.yaml.bak-1795538792428
CMP_EXIT=0
nodeLinker: hoisted
autoInstallPeers: false
CAT_EXIT=0
```

`.bak-<timestamp>` 来自程序输出，原样引用，非报告占位符。

### Decisive verbatim lines: 21-negative-flags-rerun2.log

```
PROVIDER_EXIT=2
dsh-opentui: unknown option '--provider=x'
FORCE_HELP_EXIT=0
dsh-opentui: --force is deprecated and does nothing in this build; run --repair-bridge to clear stale instances. Removed in the next minor release.
$ grep -c -- --repair-bridge /private/tmp/dsh-acceptance3/a5/force.err
1
REPAIR_BRIDGE_COUNT_EXIT=0
YES_EXIT=2
$ grep -ci reserved /private/tmp/dsh-acceptance3/a5/yes.out
0
RESERVED_COUNT_EXIT=1 (1 = zero matches = expected)
dsh-opentui: --yes is only meaningful together with --force.
YES_CAT_EXIT=0
```

### Decisive verbatim lines: 22-retired-surface-rerun2.log

```
NOTE: the round-3 grep list below has SIX names (host-launch, watchdog-cli, idle-reaper, remote-host-session, e2e-client, e2e-sweep) even though the task text says 'five'; all six are searched verbatim, no narrowing.
$ cd /Users/qingguee/repo/dsh-opentui-wt-inproc-only && git grep -n -E ensureV2Host|RemoteHostSession -- packages scripts e2e verify
GITGREP1_EXIT=1 (1 = no matches)
$ cd /Users/qingguee/repo/dsh-opentui-wt-inproc-only && git grep -n -E host-launch|watchdog-cli|idle-reaper|remote-host-session|e2e-client|e2e-sweep -- packages scripts e2e verify
GITGREP2_EXIT=1 (1 = no matches)
$ tar -tzf /private/tmp/dsh-acceptance3/aiwayds-dsh-opentui-0.18.3.tgz | grep -E host-launch|watchdog-cli|idle-reaper|remote-host-session|e2e-client|e2e-sweep
TAR_GREP_EXIT=1 (1 = no matches)
      33
TAR_COUNT_EXIT=0
```

### Decisive verbatim lines: 23-gates-rerun2.log

```
summary: PASS=22 NOT_RUN=0 FAIL=0
capcontract integrity gate: GREEN
EXIT=0
fresh-home no-dsh | 3 checks | 0 | 6 NOT RUN (unselected by scenario; by design) | 0
TEST_TOTAL pass=3241 fail=0 skip=3 workspace_packages_with_tests=5
TYPECHECK_BASELINE=MATCH exactly 58 tui-base TS diagnostics; other 6 workspace projects Done
UNEXPECTED_FAILURES=NONE
```

完整原始门禁输出在 23-gates-rerun2.log 中（439214 bytes），此处只摘录判定行，sha256 见索引。

### Decisive verbatim lines: 24-tui-smoke-rerun2.log

```
UTC_START=2026-11-24T16:50:10Z HEAD=9b06e44c79dfcf395c903bc0deef4feb73ddd432
[frame-01] UTC=2026-11-24T16:50:13Z elapsed=3s session=alive pane(dead/status/pid)=0//17622 cap_plain_rc=0 cap_e_rc=0
[frame-01] raw_bytes=8376 plain_nonspace_chars=2910 e_nonspace_chars=5286 matched_ui=dsh-opentui|deepseek
[frame-02] UTC=2026-11-24T16:51:13Z elapsed=60s session=alive pane(dead/status/pid)=0//17622 cap_plain_rc=0 cap_e_rc=0
[frame-02] raw_bytes=8376 plain_nonspace_chars=2910 e_nonspace_chars=5286 matched_ui=dsh-opentui|deepseek
All 28 two-second polls (5s..61s) reported nonspace=2910, session=alive, pane(dead/status/pid)=0//17622.
  Automated known-string hits on the plain frame: "dsh-opentui", "deepseek".
QUIT_RESULT=not-exited
profile_dir_count=1 opentui_monday_count=1 legacy_opentui_inproc_count=0
```

说明：24 号日志的 verdict 段含终端 ANSI/NEL 帧与二进制字节，上文只摘录纯文本判定行；`dsh-opentui|deepseek` 中的竖线是程序输出的分隔符，原样引用。表内「28 次轮询」取自该日志 verdict 行的表述。

## Profile-specific section / 分项证明

FEATURE：正向路径在 Change ref 9b06e44 的真实交付面上运行。先由 npm pack 从该提交构建 tarball，安装进隔离 npm prefix，再对 scratch HOME 执行安装版 provisioner 与安装版 bin；真实 ~/.dsh 从未使用。每行绑定到断言表的 changed path：usage 与 flag 分支（A1/A5）、workspace 契约守卫（A2/A4）、迁移计划与 IO（A3）、profile 常量（A2/A3）、退役符号清理（A6）、回归测试执行（A7）、v2-entry 首屏绑定（A8）。反向对照：A2/A3/A4/A5/A6 的反向机器证据以 25-pre-change-rerun.log 为准，在 main 153c8ce 上给出旧 profile 名、--provider 被接受、坏 workspace 被接受、退役符号存在；00-pre-change.log 仅作首发记录（首次尝试记录（含未执行 grep））；A8 由 09-tui-smoke.log 给出旧版 0 字符帧与 ReferenceError profile。无 mock 或 stub：provisioner 复制真实安装 dist/bridge，host 版本固定为 0.2.2-rc.5，companion registry 访问以 DSH_OPENTUI_COMPANION_LATEST=off 关闭（见 Limits）。坏 workspace 与 flag 用例使用真实进程退出码与 stderr。

## Re-run evidence / 回修证据

| file | round | new assertion result |
|------|-------|----------------------|
| 00-pre-change.log | 1 | 首次尝试记录（含未执行 grep），非反向主基线，非断言行 |
| 17-pack-install-rerun2.log | 1 | A1: FAIL -> PASS |
| 18-fresh-provision-rerun2.log | 1 | A2: FAIL -> PASS |
| 19-migration-rerun2.log | 1 | A3: FAIL -> PASS（04 号首次采集含占位命令，19 号重采；反向口径：00 的 B1 只证明旧代码产出旧 profile、无 opentui-monday/无迁移 marker，25 补充旧代码路径；未在同一输入上跑旧代码，反向依据是旧代码无目标 profile/无 marker 路径） |
| 20-negative-workspace-rerun2.log | 1 | A4: FAIL -> PASS |
| 21-negative-flags-rerun2.log | 1 | A5: FAIL -> PASS |
| 23-gates-rerun2.log | 1 | A7: NOT RUN -> PASS |
| 14-main-typecheck.log | 2 | A7: main 58 反证基线补齐 |
| 22-retired-surface-rerun2.log | 2 | A6: FAIL -> PASS |
| 24-tui-smoke-rerun2.log | 3 | A8: added A8, FAIL -> PASS |
| 09-tui-smoke.log | 3 | A8 的反向前置，旧版崩溃，非断言行 |

N 按最终表的断言 id 计数，不按跨轮结果事件计数；最终状态取各断言最新一轮判定。

## Failure rounds / 回修轮次

| round | what changed | new evidence file | old criterion (verbatim) | re-gate result |
|-------|--------------|-------------------|--------------------------|----------------|
| 1 | oldfox FAIL：A5 判据字面写成 unknown option '--provider'，实际输出是 --provider=x；A6 判据写成全仓零命中，首次 SOURCE_GREP_EXIT=0（4 条 docs 命中）；A7 证据早于登记；A2/A3/A4 首次采集含失败补跑与占位命令（04 号含占位，19 号重采）；A1 changed path 写 package.json (version) 且不在 diff | 17 至 23 号 rerun2 全套 | A5: unknown option '--provider' / A6: 全仓零命中 / A1: package.json (version) / A2 与 A3 与 A4: 首次采集含失败补跑与占位命令（04 号含占位，19 号重采） / A7: 证据早于登记 | FAIL |
| 2 | A6 改用 packages scripts e2e verify 范围后仍有 6 条死引用；提交 9b06e44 清理 5 个文件的注释级残留；22 号复跑零命中 | 22-retired-surface-rerun2.log, 14-main-typecheck.log | A6: packages scripts e2e verify 零命中（首次仍有 6 条死引用） | PASS（A6） |
| 3 | 真机冒烟发现 v2-entry.tsx 中 profile 未定义 P0（0 字符帧、ReferenceError profile）；提交 7ed13aa 修复并加回归测试；24 号重跑渲染 PASS；新增 A8 | 24-tui-smoke-rerun2.log | A8: added A8（新增断言无旧判据） | PASS（A8） |

## Limits / 限制

- A2/A3/A4 使用 DSH_OPENTUI_COMPANION_LATEST=off 与 DSH_OPENTUI_HOST_VERSION=0.2.2-rc.5。这覆盖的是文档规定的离线供给路径，未覆盖真实 registry 上的 companion 安装分支（npm view/dsh plugin add）。
- 24 号真机冒烟只验证启动与首屏渲染（P1/P2）和 profile 目录集合（P4），未验证对话轮次。
- P3 退出手势未通过，按范围外问题记录，不影响 A1–A8 的判定。

## Discovered issues (out of scope) / 发现的问题（不在本次断言内）

- P3：双 Ctrl+C 后 10 秒内未退出。24 号记录 QUIT_RESULT=not-exited，两次 send-keys 退出码均为 0，随后 10 次 1s 检查均 session=alive、pane 未死、pid 仍为 17622，最终由 tmux kill-session 清理。
- 退出确认逻辑位于 packages/tui-base/src/routes/session/turn-cancel.tsx（TurnCancelKeys，首次 Ctrl+C 打开确认框）与 packages/tui-base/src/config/keybind.ts（app.exit 绑定）。对 `git diff main...HEAD --name-only` 的核对结论：
  ```
  packages/tui-base/src/routes/session/turn-cancel.tsx  ->  NOT_IN_DIFF
  packages/tui-base/src/config/keybind.ts               ->  NOT_IN_DIFF
  packages/tui-base/examples/v2-entry.tsx               ->  IN_DIFF（`7ed13aa` 仅改 profileName 绑定（含 profileConstants 引入）与 loadShell 的 T9 注释；dispose/shutdown 注释与重写来自 T9 (`c7df08d`)）
  ```
  packages/tui-base/examples/v2-entry.tsx 虽在 diff 中，但 `7ed13aa` 与 T9 均未改退出手势路径；`quit: () => process.exit(0)` 行未变。`quit: () => process.exit(0)` 在 main 与 HEAD 未变，P3 与 diff 的因果关系未用 main 基线验证。diff 中的 docs/adr/0008-input-ownership-for-keyboard-routing.md 与 scripts/verify-sk-keymap-ans.mjs 是文档和验证脚本，不是运行时退出处理。
- 结论：P3 不计入 A1–A8，列为待独立排查项。24 号仅记录观察值，未把该失败改判为 PASS。

## Gate judgment / 门禁判定

- [x] All FEATURE gate items present
- [x] Binding: acceptance target quoted verbatim, touched paths declared, >=1 evidence item per profile on this diff
- [x] Change ref names the change commit (9b06e44); working tree is free text; changed path filled for all 8 rows
- [x] Every assertion has a checkable criterion, a changed path, and an evidence file; A1/A2/A4/A5/A8 execute changed code paths and name changed files/functions
- [x] Real driven I/O transcript at the change commit (tarball built from 9b06e44, installed and driven)
- [x] One reverse case per changed behavior on the decidable boundary, backed by 00-pre-change.log and 09-tui-smoke.log
- [x] No anti-cheat red line triggered (raw outputs present, no pasted source as results, no lucky-only runs, no mock on the real path)
- [x] No `Claim`-level item is the sole basis for PASS
- [x] Assertion total N = 8; each of 8 assertions has a status; PASS = all non-USER-JUDGMENT rows PASS, no FAIL/NOT RUN/UNAVAILABLE/BLOCKED, >=1 machine-judged row (all 8 are machine-judged), acyclic depends on (A2/A3/A4/A5/A8 depend on A1; A6/A7 have none)
- [x] expected preregistered (2026-11-24T16:45Z consolidated; A8 added 16:47Z before the re-run smoke), never rewritten to observed; rewordings recorded verbatim in Failure rounds

Assertion status / 断言状态 (N = 8)：
A1: PASS | A2: PASS | A3: PASS | A4: PASS | A5: PASS | A6: PASS | A7: PASS | A8: PASS

Status summary / 状态汇总 (sum = 8)：

| status | count |
|--------|-------|
| PASS | 8 |
| FAIL | 0 |
| NOT RUN | 0 |
| UNAVAILABLE | 0 |
| BLOCKED | 0 |
| USER-JUDGMENT | 0 |
| PASS-BY-USER | 0 |

Result: PASS

## UNAVAILABLE / BLOCKED declarations / 无法验证声明

(none — all assertions verified on this machine; Limits records scope, not inability)

## USER-JUDGMENT / PASS-BY-USER / 用户判断项

(none — every assertion has a decidable machine criterion)

## Gitignore notice / 忽略提示

The raw evidence directory may be gitignored; `report.md` should be committed so the proof is reviewable. `.gitignore` was not edited. Working tree at collection: tracked clean; `.proof/`, `.v2c/`, `.video_agent/` untracked.
