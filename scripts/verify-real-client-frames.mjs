/**
 * 025 W2-3 review C-2 — answer-bearing assertion over the frames that
 * `scripts/real-client-gate.sh` ALREADY captures. Before this script the gate
 * only emitted `picker=yes/no` / `section=yes/no` as INFO lines: a fake-empty
 * .ans (BLOCKED mode writes empty frames) could never fail the verdict. This
 * script makes those observations load-bearing: its exit code is chained into
 * the gate verdict (`node ... || exit 2`), so an empty/absent frame FAILs the
 * gate. Locale-complete (en + zh markers), numeric .ans only, no PNG.
 *
 *   node scripts/verify-real-client-frames.mjs <outDir>
 */
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const OUT = process.argv[2]
if (!OUT) {
  console.error('usage: verify-real-client-frames.mjs <outDir>')
  process.exit(2)
}

const findings = []
const check = (name, ok, evidence = '') => {
  findings.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${evidence ? '  ' + evidence : ''}`)
  if (!ok) process.exitCode = 1
}

const readText = (f) => {
  const p = join(OUT, f)
  if (!existsSync(p)) return ''
  // strip ANSI so grep-equivalent checks see visible text; .ans is numeric only.
  return readFileSync(p, 'utf8')
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b[@-Z\\-_]/g, '')
}

// Each frame must be non-empty AND show a real panel/marker — never a fake
// empty pane. Markers accept both en and zh (C4 locale-complete discipline).
const specs = [
  { file: 'sk-08-basic.log', name: 'basic composer', re: /rc-gate-probe|Type a message|输入消息|提问，回车发送/ },
  { file: 'sk-06-modal.log', name: 'quit confirm modal', re: /quit|退出|╭|┌|cancel|取消/ },
  { file: 'sk-07-pgup-pgdn.log', name: '/agents paging panel', re: /agents|agent|╭|┌/ },
  { file: 's1-model.log', name: '/model picker', re: /model|模型|provider|供应商/ },
  { file: 's2-account.log', name: '/settings account section', re: /account|账户|账号|\/login/ },
]
for (const spec of specs) {
  const text = readText(spec.file)
  check(`frame ${spec.name}: non-empty + real-data marker`,
    text.trim().length > 0 && spec.re.test(text),
    `bytes=${text.length} marker=${spec.re.test(text)}`)
}

// SENTINEL / credential zero-leak (defence in depth; the desens scan is final).
for (const spec of specs) {
  const text = readText(spec.file)
  check(`frame ${spec.name}: no credential/SENTINEL leak`,
    !/apiKey|access_token|W2_4_SENTINEL|authorize_url/i.test(text))
}

const report = findings.join('\n') + '\n'
console.log(report)
console.log(`TOTAL ${findings.filter((f) => f.startsWith('PASS')).length}/${findings.length} PASS`)
