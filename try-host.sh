#!/bin/bash
# Try dsh-opentui in host mode: prints a short keymap banner, then execs ./dsh-opentui.
set -euo pipefail
cd "$(dirname "$0")"

cat <<'EOF'
┌─────────────────────────────────────────────────────┐
│ dsh-opentui (host mode) — type to ask, Enter to send │
│ Tool approvals: y allow / n decline                  │
│ esc aborts the turn · /help /model /usage /clear     │
│ Ctrl+C quits                                         │
└─────────────────────────────────────────────────────┘
EOF

exec ./dsh-opentui "$@"
