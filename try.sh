#!/bin/bash
# dsh-opentui 一键试跑：优先独立二进制（零依赖），没有就用 bun 跑源码。
# 用法:
#   ./try.sh                        # 默认模型（复用 ~/.dsh profile 的 workhorse）
#   ./try.sh --model zai-coding-cn/glm-5.2
set -euo pipefail
cd "$(dirname "$0")"

BIN=build/dsh-opentui-darwin-arm64

cat <<'EOF'
┌─────────────────────────────────────────────────────┐
│ dsh-opentui — 直接打字提问，回车发送                  │
│ 思考流(灰) → 工具审批卡: y 允许 / n 拒绝 → 回复       │
│ esc 中止本轮 · /help /model /usage /clear · Ctrl+C 退出 │
└─────────────────────────────────────────────────────┘
EOF

if [[ -x "$BIN" ]]; then
  exec "./$BIN" "$@"
elif command -v bun >/dev/null 2>&1; then
  (cd packages/shell && exec bun src/main.tsx "$@")
else
  echo "没有二进制也没有 bun：先 ./try.sh 之前跑一次 cd packages/shell && bun build.ts" >&2
  exit 1
fi
