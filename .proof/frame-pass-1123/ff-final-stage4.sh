#!/bin/bash
# Archival frame pass — stage 4 redo (compact 24 rows). Run with bash.
T="tmux -L uibatchframe"
D=/private/tmp/ff-final
R=$D/results.txt
S() { $T send-keys -t frame "$@"; }
cap() { $T capture-pane -e -p -t frame > "$D/$1.ans"; }
plain() { sed 's/\x1b\[[0-9;]*m//g' "$1" | sed 's/[[:space:]]*$//'; }
ROWOF() { $T capture-pane -p -t frame | grep -n '1 main\|2 todo' | head -1 | cut -d: -f1; }
click() {
  local x=$1 y seq
  y=$(ROWOF)
  printf -v seq '\e[<0;%s;%sM' "$x" "$y"
  $T send-keys -t frame -l "$seq"; sleep 0.15
  printf -v seq '\e[<0;%s;%sm' "$x" "$y"
  $T send-keys -t frame -l "$seq"; sleep 0.7
}

# clear the garbage typed by the broken script: ctrl+c with text and no selection
S C-c; sleep 0.8; cap 20-compact-cleared-by-ctrl-c
echo "ctrl+c clear: placeholder=$($T capture-pane -p -t frame | grep -c '┃ 输入消息') quitdialog=$($T capture-pane -p -t frame | grep -c '退出 dsh-opentui')" | tee -a "$R"

if [ -z "$(ROWOF)" ]; then
  S -l '用bash执行 sleep 16 然后回复K24b'; S Enter; sleep 4
fi
cap 21-compact-main
click 17; cap 22-compact-todo
click 05; cap 23-compact-main-again
click 16; cap 24-compact-todo-again
for f in 21-compact-main 22-compact-todo 23-compact-main-again 24-compact-todo-again; do
  echo "$f: $(plain "$D/$f.ans" | grep -a '1 main' | cut -c1-40) composer=$(plain "$D/$f.ans" | grep -a '输入消息' | cut -c1-1)" | tee -a "$R"
done
echo "stage4-redo-done" | tee -a "$R"
