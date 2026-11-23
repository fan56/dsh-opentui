#!/bin/bash
# Archival frame pass — stage 3/4 (final pack). Run with bash.
T="tmux -L uibatchframe"
D=/private/tmp/ff-final
R=$D/results.txt
S() { $T send-keys -t frame "$@"; }
cap() { $T capture-pane -e -p -t frame > "$D/$1.ans"; }
plain() { sed 's/\x1b\[[0-9;]*m//g' "$1" | sed 's/[[:space:]]*$//'; }
ROWOF() { $T capture-pane -p -t frame | grep -n '1 main\|2 todo' | head -1 | cut -d: -f1; }
click() { local x=$1; local y; y=$(ROWOF); $T send-keys -t frame -l $'\e[<0;'"$x"';'"$y"M"; sleep 0.15; $T send-keys -t frame -l $'\e[<0;'"$x"';'"$y"m"; sleep 0.7; }

for f in 09-tab-main-framed 10-tab-todo-framed 11-tab-main-again-framed; do
  echo "$f: $(plain "$D/$f.ans" | grep -a '1 main' | cut -c1-44)" | tee -a "$R"
done

# stage 3: subagent brief (framed 40 rows)
S M-1; sleep 0.5
S -l '请并行启动3个子代理，每个子代理依次执行4条bash命令(每条是 echo step N; sleep 3)，全部完成后回复FIN'
S Enter
for i in $(seq 1 26); do
  sleep 1
  [ "$i" = 6 ] && cap 13-subagent-brief-a
  [ "$i" = 12 ] && cap 14-subagent-brief-b
  [ "$i" = 20 ] && cap 15-subagent-brief-c
done
sleep 10
cap 16-after-all-done
for f in 13-subagent-brief-a 14-subagent-brief-b 15-subagent-brief-c; do
  echo "$f: $(plain "$D/$f.ans" | grep -a 'subagent \*' | sed 's/^│//')" | tee -a "$R"
done
echo "brief-gone-after-done=$($T capture-pane -p -t frame | grep -c 'subagent \*') FIN=$($T capture-pane -p -t frame | grep -c '^│FIN')" | tee -a "$R"

# stage 4: compact 24 rows — marker + mouse both directions + transcript rows
$T resize-window -t frame -x 80 -y 24; sleep 3
S -l '用bash执行 sleep 14 然后回复K24'; S Enter; sleep 4
cap 17-compact-main
click 17; cap 18-compact-todo
click 05; cap 19-compact-main-again
for f in 17-compact-main 18-compact-todo 19-compact-main-again; do
  echo "$f: $(plain "$D/$f.ans" | grep -a '1 main' | cut -c1-40)" | tee -a "$R"
done
echo "stage3-4-done" | tee -a "$R"
