# oldfox 第 4 轮评审记录：P0/P1 修复与迁移前置（2026-11-24）

> 本轮是**修复后复审**，不是新设计评审；T8b 接线前 P1-1 已修，P1-2 已由 `53729be` 修复。

## 第一轮

- 已落地 commit：`3c1bd66` / `fd7de0f` / `8ff3770` / `f303b03`
- 裁定：`GO-WITH-CONDITIONS`

### 必须修

| 级别 | 问题 | commit | 状态 |
| --- | --- | --- | --- |
| P1-A | `--force/--yes` 静默无效但 help 仍承诺 reset singleton host。修复：help 改为 reserved/no-op；实际传 flag 时 stderr 明确告警；删除死 `prelaunchFailurePolicy`。 | `3e4f9ec` | `FIXED` |
| P1-B | patch-writer guard 可被换行、别名 import、抽 helper、导入 PATCH 常量、字符串拼接、Deno、子进程绕过。修复：改为 TypeScript AST + 单文件污点分析。 | `10180d8` | `FIXED` |

### 可延后

- `DEFERRED`：README/注释漂移。
- `DEFERRED`：`hostLockPath` 死导出。
- `DEFERRED`：remote-* 死代码退役。
- `DEFERRED`：dist 旧产物不清理。

### 未覆盖

- `NOT COVERED`：seam/i18n/login test 未深审。
- f303b03 仅表面审查：方向正确，老用户 key 不迁移需发布说明。

### 验证数字

- P1-A：70 pass / 0 fail。
- P1-B：7/7 旧绕过例 CAUGHT；真实扫描 42 文件 0 违规；12 pass / 99 expect。

## 第二轮

- 已落地 commit：`10180d8` / `45fd52f`
- 裁定：`GO-WITH-CONDITIONS`

### 必须修

| 级别 | 问题 | commit | 状态 |
| --- | --- | --- | --- |
| P1-1 | `externalCarry` leaf 路径未限深 + `__proto__` 原型污染。修复：6 个精确叶白名单、`parts.length===2`、段名黑名单、`setIn` defense。 | `8f4dcb2` | `FIXED` |
| P1-2 | guard 同文件工厂函数返回值污点未传播；另发现对象属性、数组 join、Bun 解构别名绕过。已修复并落地。 | `53729be` | `FIXED` |

### 可延后

- `DEFERRED`：`admGroupValid` 用模板 provider 集合（保守偏离）。
- `DEFERRED`：`migration.mjs` 手抄 `validateAdmGroup` 会漂移。
- `DEFERRED`：`externalCarry.dropped` 重放日志不幂等。

### 未覆盖

- `NOT COVERED`：跨文件 helper。
- `NOT COVERED`：动态计算属性名。
- `NOT COVERED`：eval/反射。
- `NOT COVERED`：语法错误 fail-open。
- `NOT COVERED`：src 下 .mjs/.js 不扫。

### 验证数字

- P1-1：39 pass / 199 expect。
- P1-2：5 个新绕过例全 CAUGHT；16 pass / 123 expect；真实扫描 42 文件 0 违规。
- 全量：994 pass / 2 skip / 0 fail。
- tsc：0。

## 第三轮

- 已落地 commit：`5854377` / `8f4dcb2`
- 裁定：`GO-WITH-CONDITIONS`
- 当前 W13 正在修 T8a2 的 3 条 P1 与若干 P2。

### 必须修

| 级别 | 问题 | commit | 状态 |
| --- | --- | --- | --- |
| P1-1 | 已由 `8f4dcb2` 修复。 | `8f4dcb2` | `FIXED` |
| P1 | T8a2：坏旧 YAML 静默丢设置。 | — | `IN PROGRESS` |
| P1 | T8a2：伪造 4 model id dropped。 | — | `IN PROGRESS` |
| P1 | T8a2：模板解析不 fail-fast。 | — | `IN PROGRESS` |
| P2 | T8a2：若干 P2。 | — | `IN PROGRESS` |

### 可延后

—

### 未覆盖

—

### 验证数字

—
