# dsh-opentui 验证体系（Verification Workflow）

## 完成的定义（Definition of Done）
一个 UI/功能改动"完成"当且仅当以下五层全绿：
1. **UT**：`bun test` — 纯逻辑单元（状态机/i18n/config/widget 行高计算）
2. **FT**：headless testRender 帧测试 — 断言**渲染后的帧**（不是源码推断）：
   布局、行数、截断、边框、颜色存在性
3. **E2E**：tmux 驱动真会话 + **时间序列采样**（0.5s 间隔）：
   - 闪烁 = presence toggle 计数 > 阈值
   - 单行默认 = 带边框多行采样 = 0
   - 溢出 = 输入框区域内出现 widget 字形
   - 截断 = widget 行长度 ≈ 终端宽
   - 清空 = 轮后 N 秒 widget 消失
4. **视觉审核**：tmux capture -e → PNG 渲染 → 亲眼 Read 验收（禁 grep-only 收尾）
5. **parity 对照**：与 dsh-tui-pi 同场景对拍（见 `verify/run-parity.mjs` —
   **unwired**：未接入 `scripts/test-tier.mjs` 的任何层，其默认 profile 名已过时，
   默认不跑）

## 当前状态
- UT 层：`bun run test:unit` — 77 文件 / 1299 用例（2026-11-14 实测；分层明细见
  [docs/testing.md §1.1](../docs/testing.md)）
- FT 层：`bun run test:ft` — 32 文件 / 268 用例，含 shell 渲染测试试点
  （`packages/shell/test/*-ft.test.tsx`：金丝雀 / 冒烟 / 渲染回归 / 按键路由 / 事故映射）
- E2E：`bun run test:e2e` — 本地 flows（假模型，默认）+ 容器套件（mock 模型）+ live 腿（opt-in）
- parity：`verify/run-parity.mjs` 存在但 **unwired**，默认 profile 名已过时，不在任何门禁内

## 运行
```
bun run test:unit                          # UT（bun test 分层跑批）
bun run test:ft                            # FT（真实渲染器帧测试）
bun run test:e2e                           # E2E（假模型默认腿 + 容器套件）
# node verify/run-parity.mjs              # 与 tui-pi 对拍 — unwired, default profile name deprecated
```

## 已知教训（每条都真实发生过）
- 字节流 grep 会漏布局破坏（溢出进输入框）→ 必须 FT/E2E 看帧
- 单帧快照漏闪烁 → 必须时间序列采样
- "编译过"≠"渲染对"（height:1 装两行）→ FT 断言行数
- 从零造轮子偏离参考实现 → parity 对拍 + 动手前先 grep 参考仓
