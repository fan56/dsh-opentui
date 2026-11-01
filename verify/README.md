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
5. **parity 对照**：与 dsh-tui-pi 同场景对拍（见 run-parity.mjs）

## 当前状态
- UT 层：packages/kit/src/widget-frame.test.ts — 4 tests / 16 asserts GREEN
- E2E+parity：verify/run-parity.mjs — 9/9 GREEN
- FT 层：packages/kit/test/widget-frame.frame.test.tsx — **已破案**：原 Orphan error 是 tsconfig include 不含 test/ 致整个文件被 react-JSX 静默编译；修 include + captureCharFrame 后测试真正运行，现卡 reconciler 的 text-node-under-box 规则（待读引擎源码）；断言保留

## 运行
```
cd packages/shell && npm run verify        # UT+FT+E2E 全链
node verify/run-parity.mjs                # 与 tui-pi 对拍
```

## 已知教训（每条都真实发生过）
- 字节流 grep 会漏布局破坏（溢出进输入框）→ 必须 FT/E2E 看帧
- 单帧快照漏闪烁 → 必须时间序列采样
- "编译过"≠"渲染对"（height:1 装两行）→ FT 断言行数
- 从零造轮子偏离参考实现 → parity 对拍 + 动手前先 grep 参考仓
