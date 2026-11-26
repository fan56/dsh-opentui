#!/usr/bin/env node
// Real-client gate for the explicit queue flush (/flush).
//
//   node verify/queue-flush-repro.mjs [--cols 120] [--rows 34] [--keep]
//
// What it proves against the REAL launcher (same scratch-DSH_HOME isolation
// as verify/steer-queue-repro.mjs — nothing is written to ~/.dsh):
//   1. /flush on an empty queue answers "queue is empty — nothing to flush"
//      (the no-op is never silent);
//   2. two lines queued behind a running turn are KEPT and marked paused when
//      that turn is aborted (the documented failure/abort policy);
//   3. /flush restarts the paused pump: the head is delivered NOW
//      ("queue flushed — 1 prompt(s) sending now, 1 still queued"), the rest
//      follow at the turn end, in submission order. The order check REQUIRES
//      two observed queue rows (#1/#2) and two distinct transcript user rows
//      in submission order — an empty queue can never satisfy it.
//
// Real model leg: credentials are REFERENCED, never copied into argv, logs or
// scratch plaintext — the real ~/.dsh/.credentials.yaml is linked BY PATH into
// the scratch home (same contract as verify/remote-live-smoke.mjs). Missing
// credentials / prerequisite = exit 2 = NOT RUN (ENV), never a pass.
//
// Exit 0 = every check passed; exit 1 = at least one failed (pane captures are
// kept under verify/queue-flush-out/); exit 2 = environment problem / NOT RUN.
//
// Isolation: uniquely named tmux session, killed individually; the scratch
// host is reaped through its scratch lock file.

import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEFAULT_PROFILE } from '../packages/shell/scripts/lib/profile-name.mjs'
import { provisionScratchProfile } from './lib/scratch-profile.mjs'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const LAUNCHER = join(REPO, 'dsh-opentui')
const REAL_HOME = process.env.DSH_HOME_REAL || join(homedir(), '.dsh')
const CREDENTIALS = join(REAL_HOME, '.credentials.yaml')
const PROFILE = DEFAULT_PROFILE
const IDLE = '提问，回车发送'
const PLACEHOLDER = 'Type a message'
const SESS = `queue-flush-${process.pid}`
const OUT = join(REPO, 'verify', 'queue-flush-out')

const arg = (name, def) => {
	const i = process.argv.indexOf(`--${name}`)
	return i >= 0 ? process.argv[i + 1] : def
}
const COLS = Number(arg('cols', '120'))
const ROWS = Number(arg('rows', '34'))
const KEEP = process.argv.includes('--keep')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const sh = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: 'utf8', ...opts })
const tmux = (...a) => sh('tmux', a)
const tmuxOut = (...a) => (tmux(...a).status === 0 ? tmux(...a).stdout : '')
const flat = (s) => String(s).replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, '')
const has = (out, marker) => flat(out).includes(flat(marker))
const hasAny = (out, markers) => markers.some((m) => has(out, m))
/** Never persist a copied secret into a snapshot or summary. */
const scrub = (text) =>
  String(text ?? '')
    .replace(/(sk-[A-Za-z0-9_-]{8,}|Bearer\s+\S+|api[_-]?key["':= ]+[^\s"',}]{6,})/gi, '<redacted>')
const notRun = (reason) => {
  console.error(`queue-flush: NOT RUN (ENV) ${reason}`)
  process.exit(2)
}

for (const cmd of ['tmux', 'bun'])
	if (sh('which', [cmd]).status !== 0) {
		console.error(`queue-flush: ${cmd} not on PATH`)
		process.exit(2)
	}
if (!existsSync(LAUNCHER)) {
	console.error(`queue-flush: launcher missing: ${LAUNCHER}`)
	process.exit(2)
}
if (!existsSync(CREDENTIALS) || statSync(CREDENTIALS).size === 0)
	notRun('no provider credentials in the real DSH_HOME (referenced by path, contents never read into logs)')
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true })

// --- scratch home (same isolation as steer-queue-repro) ---
const HOME = mkdtempSync(join(tmpdir(), 'dsh-queue-flush-home-'))
chmodSync(HOME, 0o700)
const WS = mkdtempSync(join(tmpdir(), 'dsh-queue-flush-ws-'))
let profileDir
try {
  profileDir = provisionScratchProfile({ home: HOME, repo: REPO })
} catch (error) {
  notRun(`scratch profile provisioning failed: ${scrub(error.message)}`)
}
// Pin the scratch UI language to en: every assertion below matches the English
// copy ("steer or queue", "Queued", "Paused", "queue flushed"), so a host
// default of zh-CN would make the run fail for a locale reason, not a product one.
try {
  const cfgPath = join(profileDir, 'config.json')
  const cfg = existsSync(cfgPath) ? JSON.parse(readFileSync(cfgPath, 'utf8')) : {}
  cfg.lang = 'en'
  writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n')
} catch (error) {
  notRun(`scratch config pin failed: ${scrub(error.message)}`)
}
// Reference the REAL credential FILE BY PATH (symlink), never copy its value
// into argv, a log or scratch plaintext. No fabricated placeholder key: a
// missing/invalid key stays an honest ENV NOT RUN.
try {
  const scratchCreds = join(HOME, '.credentials.yaml')
  rmSync(scratchCreds, { force: true })
  symlinkSync(CREDENTIALS, scratchCreds, 'file')
} catch (error) {
  notRun(`scratch credential link failed: ${scrub(error.message)}`)
}

const LOCK = join(HOME, `opentui-host.${PROFILE}.json`)
const readLock = () => {
	try {
		const raw = JSON.parse(readFileSync(LOCK, 'utf8'))
		return typeof raw.pid === 'number' ? raw : null
	} catch {
		return null
	}
}
const reapHost = () => {
	const lock = readLock()
	if (!lock) return
	const sig = (p, s) => {
		try {
			process.kill(-p, s)
		} catch {
			try {
				process.kill(p, s)
			} catch {}
		}
	}
	sig(lock.pid, 'SIGTERM')
	for (let i = 0; i < 20; i++) {
		try {
			process.kill(lock.pid, 0)
			sleep(250)
		} catch {
			break
		}
	}
	try {
		process.kill(lock.pid, 'SIGKILL')
	} catch {}
	rmSync(LOCK, { force: true })
}

const results = []
const record = (item, ok, detail = []) => {
	results.push({ item, ok, detail })
	console.log(`${(ok ? 'PASS' : 'FAIL').padEnd(5)} ${item}${detail.length ? ` — ${detail.join(' | ')}` : ''}`)
}

const capture = (session = SESS, esc = false) => {
	const args = ['capture-pane', '-p', '-t', session]
	if (esc) args.push('-e')
	return tmuxOut(...args)
}
const sendKeys = (session, ...keys) => tmux('send-keys', '-t', session, ...keys)
/** One burst write (no per-char gaps): the busy window is short and the
 * composer sets busy synchronously, so this reliably lands on a running turn. */
const typeFast = async (session, text) => {
	sendKeys(session, '-l', text)
	await sleep(40)
	sendKeys(session, 'Enter')
}
const composerRows = (out) =>
	out
		.split('\n')
		.filter((l) => l.trimStart().startsWith('┃'))
		.map((l) => l.trim().replace(/^┃/, '').replace(/┃$/, '').trim())
const composerEmpty = (out) => composerRows(out).every((l) => l === '' || l.startsWith(PLACEHOLDER))
const idle = (out) => out.includes(IDLE) || composerEmpty(out)
const waitPane = async (session, pred, timeoutMs, everyMs = 300) => {
	const deadline = Date.now() + timeoutMs
	let last = ''
	while (Date.now() < deadline) {
		const frame = capture(session)
		if (frame.trim().length > 0) last = frame
		try {
			if (last && pred(last)) return { ok: true, out: last }
		} catch {
			/* keep waiting */
		}
		await sleep(everyMs)
	}
	return { ok: false, out: last }
}
const snap = (name, session = SESS) => {
	const esc = capture(session, true)
	writeFileSync(join(OUT, `${name}.ans`), scrub(esc))
	console.log(`  snapshot: verify/queue-flush-out/${name}.ans`)
	return capture(session)
}
const launch = (session, cols, rows) => {
	tmux('kill-session', '-t', session)
	const env = [`DSH_HOME=${HOME}`, 'DSH_OPENTUI_DEBUG=1']
	const r = tmux('new-session', '-d', '-x', String(cols), '-y', String(rows), '-s', session, '-c', WS,
		`${env.join(' ')} ${LAUNCHER} --client 2>${join(OUT, `${session}.err.log`)}`)
	if (r.status !== 0) throw new Error('tmux boot failed: ' + r.stderr)
}
const killSession = (session) => tmux('kill-session', '-t', session)

const queuePopup = (o) => has(o, 'steer or queue') && hasAny(o, ['Steer']) && hasAny(o, ['Queue'])

let crashed = null
try {
	launch(SESS, COLS, ROWS)
	const boot = await waitPane(SESS, (o) => o.includes('🧠') || idle(o), 90_000, 500)
	if (!boot.out.includes('🧠') && !idle(boot.out)) {
		console.error('client never rendered:\n' + boot.out.slice(-1500))
		process.exit(2)
	}
	await waitPane(SESS, idle, 30_000)
	snap('01-welcome')

	// ---------------- 1. empty queue: /flush is not silent ----------------
	await typeFast(SESS, '/flush')
	const empty = await waitPane(SESS, (o) => has(o, 'queue is empty') && has(o, 'nothing to flush'), 10_000)
	snap('02-empty')
	record('/flush on an empty queue reports the no-op', empty.ok,
		[empty.ok ? 'queue is empty — nothing to flush visible' : 'empty-queue notice not visible'])
	await waitPane(SESS, idle, 15_000)

	// ---------------- 2. queue two lines, then abort the turn ----------------
	await typeFast(SESS, 'Reply with just: OK')
	await typeFast(SESS, 'first queued prompt')
	const popup1 = await waitPane(SESS, queuePopup, 15_000)
	if (popup1.ok) {
		sendKeys(SESS, 'Down')
		await sleep(120)
		sendKeys(SESS, 'Enter')
	}
	const queued1 = await waitPane(SESS, (o) => has(o, 'Queued') && has(o, '#1'), 8_000)
	// The second line lands while q1 waits: the turn is still running.
	await typeFast(SESS, 'second queued prompt')
	const popup2 = await waitPane(SESS, queuePopup, 15_000)
	if (popup2.ok) {
		sendKeys(SESS, 'Down')
		await sleep(120)
		sendKeys(SESS, 'Enter')
	}
	const queued2 = await waitPane(SESS, (o) => has(o, 'Queued') && has(o, '#2'), 8_000)
	snap('03-queued')
	record('two lines queue behind the running turn', popup1.ok && queued1.ok && popup2.ok && queued2.ok,
		[queued1.ok ? '⏸ #1 visible' : 'q1 row not visible', queued2.ok ? '⏸ #2 visible' : 'q2 row not visible'])

	// ---------------- 3. abort keeps the queue (paused) ----------------
	// U6 stop contract (turn-cancel.tsx): the first Esc only ARMS, a second Esc
	// inside the window opens `Stop everything?`, and Enter confirms it. A bare
	// Esc leaves the turn running, so the queue would never enter Paused.
	sendKeys(SESS, 'Escape')
	await sleep(150)
	sendKeys(SESS, 'Escape')
	await sleep(350)
	sendKeys(SESS, 'Enter')
	const paused = await waitPane(SESS, (o) => has(o, 'Paused') && has(o, '#1'), 10_000)
	snap('04-paused')
	record('abort keeps the queue and marks it paused', paused.ok,
		[paused.ok ? '⏸ Paused #1 visible' : 'paused queue row not visible'])
	await waitPane(SESS, idle, 15_000)

	// ---------------- 4. /flush restarts the pump NOW ----------------
	await typeFast(SESS, '/flush')
	const flushed = await waitPane(SESS,
		(o) => has(o, 'queue flushed') && has(o, '1 prompt(s) sending now') && has(o, '1 still queued'), 10_000)
	snap('05-flushed')
	record('/flush delivers the paused head immediately', flushed.ok,
		[flushed.ok ? 'queue flushed — 1 sending now, 1 still queued visible' : 'flush receipt not visible'])

	// The rest follows at the turn end: BOTH queued prompts must land as real
	// transcript user rows, in submission order, with no wait rows left.
	// This is not a vacuous check: it requires the #1/#2 queue rows observed in
	// step 2, and it ignores wait rows / the composer so a stale or empty
	// queue can never satisfy it.
	const Q1 = 'first queued prompt'
	const Q2 = 'second queued prompt'
	// A delivered line is a REAL user row, painted with ❯ — require it
	// positively (a bare marker could also be composer text or a tool echo).
	// Still exclude the wait rows Queued/Paused and their #1/#2 numbering.
	// Use RAW includes for #1/#2: `has()` flattens away the '#', so has(line,
	// '#1') matches any stray '1' on a real transcript row and wrongly drops it.
	const rowIndex = (out, marker) =>
		String(out)
			.split('\n')
			.findIndex((line) =>
				has(line, marker) &&
				line.includes('❯') &&
				!has(line, 'Queued') && !has(line, 'Paused') &&
				!line.includes('#1') && !line.includes('#2'))
	const delivered = await waitPane(SESS,
		(o) => rowIndex(o, Q1) >= 0 && rowIndex(o, Q2) > rowIndex(o, Q1) && !has(o, 'Queued'),
		90_000, 500)
	snap('06-delivered')
	const i1 = rowIndex(delivered.out, Q1)
	const i2 = rowIndex(delivered.out, Q2)
	// queued1/queued2 are folded into the order assertion below only — not
	// recorded a second time, which would inflate the check count.
	const queueWasReal = queued1.ok && queued2.ok
	record('the flushed queue drains both prompts in submission order',
		queueWasReal && delivered.ok && i1 >= 0 && i2 > i1 && !has(delivered.out, 'Queued'),
		[`transcript rows ${i1}/${i2} (#1/#2)`, delivered.ok ? 'no wait rows' : 'tail not delivered or out of order'])

	const err = capture(SESS)
	const crash = /TypeError|ReferenceError|Cannot read propert|Unhandled error|panic/.exec(err)
	record('no crash markers in the client scrollback', crash === null, [crash ? crash[0] : 'clean'])
} catch (error) {
	crashed = error
	console.error('queue-flush: run failed:', error?.stack ?? error)
} finally {
	if (!KEEP) killSession(SESS)
	reapHost()
	// The client may echo an env value into its stderr log; scrub on disk too.
	try {
		const errPath = join(OUT, `${SESS}.err.log`)
		if (existsSync(errPath)) writeFileSync(errPath, scrub(readFileSync(errPath, 'utf8')))
	} catch {}
	try {
		writeFileSync(join(OUT, 'summary.json'), JSON.stringify({ results, crashed: crashed ? scrub(String(crashed)) : null }, null, 2))
	} catch {}
	if (!KEEP) {
		try {
			rmSync(HOME, { recursive: true, force: true })
		} catch {}
		try {
			rmSync(WS, { recursive: true, force: true })
		} catch {}
	}
}

const failed = results.filter((r) => !r.ok).length
console.log(`\nqueue-flush: ${results.length - failed}/${results.length} checks passed`)
if (crashed || failed > 0) process.exit(1)
