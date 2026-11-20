#!/usr/bin/env bash
# Render e2e/report.md from the v2 item ledger.
#
# The ledger (v2-items.tsv) is written by lib/assert-v2.sh; one row per
# assertion with an A/B/C class, an L1/L2/L3 level, a verdict, the geometry and
# — for B rows — the wrong criterion and the correct one. Gate-dark SKIPs are
# rows too, so they cannot disappear into a warn counter.
set -u

# Escape a TSV field for a markdown table cell (regexes often contain '|').
md_cell() { printf '%s' "$1" | sed 's/|/\\|/g'; }

v2_render_report() {
  local results_dir="${1:-${RESULTS_DIR:-/tmp/e2e-results}}"
  local items="$results_dir/v2-items.tsv" out="$results_dir/report.md"
  local tmp="${out}.tmp"
  mkdir -p "$results_dir"

  local total=0 p=0 f=0 s=0
  local ca=0 cb=0 cc=0 l1=0 l2=0 l3=0
  local sizes=''
  if [ -f "$items" ]; then
    while IFS=$'\t' read -r scen matrix class level verdict name size wrong fact detail; do
      [ "$scen" = 'scenario' ] && continue # header
      total=$((total + 1))
      case "$verdict" in
        PASS) p=$((p + 1)) ;;
        FAIL) f=$((f + 1)) ;;
        SKIP) s=$((s + 1)) ;;
      esac
      case "$class" in A) ca=$((ca + 1)) ;; B) cb=$((cb + 1)) ;; C) cc=$((cc + 1)) ;; esac
      case "$level" in L1) l1=$((l1 + 1)) ;; L2) l2=$((l2 + 1)) ;; L3) l3=$((l3 + 1)) ;; esac
      case " $sizes " in *" $size "*) ;; *) sizes="${sizes}${sizes:+ }${size}" ;; esac
    done <"$items"
  fi

  {
    printf '# dsh-opentui e2e v2 report\n\n'
    printf 'Generated from `%s`. Verdict rules: A 真缺陷 / B 判据错误 / C 预期行为;\n' "$items"
    printf 'L1 有响应 / L2 状态真变 / L3 模型可感知. Silent no-op is always FAIL.\n\n'
    printf '## Summary\n\n'
    printf '| metric | count |\n|---|---:|\n'
    printf '| items | %d |\n' "$total"
    printf '| PASS | %d |\n' "$p"
    printf '| FAIL | %d |\n' "$f"
    printf '| SKIP | %d |\n\n' "$s"
    printf '| class | count |\n|---|---:|\n'
    printf '| A 真缺陷 | %d |\n| B 判据错误 | %d |\n| C 预期行为 | %d |\n\n' "$ca" "$cb" "$cc"
    printf '| level | count |\n|---|---:|\n'
    printf '| L1 有响应 | %d |\n| L2 状态真变 | %d |\n| L3 模型可感知 | %d |\n\n' "$l1" "$l2" "$l3"
    printf 'Geometries exercised: %s\n\n' "${sizes:-none}"

    printf '## Per-item results\n\n'
    printf '| scenario | matrix | class | level | verdict | size | name |\n'
    printf '|---|---|---|---|---|---|---|\n'
    if [ -f "$items" ]; then
      while IFS=$'\t' read -r scen matrix class level verdict name size wrong fact detail; do
        [ "$scen" = 'scenario' ] && continue
        printf '| %s | %s | %s | %s | %s | %s | %s |\n' \
          "$(md_cell "$scen")" "$(md_cell "$matrix")" "$(md_cell "$class")" \
          "$(md_cell "$level")" "$(md_cell "$verdict")" "$(md_cell "$size")" \
          "$(md_cell "$name")"
      done <"$items"
    fi
    printf '\n'

    printf '## B class — wrong criterion vs correct criterion\n\n'
    printf 'Every B row must show both criteria (0234-fix-design-v3.md §6).\n\n'
    local bcount=0
    if [ -f "$items" ]; then
      while IFS=$'\t' read -r scen matrix class level verdict name size wrong fact detail; do
        [ "$scen" = 'scenario' ] && continue
        [ "$class" = 'B' ] || continue
        bcount=$((bcount + 1))
        printf '### %s / %s — %s (%s, %s)\n\n' "$scen" "$matrix" "$name" "$verdict" "$size"
        printf -- '- wrong criterion: %s\n' "${wrong:-(missing — see scenario source comment)}"
        printf -- '- correct criterion: %s\n' "${fact:-(missing — see scenario source comment)}"
        printf -- '- detail: %s\n\n' "$detail"
      done <"$items"
    fi
    if (( bcount == 0 )); then printf '(none)\n\n'; fi

    printf '## SKIP list (gate-dark / unexercisable — never a PASS)\n\n'
    local scount=0
    if [ -f "$items" ]; then
      while IFS=$'\t' read -r scen matrix class level verdict name size wrong fact detail; do
        [ "$scen" = 'scenario' ] && continue
        [ "$verdict" = 'SKIP' ] || continue
        scount=$((scount + 1))
        printf -- '- **%s / %s** (%s): %s — %s\n' "$scen" "$matrix" "$name" "$size" "$detail"
      done <"$items"
    fi
    if (( scount == 0 )); then printf '(none)\n\n'; fi
    printf '\n'

    printf '## Per-scenario counters (v1 compatibility)\n\n'
    printf '| scenario | pass | fail | warn | v2 pass | v2 fail | v2 skip |\n'
    printf '|---|---:|---:|---:|---:|---:|---:|\n'
    local rf name pv fv wv v2p v2f v2s
    for rf in "$results_dir"/*.result; do
      [ -f "$rf" ] || continue
      case "$rf" in *.v2.result) continue ;; esac
      name="$(basename "$rf" .result)"
      read -r pv fv wv <"$rf"
      v2p=0 v2f=0 v2s=0
      if [ -f "$results_dir/$name.v2.result" ]; then
        read -r v2p v2f v2s <"$results_dir/$name.v2.result"
      fi
      printf '| %s | %s | %s | %s | %s | %s | %s |\n' \
        "$name" "$pv" "$fv" "$wv" "$v2p" "$v2f" "$v2s"
    done
    printf '\n'
  } >"$tmp"
  mv "$tmp" "$out"
  printf '==> report written to %s\n' "$out"
}
