# dsh-opentui 能不能改成由 GitHub Actions 发布 npm（只读调研）

- 调研日期：2026-11-16
- 方式：只读。`gh secret list` / `gh workflow list` / `gh api`（只读）、`gh repo view`、`npm view --registry=https://registry.npmjs.org`、读 yml/package.json/git。**未**设置 secret、未打 tag、未 push、未 publish、除本文档外未改任何文件。
- 本仓：`/Users/qingguee/repo/dsh-opentui-wt-release`（worktree，main = `3645345 chore(release): 0.18.1`，owner/repo = `fan56/dsh-opentui`，visibility = **PUBLIC**）。

## 0. 结论摘要（先看这条）

1. 现状是**纯手动发布**：仓里只有一个 `ci.yml`（测试门），**零** publish 步骤、**零** secret。要改成 Actions 发布，必须**新增** `.github/workflows/release.yml`，不是改 `ci.yml`。
2. **可以改成 Actions 发布**，且 5 个兄弟仓已有同一套成熟模板：tag `v*` 触发 → 测试门 → 版本对齐 tag → `npm publish --provenance` → `npm view` 验证 → 独立 job 建 GitHub Release。最值得照抄：**`dsh-cron/.github/workflows/release.yml`**。
3. 鉴权走 **NPM_TOKEN secret + OIDC provenance 混用**（与全部兄弟仓一致）。本仓**目前没有任何 secret**，落地需要 `gh secret set NPM_TOKEN`（本次未执行）。
4. **先决条件（不满足就 publish 失败）**：`packages/shell/package.json` **缺 `repository` 字段**，`npm publish --provenance` 会因 repository.url 与仓库不匹配报 422。5 个兄弟仓的 package.json 都带 `repository: git+https://github.com/fan56/<repo>.git`（provenance 的硬性要求）。必须先补这一个字段（含 `"directory": "packages/shell"`）再开 provenance；否则只能去掉 `--provenance`。

### 与任务前提不符的事实（必须更正）

任务里写「0.18.1 尚未发布到 npm」，**此刻实际已经发布了**：

```
$ npm view @aiwayds/dsh-opentui versions --registry=https://registry.npmjs.org | tail -3
  "0.18.0",
  "0.18.1"
$ npm view @aiwayds/dsh-opentui dist-tags --registry=https://registry.npmjs.org
{ "latest": "0.18.1" }
$ npm view @aiwayds/dsh-opentui time --registry=https://registry.npmjs.org | tail -2
  "0.18.0": "2026-11-16T05:04:03.135Z",
  "0.18.1": "2026-11-16T06:21:21.637Z"
```

`npm view @aiwayds/dsh-opentui@0.18.1 dist.attestations` **无输出** → 这次是 token 手动发布，**没有 provenance**（不是 CI/OIDC 发的）。影响：CI 发布的第一个 tag 只能从 **v0.18.2** 起；若有人误打 v0.18.1，模板里的版本预检会安全跳过。

---

## 1. 本仓现状（文件 / 命令证据）

| 项 | 结果 | 证据 |
| --- | --- | --- |
| workflows 目录 | 只有 `ci.yml`（6959B） | `ls .github/workflows/` |
| 远端 workflows | 只有 `ci.yml` | `gh api repos/fan56/dsh-opentui/contents/.github/workflows -q '.[].name'` |
| ci.yml 触发 | push main / pull_request / workflow_dispatch | `.github/workflows/ci.yml:2-6` |
| publish 相关 | 无任何步骤，仅 3 处注释命中 | `grep -rniE "publish\|NPM_TOKEN\|NODE_AUTH_TOKEN\|id-token\|registry" .github/` → `ci.yml:26,68,71` |
| Actions 状态 | `CI active 400084559`（只有一个） | `gh workflow list -R fan56/dsh-opentui` |
| secrets | **空**（命令 exit 0，无任何行） | `gh secret list -R fan56/dsh-opentui` |
| tags | 只有 `v0.4.1/v0.4.2/v0.4.3`，最后一个 2026-11-01 | `git tag -l | tail -3`；`gh api repos/fan56/dsh-opentui/tags` |
| GitHub Releases | 无 | `gh release list -R fan56/dsh-opentui` → 空 |
| 发版惯例 | `chore(release): x.y.z` 提交改 CHANGELOG + shell version，**不打 tag** | `git log --oneline --grep="chore(release)"` 连续 8 条 |

结论：本仓 = 手动 `npm publish`。推 main 只跑测试；推 tag 现在**什么都不触发**。

---

## 2. 兄弟仓既有模式（5 个全读了 release.yml）

| 仓 | 触发 | 工具链 | 门（publish 前） | 版本对齐 | publish 参数 | secret | provenance | publish 后 | 发布目录 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **dsh-cron** | `push: tags: ['v*']` | pnpm 10 + node 22 + setup-node(pnpm cache) | 装 dsh CLI 闭包 → `pnpm check && pnpm test` + smoke | `npm version $TAG --no-git-tag-version --allow-same-version` | `npm publish --access public --provenance --tag <latest/next/alpha>` | `NPM_TOKEN` (`NODE_AUTH_TOKEN`) | 是（`id-token: write`） | `npm view` 重试 24×15s 验证 + 独立 job `gh release create` | 仓库根 |
| dsh-tui-pi | 同上 | pnpm 10 + node 22 | 同上 + dsh 闭包安装（latest/next 取新） | 同上 | 同上 | `NPM_TOKEN` | 是 | release job（`softprops/action-gh-release@v3`，tag message 作 body） | 仓库根 |
| dsh-subagent-registry | 同上 | npm（`npm install --no-audit --no-fund`） | `npm run build && npm run check && npm test` | 同上 | 同上 | `NPM_TOKEN` | 是 | `npm view` 30×10s + `gh release create` | 仓库根 |
| dsh-feishu | 同上 | npm | 同上 | 同上 | 同上 | `NPM_TOKEN` | 是 | `npm view` 验证 + `gh release create` | 仓库根 |
| dsh-topics-memory | 同上 | npm | 同上 | 同上 | `npm publish --access public --tag`（**无 --provenance**，因曾是私有仓） | `NPM_TOKEN` | 否 | 同上 | 仓库根 |

共同点：

- **触发一律是 tag `v*`**，没有 push main 发布，也没有 `release: published`。
- publish 前都有测试门；都把 **tag 当唯一版本来源**（`npm version` 从 `GITHUB_REF_NAME#v` 回写 package.json）。
- 都有 `if: github.repository == 'fan56/<repo>'`（fork 不发布）。
- publish job 都有 `permissions: { contents: read, id-token: write }`（provenance）。
- 发布步骤都是**幂等**的：先 `npm view` 预检跳过，再匹配 npm 的「already published / E403 / E404」错误文本当成功，最后用 `npm view` 做唯一验收信号。
- 发布后的 GitHub Release 在**独立 job**（`needs: publish`），失败可单独重跑而不会重复 publish；`contents: write`。
- **没有共享 reusable workflow 或 composite action**：`grep -rl "workflow_call\|uses: .*autoRelease"` 在 5 仓 `.github` 下零命中（只有审计产物 json 误命中）。每个仓是**复制粘贴同一模板**，各自改包名。
- 所有发布都是**仓库根包**，没有一个从子目录（workspace）发布 —— dsh-opentui 是第一个这种形态。

### 最值得照抄：`dsh-cron/.github/workflows/release.yml`

理由：

1. 它是**唯一 pnpm + `pnpm install --frozen-lockfile` + setup-node pnpm cache** 的完整模板（dsh-tui-pi 也是 pnpm，但额外塞了一大段「滚动 dsh 闭包安装」，对 dsh-opentui 无用 —— 本仓测试用 `ci.yml` 的 SDK stub，不需要全局 dsh）。
2. publish 步骤的容错是 5 仓里注释最全、最成熟的版本（`E404|E403|cannot publish over the previously published versions` 全部降级为 warning，交给 verify 判定）。
3. 有独立 verify 步骤（`npm view` 24×15s）+ 独立 release job，可按 job 重跑。
4. 只依赖 `NPM_TOKEN`，没有其它 secret 耦合。

需要从 dsh-tui-pi 借的一点：release body 用**annotated tag message**（本仓当前 tag 习惯已断，适合用 tag message 承载 CHANGELOG 段落）；也可以直接用 `gh release create --generate-notes`。

---

## 3. 鉴权可行性

- 5 个兄弟仓的写法是 **token + OIDC 混合**：`env: NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}` 做 registry 认证，`permissions: id-token: write` + `npm publish --provenance` 做来源证明。**不是**纯 trusted publishing。
- 从 workflow 无法区分 classic token 还是 granular token（都叫 `NPM_TOKEN`）。granular token 需要：packages `read/write`、scope 选中 `@aiwayds` 包、勾选 2FA bypass（CI 用）。classic token 需要 `publish` 权限。两条都能跑通，模板不变。
- **本仓 `gh secret list -R fan56/dsh-opentui` 为空**（exit 0，无行），对照 `dsh-tui-pi` / `dsh-cron` 都有 `NPM_TOKEN`。所以落地前必须 `gh secret set NPM_TOKEN -R fan56/dsh-opentui`（**本次未执行**）。
- 纯 OIDC（npm trusted publishing）技术上可行（仓 PUBLIC、npm 11.19、`id-token: write`），但需要在 **npmjs.com 包设置里**手工登记 trusted publisher（不是 `gh` 能做），且没有任何兄弟仓验证过 → 不推荐作为第一步；可作为后续去掉长期 token 的升级路径。

---

## 4. 版本 / 发布护栏（兄弟仓做法）

| 风险 | 兄弟仓做法 |
| --- | --- |
| 重复发布同一版本 | `npm view @scope/pkg@$VER version` 预检 → 命中则 `::warning::` + `exit 0`（不失败，让下游 release job 继续） |
| publish 报错但其实已落地（npm 已知丢响应模式） | 匹配 `cannot publish over the previously published versions` / `E403` / `E404` → 降级为 warning，交给 verify |
| publish 返回 0 但其实没落地 | 独立 verify 步骤：`npm view` 轮询（subagent-registry 30×10s、cron 24×15s），**exit code 不算证据** |
| 误发/覆盖 | npm 版本不可变（`--force` 也不能覆盖），所以「已存在即跳过」是唯一正确行为 |
| 只允许正式仓发布 | `if: github.repository == 'fan56/<repo>'` |
| 只允许 main 上的 commit 发布 | **兄弟仓都没有显式检查** —— 只有 tag 触发。tag 可以从任意 commit 打。建议本仓补一条 `git merge-base --is-ancestor $GITHUB_SHA origin/main` |
| 预发布污染 latest | tag 名带 `-` → 自动落 `next`/`alpha` dist-tag（`*-alpha.*` → alpha，其它 `-*` → next） |
| 并发重复跑 | 兄弟仓 release 没有 concurrency；建议本仓加 `concurrency: group: release-${{ github.ref_name }}, cancel-in-progress: false` |

---

## 5. 本仓适配点（改成 Actions 发布的坑，按严重度）

1. **`repository` 字段缺失 → `--provenance` 直接 422（阻塞级）**。`packages/shell/package.json` 无 `repository/homepage/bugs`（`node -e` 读出 `undefined`），已发布的 0.18.0 tarball 里也没有。5 个兄弟仓都有 `repository: {"type":"git","url":"git+https://github.com/fan56/<repo>.git"}`。发布前必须补：
   ```json
   "repository": { "type": "git", "url": "git+https://github.com/fan56/dsh-opentui.git", "directory": "packages/shell" }
   ```
   否则本仓只能像 dsh-topics-memory 那样**去掉 `--provenance`**（也就不用 `id-token: write`）。
2. **发布目录是 `packages/shell`，根包 `private: true`**（`package.json:3`、`packageManager: pnpm@10.18.3` 在 `package.json:5`）。做法：
   - `npm publish` 用 `working-directory: packages/shell`；
   - 版本回写也必须在 `packages/shell` 里做（根 package.json 无 `version`，`npm version` 在根会失败）；
   - `npm` 在 `packages/shell` 不会读到根 `.npmrc`（项目级配置 = `packages/shell/.npmrc`，不存在）。token 靠 `actions/setup-node` 写的 userconfig（`NPM_CONFIG_USERCONFIG`）生效 —— 与 cwd 无关，所以能认证；但**不要**指望根 `.npmrc:1` 的 `registry=`，建议 publish/verify 显式 `--registry=https://registry.npmjs.org`，并加一步 `npm whoami --registry=...` 做鉴权预检（不要打印 token）。
3. **prepack 需要完整 workspace 安装，不能只装 shell**：`packages/shell/package.json:23` 的 prepack = `bun ../../scripts/build-client.mjs && bun ../../scripts/verify-pack-locales.mjs && node scripts/pack-meta.mjs`；而 `scripts/build-client.mjs:56` 从 `packages/tui-base/node_modules/@opentui/solid/scripts/solid-plugin.js` 动态 import solid 插件。所以必须：`setup-bun`（ci.yml 钉 `1.4.4`，`ci.yml:18`）+ 根 `pnpm install --frozen-lockfile`（`ci.yml:22`）+ `setup-node`（prepack 里跑 `node scripts/pack-meta.mjs`）。只跑 `pnpm --filter ... install` 会缺 tui-base 的 opentui 依赖。
4. **版本必须在 publish 之前敲定，且顺序有语义**：`scripts/build-client.mjs:77,85` 读 `packages/shell/package.json` 的 version 写进 bundle 的 `__DSH_CLIENT_VERSION__`。prepack 在 `npm publish` 时才跑，所以「先 `npm version $TAG` 再 publish」能保证 bundle 里嵌的是 tag 版本；反过来先 build 再 publish 就会嵌旧版本。
5. **prepack 会写文件（不是纯 build）**：`scripts/pack-meta.mjs` 从仓库根复制 LICENSE/NOTICE/README.md/CHANGELOG.md 到 `packages/shell/`，build-client 写 `dist/client`、`dist/scripts`、`dist/locales` —— 这些在 `.gitignore:2,8-11` 里。因此：
   - 工作流里**不能**有 `git diff --exit-code` 之类 clean-tree 断言放在 publish 之前；
   - **不要用 `pnpm publish`**（默认 git 状态/远端检查，且本仓 worktree 常有未跟踪文件 → `ERR_PNPM_GIT_UNCLEAN`）；`npm publish` 无此检查。
6. **测试门必须带 `ci.yml` 的 SDK stub**：`@deepseek-ai/dsh-client-connection` 不在 registry，CI 用 `node -e` 在 `packages/shell/node_modules/...` 写 stub（`ci.yml:30-41`，注释在 `ci.yml:26` 说明）。release 的测试步骤照抄 `ci.yml` 的 4 条：per-package `bun test`（`ci.yml:44`）、`bun run test:ft`（`:52`）、`typecheck:entry`（`:57`）、`bun test -t '^verify:'`（`:64`）。`ui/e2e` 与 `real-client` job 不进 release（需要 tmux/global dsh/provider key）。
7. **`devDependencies` 里的 `workspace:*` 会被原样发出去**：`packages/shell/package.json:38` `@dsh-opentui/runtime: workspace:*`，已发布的 0.18.0 清单里就是字面量 `workspace:*`（`npm view ... devDependencies` 验证）。`npm publish` 不改写；消费者不装 devDeps，无害。要消掉得换 `pnpm publish --no-git-checks`（但与上面第 5 条冲突，不推荐）。
8. **engines 不匹配不是阻塞**：`packages/shell/package.json:40-42` 要求 node>=26.4.0；release 里用 node 22（兄弟仓一致）只跑 npm/prepack，不启动 CLI；只要别开 `engine-strict` 就行。
9. **首个 tag 必须是 v0.18.2**：0.18.1 已在 registry（见 §0）。tag 与 npm 版本脱节很久（v0.4.3 之后无 tag），恢复 tag 需要一次性约定。

---

## 6. 方案骨架：`.github/workflows/release.yml`（建议内容，未写入）

触发选择：**`push: tags: ['v*']`**（tag 是唯一版本来源，5 仓一致、publish 步骤已被验证；push main 自动发会在每次 release commit 后触发，需要额外的「版本是否已在 registry」门 + 路径过滤，反而更脆）。tag 用 annotated，message 放 CHANGELOG 段落。

```yaml
# Release: publish @aiwayds/dsh-opentui + create the GitHub Release when a v* tag is pushed.
# Shape copied from fan56/dsh-cron/.github/workflows/release.yml (pnpm + hardened
# idempotent publish) and fan56/dsh-subagent-registry (npm-view verify + release job).
# Repo-specific: bun toolchain, publish from packages/shell, prepack builds the client,
# ci.yml's SDK stub replaces the global-dsh closure install.
name: Release

on:
  push:
    tags: ['v*']

permissions:
  contents: read

concurrency:
  group: release-${{ github.ref_name }}
  cancel-in-progress: false   # never kill a run in the middle of a publish

jobs:
  publish:
    name: Gate & Publish
    if: github.repository == 'fan56/dsh-opentui'   # forks never publish
    runs-on: ubuntu-latest          # provenance needs a GitHub-hosted runner
    timeout-minutes: 30
    permissions:
      contents: read
      id-token: write               # npm provenance (OIDC); repo is PUBLIC
    steps:
      - uses: actions/checkout@v7
        with:
          fetch-depth: 0            # ancestry check needs real history

      - name: Tag must point at a commit on main
        run: |
          git fetch --no-tags origin main
          git merge-base --is-ancestor "$GITHUB_SHA" origin/main \
            || { echo "::error::$GITHUB_REF_NAME ($GITHUB_SHA) is not on main"; exit 1; }

      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: "1.4.4"      # same pin as ci.yml:18

      - uses: pnpm/action-setup@v6
        with:
          version: 10.18.3          # root packageManager (package.json:5)

      - uses: actions/setup-node@v7
        with:
          node-version: 22
          cache: pnpm
          cache-dependency-path: pnpm-lock.yaml
          registry-url: https://registry.npmjs.org

      - name: Install dependencies (frozen lockfile)
        run: pnpm install --frozen-lockfile

      # Same stub as ci.yml:30-41 — @deepseek-ai/dsh-client-connection is not on
      # the registry and hosted runners have no global dsh.
      - name: stub @deepseek-ai/dsh-client-connection (no global dsh on runners)
        run: |
          node -e '
            const { mkdirSync, writeFileSync } = require("node:fs");
            const dir = "packages/shell/node_modules/@deepseek-ai/dsh-client-connection";
            mkdirSync(dir, { recursive: true });
            writeFileSync(dir + "/package.json",
              JSON.stringify({ type: "module", exports: { "./client": "./index.js" } }));
            writeFileSync(dir + "/index.js",
              "export const installConnection = () => { throw new Error(\"CI stub: @deepseek-ai/dsh-client-connection needs a global dsh install\"); };\n");
          '

      # Gate = the same named checks as ci.yml (ubuntu leg only; the os matrix
      # and the opt-in real-client job stay in ci.yml).
      - run: for p in packages/*/; do (cd "$p" && bun test); done
      - run: bun run test:ft
      - run: cd packages/tui-base && bun run typecheck:entry
      - run: cd packages/tui-base && bun test -t '^verify:'

      - name: Stamp packages/shell/package.json to the tag version
        # The tag is the single source of truth. packages/shell is the published
        # package; the root manifest is private and has no version field.
        # build-client.mjs:77 reads this version into __DSH_CLIENT_VERSION__, and
        # prepack re-runs it during publish, so stamp BEFORE publishing.
        run: |
          TAG_VERSION="${GITHUB_REF_NAME#v}"
          ( cd packages/shell && npm version "$TAG_VERSION" \
              --no-git-tag-version --allow-same-version )
          echo "publishing @aiwayds/dsh-opentui@${TAG_VERSION} (tag ${GITHUB_REF_NAME})"

      - name: Publish to npm
        working-directory: packages/shell
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
        # Idempotent per the dsh-cron template: skip when the version already
        # exists, and treat npm's known lost-response failure (PUT lands, the
        # follow-up errors 403/404) as "let the verify step decide". npm
        # versions are immutable, so degrade-to-warning is the only option.
        run: |
          REG=https://registry.npmjs.org
          TAG_VERSION="${GITHUB_REF_NAME#v}"
          case "$TAG_VERSION" in
            *-alpha.*) NPM_TAG="alpha" ;;
            *-*) NPM_TAG="next" ;;
            *) NPM_TAG="latest" ;;
          esac
          echo "npm dist-tag: ${NPM_TAG}"
          # Auth preflight: fails fast and prints only the user name, never the token.
          npm whoami --registry="$REG"
          if npm view "@aiwayds/dsh-opentui@${TAG_VERSION}" version --registry="$REG" >/dev/null 2>&1; then
            echo "::warning::@aiwayds/dsh-opentui@${TAG_VERSION} is already on npm — skipping publish"
            exit 0
          fi
          set +e
          PUB_OUT="$(npm publish --access public --provenance --tag "$NPM_TAG" --registry="$REG" 2>&1)"
          PUB_RC=$?
          set -e
          printf '%s\n' "$PUB_OUT"
          if [ "${PUB_RC}" -ne 0 ] && printf '%s' "$PUB_OUT" | grep -qiE "cannot publish over the previously published versions|E404|E403"; then
            echo "::warning::publish errored but may have landed (npm's known lost-response mode) — the verify step decides"
            exit 0
          fi
          exit "${PUB_RC}"

      - name: Verify the publish actually landed
        # A green publish exit code is NOT proof: npm has committed writes while
        # reporting failure. `npm view` seeing the version is the acceptance signal;
        # packument propagation measured ~50s–2min in the ecosystem.
        run: |
          REG=https://registry.npmjs.org
          TAG_VERSION="${GITHUB_REF_NAME#v}"
          for attempt in $(seq 1 24); do
            if npm view "@aiwayds/dsh-opentui@${TAG_VERSION}" version --registry="$REG" >/dev/null 2>&1; then
              echo "verified: @aiwayds/dsh-opentui@${TAG_VERSION} is visible on the registry (attempt ${attempt})"
              exit 0
            fi
            echo "attempt ${attempt}/24: not visible yet; waiting 15s"
            sleep 15
          done
          echo "::error::publish reported success but npm view never saw @aiwayds/dsh-opentui@${TAG_VERSION} after ~6 min — inspect the registry manually"
          exit 1

  release:
    name: Create GitHub Release
    needs: publish                  # re-run this job alone if it fails; publish never repeats
    runs-on: ubuntu-latest
    timeout-minutes: 10
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v7
        with:
          fetch-depth: 0            # annotated tag object for the message

      - name: Read tag message
        id: tag_message
        env:
          TAG: ${{ github.ref_name }}
        run: |
          {
            echo 'BODY<<EOF_TAG_MESSAGE'
            git tag -l --format='%(contents:subject)%0a%0a%(contents:body)' "$TAG"
            echo 'EOF_TAG_MESSAGE'
          } >> "$GITHUB_OUTPUT"

      - name: Check if GitHub Release already exists
        id: check_release
        env:
          TAG: ${{ github.ref_name }}
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          if gh release view "$TAG" >/dev/null 2>&1; then
            echo "exists=true" >> "$GITHUB_OUTPUT"
            echo "::notice::GitHub Release $TAG already exists — skipping (preserving existing body)"
          else
            echo "exists=false" >> "$GITHUB_OUTPUT"
          fi

      - name: Create GitHub Release
        if: steps.check_release.outputs.exists != 'true'
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          TAG: ${{ github.ref_name }}
          BODY: ${{ steps.tag_message.outputs.BODY }}
        run: gh release create "$TAG" --title "$TAG" --notes "$BODY" ${{ contains(github.ref_name, '-') && '--prerelease' || '' }}
```

### 需要的 secret

| 名称 | 用途 | 现状 |
| --- | --- | --- |
| `NPM_TOKEN` | registry 认证（granular：packages read/write + 2FA bypass + `@aiwayds` scope；或 classic + publish） | **不存在**，需 `gh secret set NPM_TOKEN -R fan56/dsh-opentui`（本次未执行） |
| `GITHUB_TOKEN` | release job 建 Release | Actions 自动提供，无需配置 |

### 落地前置改动（代码，不是 workflow）

`packages/shell/package.json` 增加（否则 `--provenance` 422）：

```json
"repository": {
  "type": "git",
  "url": "git+https://github.com/fan56/dsh-opentui.git",
  "directory": "packages/shell"
}
```

---

## 7. 一句话结论

- **要不要打 tag：要。** `push: tags: ['v*']` 是本仓唯一推荐触发；从 **v0.18.2** 起（0.18.1 已在 npm），annotated tag，message 放 CHANGELOG 段落。tag 打在 main 上的 release commit 上。
- **要不要改现有 ci.yml：不要。** 发布是**新增** `release.yml`；`ci.yml` 的测试门被 release 复用（同 4 条命令 + SDK stub），保持原样即可。可选（非必须）给 ci.yml 加 `permissions: contents: read` / `concurrency`，与发布无关。
