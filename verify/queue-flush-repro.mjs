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
//      follow at the turn end, in submission order.
//
// Exit 0 = every check passed; exit 1 = at least one failed (pane captures are
// kept under verify/queue-flush-out/); exit 2 = environment problem.
//
// Isolation: uniquely named tmux session, killed individually; the scratch
// host is reaped through its scratch lock file.

import { spawnSync } from 'node:child_process'
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const LAUNCHER = join(REPO, 'dsh-opentui')
const PROFILE = 'opentui'
const REAL_HOME = process.env.DSH_HOME_REAL || join(homedir(), '.dsh')
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

for (const cmd of ['tmux', 'bun'])
	if (sh('which', [cmd]).status !== 0) {
		console.error(`queue-flush: ${cmd} not on PATH`)
		process.exit(2)
	}
if (!existsSync(join(REAL_HOME, 'profiles', PROFILE))) {
	console.error(`queue-flush: profile '${PROFILE}' missing under ${REAL_HOME}`)
	process.exit(2)
}
if (!existsSync(LAUNCHER)) {
	console.error(`queue-flush: launcher missing: ${LAUNCHER}`)
	process.exit(2)
}
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true })

// --- scratch home (same isolation as steer-queue-repro) ---
const HOME = mkdtempSync(join(tmpdir(), 'dsh-queue-flush-home-'))
chmodSync(HOME, 0o700)
const WS = mkdtempSync(join(tmpdir(), 'dsh-queue-flush-ws-'))
mkdirSync(join(HOME, 'profiles'), { recursive: true })
cpSync(join(REAL_HOME, 'profiles', PROFILE), join(HOME, 'profiles', PROFILE), { recursive: true })
for (const rel of ['.credentials.yaml', 'models-store.json', 'model-profiles.json', 'workspace-presets.json', 'settings.yaml', 'agents', 'themes']) {
	const from = join(REAL_HOME, rel)
	if (existsSync(from)) cpSync(from, join(HOME, rel), { recursive: true })
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
	writeFileSync(join(OUT, `${name}.ans`), capture(session, true))
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
	const queued1 = await waitPane(SESS, (o) => has(o, '排队等待') && has(o, '#1'), 8_000)
	// The second line lands while q1 waits: the turn is still running.
	await typeFast(SESS, 'second queued prompt')
	const popup2 = await waitPane(SESS, queuePopup, 15_000)
	if (popup2.ok) {
		sendKeys(SESS, 'Down')
		await sleep(120)
		sendKeys(SESS, 'Enter')
	}
	const queued2 = await waitPane(SESS, (o) => has(o, '排队等待') && has(o, '#2'), 8_000)
	snap('03-queued')
	record('two lines queue behind the running turn', popup1.ok && queued1.ok && popup2.ok && queued2.ok,
		[queued1.ok ? '⏸ #1 visible' : 'q1 row not visible', queued2.ok ? '⏸ #2 visible' : 'q2 row not visible'])

	// ---------------- 3. abort keeps the queue (paused) ----------------
	sendKeys(SESS, 'Escape')
	const paused = await waitPane(SESS, (o) => has(o, '已暂停') && has(o, '#1'), 10_000)
	snap('04-paused')
	record('abort keeps the queue and marks it paused', paused.ok,
		[paused.ok ? '⏸ 已暂停 #1 visible' : 'paused queue row not visible'])
	await waitPane(SESS, idle, 15_000)

	// ---------------- 4. /flush restarts the pump NOW ----------------
	await typeFast(SESS, '/flush')
	const flushed = await waitPane(SESS,
		(o) => has(o, 'queue flushed') && has(o, '1 prompt(s) sending now') && has(o, '1 still queued'), 10_000)
	snap('05-flushed')
	record('/flush delivers the paused head immediately', flushed.ok,
		[flushed.ok ? 'queue flushed — 1 sending now, 1 still queued visible' : 'flush receipt not visible'])

	// The rest follows at the turn end: both prompt texts reach the transcript
	// as real user messages (the queue wait rows are gone).
	const delivered = await waitPane(SESS,
		(o) => has(o, 'first queued prompt') && has(o, 'second queued prompt') && !has(o, '排队等待'), 90_000, 500)
	snap('06-delivered')
	record('the flushed queue drains in order, one per turn end',
		delivered.ok && !has(delivered.out, '排队等待'),
		[delivered.ok ? 'both prompts in the transcript, no wait rows' : 'tail prompt not delivered'])

	const err = capture(SESS)
	const crash = /TypeError|ReferenceError|Cannot read propert|Unhandled error|panic/.exec(err)
	record('no crash markers in the client scrollback', crash === null, [crash ? crash[0] : 'clean'])
} catch (error) {
	crashed = error
	console.error('queue-flush: run failed:', error?.stack ?? error)
} finally {
	if (!KEEP) killSession(SESS)
	reapHost()
	try {
		writeFileSync(join(OUT, 'summary.json'), JSON.stringify({ results, crashed: crashed ? String(crashed) : null }, null, 2))
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
