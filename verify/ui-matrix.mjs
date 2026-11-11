#!/usr/bin/env node
// UI layer gate: tmux captures at a geometry matrix with NUMERIC assertions
// (row count, column width, border glyphs, SGR attributes, WCAG contrast).
//
//   node verify/ui-matrix.mjs [--keep]
//
// This is the UI tier of docs/testing.md: a real client paints a real PTY,
// and every assertion is a number, not a text marker:
//   - the captured frame has exactly `rows` lines and its widest line is
//     exactly `cols` (full-width paint), never wider (no wrap/overflow);
//   - the composer box (┃ rows) is `cols` wide at every geometry;
//   - >30-row terminals draw the full ┏━┓ / ┗━┛ composer frame; the compact
//     ≤30-row form draws sides only (documented layout);
//   - the palette paints 6–12 command rows, all inside `cols`, with an
//     inverted selection (background differs from the frame default) and
//     description contrast ≥ 4.5:1 (WCAG AA);
//   - the composer placeholder keeps ≥ 4.5:1 contrast;
//   - Esc closes the palette.
//
// Exit 0 = all checks passed; 1 = at least one failed (captures kept under
// verify/ui-matrix-out/); 2 = environment problem (named on stderr).
//
// Isolation: scratch DSH_HOME copied from the real one (nothing is written
// to ~/.dsh); uniquely named tmux sessions killed individually (never
// `tmux kill-server`); the scratch host is reaped through its lock file.

import { spawnSync } from "node:child_process"
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { eastAsianWidth } from "../packages/tui-base/node_modules/get-east-asian-width/index.js"

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const LAUNCHER = join(REPO, "dsh-opentui")
const REAL_HOME = process.env.DSH_HOME_REAL || join(homedir(), ".dsh")
const PROFILE = process.env.DSH_UI_PROFILE || "opentui"
const SDK = join(REPO, "packages/shell/node_modules/@deepseek-ai/dsh-client-connection")
const OUT = join(REPO, "verify", "ui-matrix-out")
const KEEP = process.argv.includes("--keep")
const GEOMETRIES = [
	[80, 24],
	[120, 34],
	[120, 41],
	[120, 50],
]
const PLACEHOLDER = "Type a message"
const BOOT_TIMEOUT_MS = 90_000

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const sh = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: "utf8", ...opts })
const tmux = (...args) => sh("tmux", args)
const tmuxOut = (...args) => {
	const r = tmux(...args)
	return r.status === 0 ? r.stdout : ""
}
const capture = (session, esc = false) => tmuxOut("capture-pane", "-p", "-t", session, ...(esc ? ["-e"] : []))

for (const cmd of ["tmux", "bun", "dsh"]) {
	if (sh("which", [cmd]).status !== 0) {
		console.error(`ui-matrix: ${cmd} not on PATH`)
		process.exit(2)
	}
}
if (!existsSync(LAUNCHER)) {
	console.error(`ui-matrix: launcher missing: ${LAUNCHER}`)
	process.exit(2)
}
if (!existsSync(join(REAL_HOME, "profiles", PROFILE))) {
	console.error(`ui-matrix: profile '${PROFILE}' missing under ${REAL_HOME}`)
	process.exit(2)
}
if (!existsSync(SDK)) {
	console.error(
		`ui-matrix: ${SDK} missing (the real client needs a global dsh install or the CI stub)`,
	)
	process.exit(2)
}
mkdirSync(OUT, { recursive: true })

// ---- scratch home (same isolation as verify/agents-mount-repro.mjs) ----
const HOME = mkdtempSync(join(tmpdir(), "dsh-ui-matrix-home-"))
chmodSync(HOME, 0o700)
const WS = mkdtempSync(join(tmpdir(), "dsh-ui-matrix-ws-"))
mkdirSync(join(HOME, "profiles"), { recursive: true })
cpSync(join(REAL_HOME, "profiles", PROFILE), join(HOME, "profiles", PROFILE), { recursive: true })
for (const rel of [".credentials.yaml", "models-store.json", "model-profiles.json", "workspace-presets.json", "settings.yaml", "agents", "themes"]) {
	const from = join(REAL_HOME, rel)
	if (existsSync(from)) cpSync(from, join(HOME, rel), { recursive: true })
}
const AGENTS_HOME = join(HOME, "agents-home")
mkdirSync(AGENTS_HOME, { recursive: true })

const LOCK = join(HOME, `opentui-host.${PROFILE}.json`)
const reapHost = () => {
	let lock
	try {
		lock = JSON.parse(readFileSync(LOCK, "utf8"))
	} catch {
		return
	}
	if (typeof lock.pid !== "number") return
	try {
		process.kill(-lock.pid, "SIGTERM")
	} catch {
		try {
			process.kill(lock.pid, "SIGTERM")
		} catch {}
	}
	try {
		process.kill(lock.pid, "SIGKILL")
	} catch {}
	rmSync(LOCK, { force: true })
}

// ---- numeric helpers ----
const stripAnsi = (s) =>
	s
		.replace(/\x1b\][^\x07]*\x07/g, "")
		.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "")
const visibleWidth = (s) => {
	let width = 0
	for (const ch of stripAnsi(s)) width += eastAsianWidth(ch.codePointAt(0))
	return width
}
const frameRows = (text) => {
	const rows = text.split("\n")
	while (rows.length > 0 && rows.at(-1) === "") rows.pop()
	return rows
}
const contrast = (a, b) => {
	const lum = ([r, g, b]) => {
		const f = (v) => {
			v /= 255
			return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
		}
		return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
	}
	const A = lum(a)
	const B = lum(b)
	return (Math.max(A, B) + 0.05) / (Math.min(A, B) + 0.05)
}

const ansi256 = (n) => {
	if (n < 16) return [0, 0, 0]
	if (n < 232) {
		n -= 16
		const levels = [0, 95, 135, 175, 215, 255]
		return [levels[Math.floor(n / 36)], levels[Math.floor(n / 6) % 6], levels[n % 6]]
	}
	const v = 8 + (n - 232) * 10
	return [v, v, v]
}

/** Parse an ANSI line into text runs carrying the active fg/bg (null =
 * inherited). `38;2;r;g;b` / `48;2;r;g;b` truecolor and `5;n` indices are
 * honored; SGR 0 resets to inherited. */
/** Parse a WHOLE ANSI capture as one stream: tmux `capture-pane -e` emits SGR
 * diffs, so an inherited background set on an earlier line still applies
 * later (a per-line parser invents the wrong defaults). State is carried
 * across newlines and reset only by SGR 0. */
const parseFrame = (ansiFrame) => {
	let fg = null
	let bg = null
	const lines = []
	for (const line of ansiFrame.split("\n")) {
		const runs = []
		const re = /\x1b\[([0-9;]*)m|([^\x1b]+)/g
		let m
		while ((m = re.exec(line))) {
			if (m[1] !== undefined) {
				const params = m[1].split(";").map(Number)
				if (m[1] === "" || params.includes(0)) {
					fg = null
					bg = null
				}
				for (let i = 0; i < params.length; i++) {
					const p = params[i]
					if (p === 0) continue
					if (p === 38 || p === 48) {
						const target = p === 38 ? (c) => (fg = c) : (c) => (bg = c)
						if (params[i + 1] === 2) {
							target([params[i + 2], params[i + 3], params[i + 4]])
							i += 4
						} else if (params[i + 1] === 5) {
							target(ansi256(params[i + 2]))
							i += 2
						}
						continue
					}
					if (p >= 30 && p <= 37) fg = [0, 0, 0]
					if (p >= 90 && p <= 97) fg = [255, 255, 255]
					if (p >= 40 && p <= 47) bg = [0, 0, 0]
					if (p >= 100 && p <= 107) bg = [255, 255, 255]
				}
			} else {
				runs.push({ text: m[2], fg, bg })
			}
		}
		lines.push(runs)
	}
	return lines
}

/** Weightiest non-null fg/bg across the frame = the theme defaults. */
const themeDefaults = (parsedFrame) => {
	const weight = { fg: new Map(), bg: new Map() }
	const add = (map, color, n) => {
		if (!color) return
		const key = color.join(",")
		map.set(key, (map.get(key) || 0) + n)
	}
	for (const runs of parsedFrame) {
		for (const run of runs) {
			const n = stripAnsi(run.text).trim().length
			add(weight.fg, run.fg, n)
			add(weight.bg, run.bg, n)
		}
	}
	const pick = (map) => {
		let best = null
		let bestN = -1
		for (const [key, n] of map) {
			if (n > bestN) {
				bestN = n
				best = key.split(",").map(Number)
			}
		}
		return best
	}
	return { fg: pick(weight.fg) || [255, 255, 255], bg: pick(weight.bg) || [10, 10, 15] }
}

/** Runs with inherited colors resolved and contrast computed. */
const resolveLine = (runs, defaults) =>
	runs.map((run) => {
		const fg = run.fg || defaults.fg
		const bg = run.bg || defaults.bg
		return { ...run, fg, bg, contrast: contrast(fg, bg) }
	})

const results = []
const record = (geom, item, ok, detail = "") => {
	results.push({ geom, item, ok, detail })
	console.log(`${(ok ? "PASS" : "FAIL").padEnd(5)} ${geom.padEnd(8)} ${item}${detail ? ` — ${detail}` : ""}`)
}

const launch = (session, cols, rows) => {
	tmux("kill-session", "-t", session)
	const env = [`DSH_HOME=${HOME}`, `DSH_AGENTS_HOME=${AGENTS_HOME}`, "DSH_OPENTUI_DEBUG=1"]
	return tmux(
		"new-session",
		"-d",
		"-x",
		String(cols),
		"-y",
		String(rows),
		"-s",
		session,
		"-c",
		WS,
		`${env.join(" ")} ${LAUNCHER} --client 2>${join(OUT, `${session}.err.log`)}`,
	)
}

const waitFor = async (session, pred, timeoutMs) => {
	const deadline = Date.now() + timeoutMs
	let last = ""
	while (Date.now() < deadline) {
		const frame = capture(session)
		if (frame.trim()) last = frame
		if (last && pred(last)) return { ok: true, out: last }
		await sleep(300)
	}
	return { ok: false, out: last }
}

const checkGeometry = async (cols, rows) => {
	const geom = `${cols}x${rows}`
	const session = `ui-matrix-${process.pid}-${geom}`
	const boot = launch(session, cols, rows)
	if (boot.status !== 0) {
		record(geom, "client boots", false, `tmux: ${boot.stderr.trim()}`)
		return
	}
	const ready = await waitFor(session, (o) => o.includes(PLACEHOLDER), BOOT_TIMEOUT_MS)
	if (!ready.ok) {
		const err = existsSync(join(OUT, `${session}.err.log`)) ? readFileSync(join(OUT, `${session}.err.log`), "utf8") : ""
		record(geom, "client paints the composer", false, `no '${PLACEHOLDER}' in ${BOOT_TIMEOUT_MS / 1000}s; ${err.trim().slice(-300)}`)
		tmux("kill-session", "-t", session)
		return
	}
	await sleep(900)
	const idleText = capture(session)
	const idleAnsi = capture(session, true)
	writeFileSync(join(OUT, `${geom}-idle.ans`), idleAnsi)

	const lines = frameRows(idleText)
	const widths = lines.map(visibleWidth)
	const maxWidth = Math.max(...widths)
	record(geom, "frame row count == terminal rows", lines.length === rows, `got ${lines.length}, want ${rows}`)
	record(geom, "full-width paint", maxWidth === cols, `widest line ${maxWidth}, terminal ${cols}`)
	record(geom, "no line exceeds terminal width", maxWidth <= cols, `widest line ${maxWidth}`)

	const composerRows = lines.filter((l) => l.trimStart().startsWith("┃"))
	const composerWidths = composerRows.map(visibleWidth)
	record(geom, "composer interior rows present", composerRows.length >= 1, `rows=${composerRows.length}`)
	record(
		geom,
		"composer rows are terminal width",
		composerRows.length > 0 && composerWidths.every((w) => w === cols),
		`widths=${[...new Set(composerWidths)].join(",")}`,
	)

	const rowsWithIndex = lines.map((l, i) => ({ i, t: l.trim() }))
	const topBorder = rowsWithIndex.find(({ t }) => /^[┏┌╭][━─]{20,}[┓┐╮]$/.test(t))
	// Search for the bottom border AFTER the top one: the transcript box also
	// has a └──┘ border, and it sits above the composer.
	const bottomBorder = topBorder
		? rowsWithIndex.find(({ i, t }) => i > topBorder.i && /^[┗└╰][━─]{20,}[┛┘╯]$/.test(t))
		: undefined
	if (rows > 30) {
		const ok =
			topBorder &&
			bottomBorder &&
			visibleWidth(topBorder.t) === cols &&
			visibleWidth(bottomBorder.t) === cols &&
			bottomBorder.i <= rows - 2
		record(
			geom,
			"full composer frame drawn at terminal width",
			Boolean(ok),
			topBorder && bottomBorder
				? `top row ${topBorder.i} w=${visibleWidth(topBorder.t)}, bottom row ${bottomBorder.i} w=${visibleWidth(bottomBorder.t)}`
				: "frame not found",
		)
	} else {
		record(geom, "compact composer form (sides only, no top frame)", !topBorder, topBorder ? "unexpected ┏ frame" : "ok")
	}

	const sgr = idleAnsi.match(/\x1b\[[0-9;]*m/g) || []
	const truecolor = new Set(sgr.filter((s) => /^\x1b\[(38|48);2;/.test(s)))
	record(geom, "ANSI SGR attributes present", sgr.length >= 10, `sgr=${sgr.length}`)
	record(geom, "truecolor brand/theme palette present", truecolor.size >= 8, `distinct truecolor=${truecolor.size}`)

	const idleParsed = parseFrame(idleAnsi)
	const defaults = themeDefaults(idleParsed)
	const placeholderRow = lines.findIndex((l) => stripAnsi(l).includes(PLACEHOLDER))
	const placeholder =
		placeholderRow >= 0
			? resolveLine(idleParsed[placeholderRow] || [], defaults).find((run) => stripAnsi(run.text).includes(PLACEHOLDER))
			: undefined
	record(
		geom,
		"composer placeholder contrast >= 4.5",
		Boolean(placeholder && placeholder.contrast >= 4.5),
		placeholder ? `${placeholder.contrast.toFixed(2)}:1` : "run not found",
	)

	// ---- palette ----
	tmux("send-keys", "-t", session, "-l", "/")
	const palette = await waitFor(session, (o) => /\/help\s+show available commands/.test(o), 8_000)
	if (!palette.ok) {
		record(geom, "slash palette opens", false, "no /help row")
		tmux("kill-session", "-t", session)
		reapHost()
		return
	}
	await sleep(500)
	const palAnsi = capture(session, true)
	const palText = capture(session)
	writeFileSync(join(OUT, `${geom}-palette.ans`), palAnsi)
	const palLines = frameRows(palText)
	const palParsed = parseFrame(palAnsi)
	const commandIndexes = palLines
		.map((l, i) => (/^\s*┃\s+\/[a-z-]+\b/.test(l) ? i : -1))
		.filter((i) => i >= 0)
	record(geom, "palette opens with 6–12 command rows", commandIndexes.length >= 6 && commandIndexes.length <= 12, `rows=${commandIndexes.length}`)
	record(geom, "palette lines stay inside the geometry", Math.max(...palLines.map(visibleWidth)) <= cols, `widest=${Math.max(...palLines.map(visibleWidth))}`)

	const palDefaults = themeDefaults(palParsed)
	const firstCommandIndex = commandIndexes[0]
	const activeRuns =
		firstCommandIndex === undefined ? [] : resolveLine(palParsed[firstCommandIndex] || [], palDefaults)
	const inverted = activeRuns
		.filter((run) => run.bg.join(",") !== palDefaults.bg.join(","))
		.sort((a, b) => b.contrast - a.contrast)[0]
	record(
		geom,
		"palette selection is inverted with >= 4.5 contrast",
		Boolean(inverted && inverted.contrast >= 4.5),
		inverted ? `bg ${inverted.bg.join(",")} cr=${inverted.contrast.toFixed(2)}:1` : "no non-default background run",
	)

	const helpIndex = palLines.findIndex((l) => l.includes("/help"))
	const description =
		helpIndex >= 0
			? resolveLine(palParsed[helpIndex] || [], palDefaults).find((run) => stripAnsi(run.text).includes("show available commands"))
			: undefined
	record(
		geom,
		"palette description contrast >= 4.5",
		Boolean(description && description.contrast >= 4.5),
		description ? `${description.contrast.toFixed(2)}:1` : "run not found",
	)

	tmux("send-keys", "-t", session, "Escape")
	await sleep(600)
	const closed = capture(session)
	const closedOk = !/\/help\s+show available commands/.test(closed)
	record(geom, "Esc closes the palette", closedOk, closedOk ? "ok" : "command rows still visible")

	tmux("kill-session", "-t", session)
	reapHost()
}

let crashed = null
try {
	for (const [cols, rows] of GEOMETRIES) await checkGeometry(cols, rows)
} catch (error) {
	crashed = error instanceof Error ? error : new Error(String(error))
	console.error(`ui-matrix: harness error: ${crashed.message}`)
} finally {
	reapHost()
	writeFileSync(
		join(OUT, "summary.json"),
		JSON.stringify({ geometries: GEOMETRIES.map(([c, r]) => `${c}x${r}`), results }, null, 2),
	)
	if (!KEEP) {
		rmSync(HOME, { recursive: true, force: true })
		rmSync(WS, { recursive: true, force: true })
	} else {
		console.log(`scratch home kept: ${HOME}`)
	}
}

const failed = results.filter((r) => !r.ok)
console.log(`\nui-matrix: ${results.length - failed.length}/${results.length} checks passed`)
console.log(`summary: verify/ui-matrix-out/summary.json`)
process.exit(crashed || failed.length > 0 ? 1 : 0)
