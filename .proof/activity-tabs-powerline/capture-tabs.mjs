#!/usr/bin/env node
// Proof capture driver for the activity powerline tab strip.
//
// Boots the REAL launcher against an isolated scratch DSH_HOME with the offline
// mock LLM, drives one live turn, then captures the tmux pane with ANSI escapes
// while the activity dock is latched. Same script runs against a pre-change
// worktree (--repo) so the baseline uses the identical commands.
//
//   node .proof/activity-tabs-powerline/capture-tabs.mjs \
//     --repo /abs/repo --out /abs/repo/.proof/activity-tabs-powerline \
//     --prefix 02-framed --geoms 80x40,80x24,27x40
//
// Nothing is written to ~/.dsh: DSH_HOME/HOME are fresh temp dirs per run.

import { spawn, spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const argv = process.argv.slice(2)
const arg = (name, fallback) => {
	const i = argv.indexOf(name)
	return i >= 0 ? argv[i + 1] : fallback
}
const REPO = resolve(arg('--repo', process.cwd()))
const OUT = resolve(arg('--out', join(REPO, '.proof', 'activity-tabs-powerline')))
const PREFIX = arg('--prefix', '02-framed')
const GEOMS = arg('--geoms', '80x40,80x24,27x40').split(',').map((s) => {
	const [cols, rows] = s.split('x').map(Number)
	return { cols, rows, label: `${cols}x${rows}` }
})
const LAUNCHER = join(REPO, 'dsh-opentui')
const MOCK = join(REPO, 'e2e', 'lib', 'mock-llm.mjs')
const PROMPT = 'Walk the migration plan one more time. E2E_BTW_MAIN'
const IDLE = '提问，回车发送'
const PLACEHOLDER = 'Type a message'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const sh = (cmd, a, opts = {}) => spawnSync(cmd, a, { encoding: 'utf8', timeout: 120_000, ...opts })
const tmux = (...a) => sh('tmux', a)
const tmuxOut = (...a) => {
	const r = tmux(...a)
	return r.status === 0 ? r.stdout : ''
}
const capture = (session, ansi = false) => tmuxOut('capture-pane', '-p', ...(ansi ? ['-e'] : []), '-t', session)
const sendKeys = (session, ...keys) => tmux('send-keys', '-t', session, ...keys)
const idle = (out) => out.includes(IDLE) || out.split('\n').filter((l) => l.trimStart().startsWith('┃')).every((l) => l.trim() === '' || l.includes(PLACEHOLDER))
const waitPane = async (session, pred, timeoutMs, everyMs = 250) => {
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

mkdirSync(OUT, { recursive: true })
let PORT = 45123
for (let i = 0; i < 20; i++) {
	const probe = sh('node', ['-e', 'fetch(process.argv[1]).then(()=>process.exit(0)).catch(()=>process.exit(1))', `http://127.0.0.1:${PORT}/healthz`])
	if (probe.status !== 0) break
	PORT += 1
}

const HOME = mkdtempSync(join(tmpdir(), 'dsh-tabs-home-'))
chmodSync(HOME, 0o700)
const WS = mkdtempSync(join(tmpdir(), 'dsh-tabs-ws-'))
const AGENTS_HOME = join(HOME, 'agents-home')
mkdirSync(AGENTS_HOME, { recursive: true })
const { provisionScratchProfile } = await import(pathToFileURL(join(REPO, 'verify', 'lib', 'scratch-profile.mjs')).href)
const profileDir = provisionScratchProfile({ home: HOME, repo: REPO })

// Deterministic language and offline model route (same recipe as ui-matrix).
{
	const cfgPath = join(profileDir, 'config.json')
	let cfg = {}
	try {
		cfg = JSON.parse(readFileSync(cfgPath, 'utf8'))
	} catch {}
	cfg.lang = 'en'
	if (argv.includes('--light')) cfg.themeMode = 'light'
	writeFileSync(cfgPath, JSON.stringify(cfg, null, 2))
}
const patchPath = join(profileDir, 'cordis.patch.yml')
{
	let patch = readFileSync(patchPath, 'utf8')
	const withUrl = patch.replace(/(\n {6}zai-coding-cn:\n)/, `$1        baseURL: http://127.0.0.1:${PORT}/v1\n`)
	if (withUrl === patch) throw new Error('could not patch provider baseURL')
	patch = withUrl
	const withWindow = patch.replace(
		/(\n {10}- id: glm-5\.3-flash\n {12}name: glm-5\.3-flash\n)/,
		`$1            contextWindow: 200000\n`,
	)
	if (withWindow === patch) throw new Error('could not patch contextWindow')
	patch = withWindow
	{
		const kept = []
		let skipping = false
		let blockIndent = 0
		for (const line of patch.split('\n')) {
			if (skipping) {
				const indent = /^([ \t]*)/.exec(line)[1].length
				if (line.trim() === '' || indent > blockIndent) continue
				skipping = false
			}
			const m = /^([ \t]*)- id: agent-default-model\s*$/.exec(line)
			if (m) {
				skipping = true
				blockIndent = m[1].length
				continue
			}
			kept.push(line)
		}
		patch = kept.join('\n').replace(/\n*$/, '\n')
	}
	patch += ['- id: agent-default-model', '  name: "@deepseek-ai/dsh-agent-default-model"', '  config:', '    provider: zai-coding-cn', '    model: glm-5.3-flash', '    reasoningEffort: high', ''].join('\n')
	writeFileSync(patchPath, patch)
}

const mockLog = join(OUT, `${PREFIX}-mock-llm.log`)
const mockFd = (await import('node:fs')).openSync(mockLog, 'w')
const mockProc = spawn('node', [MOCK, '--port', String(PORT)], { stdio: ['ignore', mockFd, mockFd] })
let mockUp = false
for (let i = 0; i < 50; i++) {
	try {
		const res = await fetch(`http://127.0.0.1:${PORT}/healthz`)
		if (res.ok) {
			mockUp = true
			break
		}
	} catch {}
	await sleep(100)
}
if (!mockUp) throw new Error(`mock LLM did not answer on 127.0.0.1:${PORT}`)

const readLock = () => {
	try {
		const files = sh('ls', [HOME]).stdout.split('\n').filter((f) => f.startsWith('opentui-host.') && f.endsWith('.json'))
		if (files.length === 0) return null
		const raw = JSON.parse(readFileSync(join(HOME, files[0]), 'utf8'))
		return typeof raw.pid === 'number' ? raw : null
	} catch {
		return null
	}
}
const reapHost = () => {
	const lock = readLock()
	if (!lock) return
	const sig = (pid, s) => {
		try {
			process.kill(-pid, s)
		} catch {
			try {
				process.kill(pid, s)
			} catch {}
		}
	}
	sig(lock.pid, 'SIGTERM')
	for (let i = 0; i < 20; i++) {
		try {
			process.kill(lock.pid, 0)
			sh('sleep', ['0.25'])
		} catch {
			break
		}
	}
	try {
		process.kill(lock.pid, 'SIGKILL')
	} catch {}
}

const runLog = []
const snapshot = (name, session) => {
	const ansi = capture(session, true)
	const text = capture(session)
	writeFileSync(join(OUT, `${name}.ans`), ansi)
	writeFileSync(join(OUT, `${name}.txt`), text)
	return { ansi, text }
}

for (const geom of GEOMS) {
	const session = `${PREFIX.replace(/[^a-zA-Z0-9_-]/g, '')}-${geom.label}`
	tmux('kill-session', '-t', session)
	reapHost()
	const env = [
		`DSH_HOME=${HOME}`,
		`DSH_AGENTS_HOME=${AGENTS_HOME}`,
		'DSH_OPENTUI_DEBUG=1',
		'ZAI_CODING_CN_API_KEY=mock-only-key',
		'ZAI_CODING_CN_BASE_URL=',
	]
	const launched = tmux(
		'new-session', '-d', '-x', String(geom.cols), '-y', String(geom.rows), '-s', session, '-c', WS,
		`${env.join(' ')} ${LAUNCHER} --client 2>${join(OUT, `${session}.err.log`)}`,
	)
	if (launched.status !== 0) throw new Error(`tmux boot failed (${geom.label}): ${launched.stderr}`)
	const boot = await waitPane(session, (o) => o.includes('🧠') || idle(o), 90_000, 400)
	if (!boot.ok) throw new Error(`client did not render at ${geom.label}: ${boot.out.slice(-600)}`)
	await waitPane(session, idle, 30_000)

	// Live turn: the dock only latches while a turn is active (or while lower
	// content exists), so the strip must be captured mid-turn.
	sendKeys(session, '-l', PROMPT)
	await sleep(250)
	sendKeys(session, 'Enter')
	const live = await waitPane(session, (o) => o.includes('1 main') && o.includes('2 todo'), 40_000, 200)
	if (!live.ok) throw new Error(`tab strip not visible at ${geom.label}: ${live.out.slice(-600)}`)
	const main = snapshot(`${PREFIX}-${geom.label}`, session)
	runLog.push(`${new Date().toISOString()} ${geom.label} capture main (${main.text.split('\n').length} rows)`)

	// Alt+2 switches the active activity tab; the solid segment must move.
	sendKeys(session, 'M-2')
	await sleep(700)
	const todo = snapshot(`${PREFIX}-${geom.label}-alt2`, session)
	runLog.push(`${new Date().toISOString()} ${geom.label} capture alt2`)

	// Leave no turn running: two Escapes + Enter confirm the stop dialog.
	sendKeys(session, 'Escape')
	await sleep(150)
	sendKeys(session, 'Escape')
	await sleep(350)
	sendKeys(session, 'Enter')
	await waitPane(session, (o) => !o.includes('esc stop'), 10_000)
	tmux('kill-session', '-t', session)
	reapHost()
}

writeFileSync(join(OUT, `${PREFIX}-run.log`), runLog.join('\n') + '\n')
try {
	mockProc.kill('SIGTERM')
} catch {}
try {
	rmSync(HOME, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
} catch {}
try {
	rmSync(WS, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
} catch {}
console.log(`captured ${GEOMS.length} geometries -> ${OUT} (prefix ${PREFIX})`)
