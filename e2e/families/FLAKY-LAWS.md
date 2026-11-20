# 024 E2E flaky 约束（唯一口径）

交付计划 §四「flaky 约束写入（沿坑清单）」的落地。适用于 `e2e/families/`
下全部场景族与容器跑法。

## 1. 墙钟窗口：常量推导 + 轮询 + 故障注入

- 所有等待窗口从 **一个常量** `E2E_TICK`（默认 1s）+ 有界轮询次数推导：
  `E2E_BOOT_TICKS`（composer 就绪）、`E2E_EXIT_TICKS`（干净退出）、
  `E2E_BRIDGE_BOOT_MS` / `E2E_BRIDGE_REPLY_MS` / `E2E_EXIT_WAIT_MS`
  （bridge probe）。见 `lib/family-lib.sh` 与 `lib/bridge-families.mjs`。
- **禁止**散落的魔法 `sleep N` 作为同步手段；就绪判据必须轮询真实信号
  （framed JSON reply / 画出的输入框 / EXIT 状态文件），不是「等够了就算」。
- 负例用**故障注入**驱动（未接线的 CapIR id → UNSUPPORTED/NOT_WIRED、
  `session.open` 二次 → ALREADY_OPEN、对话中 close → 隔离、信号杀死 → 128+N），
  绝不靠放宽断言把红转绿。

## 2. VM 时钟判新鲜：只认 IMAGE ID

- podman VM 时钟比宿主慢约 **1h48m**；`podman images` 的 CREATED 列不可作
  新鲜度判据。
- 判新鲜只看 `podman image inspect --format '{{.Id}}'` 的 **IMAGE ID**（在
  `run-e2e.sh` 每次 build 后打印）。dsh 版本新鲜度走 newest-of(latest,next)
  解析规则（禁手 pin、禁 retired `alpha`、`sort -V` 对 prerelease 有陷阱）。

## 3. 不挂载工作树

- 源码由 Containerfile 的 `COPY packages /src` **烤进镜像**；容器运行时只把
  测试脚本以只读方式挂在 `/e2e:ro`，**工作树不进容器**。
- SDK 解析（`dsh-client-connection`）也改为镜像内真实目录 copy（S6 符号链接
  债清偿范式），不依赖构建机全局闭包路径——避免 0.9.6「干净 worktree +
  frozen-lockfile 必红」的容器版。

## 4. VM 并发 ≤ 2

- podman-machine 为 5CPU / 2GiB；同时运行容器数 ≤ 2。
  `e2e/run-e2e.sh` 每条命令只起一个容器（子集用 `E2E_SCENARIOS` 选），编排器
  `e2e/families/run-all.sh` 串行跑族，不并发起容器。

## 5. 抓帧口径：.ans 数值断言唯一

- TUI 渲染证据只用 `tmux capture-pane -e -p` 的 ANSI 数值流（`.ans`），
  **禁 PNG、禁视觉模型**。宏定位器需 locale-complete（pin en 或同时覆盖
  zh 标签，如 `账号`/`输入消息`、S3 的 `🧠→⌨` 先例）。

## 6. 真机 gate 与容器 E2E 是两套环境

- `scripts/real-client-gate.sh` / cap-smoke 跑在宿主 macOS（真 dsh rc.5），
  容器族跑在 podman Linux 镜像；二者互不冒充覆盖，各自独立记证。
