#!/usr/bin/env node
// Turn a tmux `capture-pane -e` dump into per-column facts for the activity
// tab strip: row index, plain text, background-color runs, arrow cells.
// ANSI fully expanded (38;2 / 38;5 / 48;2 / 48;5), so the numbers are the same
// ones the terminal was told to paint — not a screenshot read by eye.
//
//   node parse-frames.mjs <file.ans>

import { readFileSync } from 'node:fs'

const BASE16 = ['#000000', '#800000', '#008000', '#808000', '#000080', '#800080', '#008080', '#c0c0c0',
	'#808080', '#ff0000', '#00ff00', '#ffff00', '#0000ff', '#ff00ff', '#00ffff', '#ffffff']
const hex2 = (n) => n.toString(16).padStart(2, '0')
const rgbHex = (r, g, b) => `#${hex2(r)}${hex2(g)}${hex2(b)}`
const steps = [0, 95, 135, 175, 215, 255]
function xterm256(n) {
	if (n < 16) return BASE16[n]
	if (n < 232) {
		const i = n - 16
		return rgbHex(steps[Math.floor(i / 36) % 6], steps[Math.floor(i / 6) % 6], steps[i % 6])
	}
	const v = 8 + (n - 232) * 10
	return rgbHex(v, v, v)
}
const ANSI_RE = /\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07]*\x07/g
const stripAnsi = (s) => String(s).replace(ANSI_RE, '')
function widthOf(ch) {
	const cp = ch.codePointAt(0)
	if (cp === 0x200d || (cp >= 0xfe00 && cp <= 0xfe0f)) return 0
	if (
		(cp >= 0x1100 && cp <= 0x115f) ||
		(cp >= 0x2e80 && cp <= 0xa4cf) ||
		(cp >= 0xac00 && cp <= 0xd7a3) ||
		(cp >= 0xf900 && cp <= 0xfaff) ||
		(cp >= 0xfe30 && cp <= 0xfe4f) ||
		(cp >= 0xff00 && cp <= 0xff60) ||
		(cp >= 0xffe0 && cp <= 0xffe6) ||
		(cp >= 0x1f300 && cp <= 0x1faff) ||
		(cp >= 0x1f900 && cp <= 0x1f9ff)
	) return 2
	return 1
}
function sgrRuns(row) {
	const runs = []
	let fg = null
	let bg = null
	let last = 0
	const push = (text) => {
		if (text !== '') runs.push({ text, fg, bg })
	}
	const re = /\x1b\[([0-9;]*)m/g
	let m
	while ((m = re.exec(row)) !== null) {
		push(row.slice(last, m.index))
		const params = (m[1] === '' ? '0' : m[1]).split(';').map(Number)
		for (let i = 0; i < params.length; i++) {
			const p = params[i]
			if (p === 0) { fg = null; bg = null; continue }
			if (p === 39) { fg = null; continue }
			if (p === 49) { bg = null; continue }
			if (p === 38 || p === 48) {
				const mode = params[i + 1]
				let value = null
				if (mode === 2) { value = rgbHex(params[i + 2] ?? 0, params[i + 3] ?? 0, params[i + 4] ?? 0); i += 4 }
				else if (mode === 5) { value = xterm256(params[i + 2] ?? 0); i += 2 }
				else i += 1
				if (value !== null) { if (p === 38) fg = value; else bg = value }
				continue
			}
			if (p >= 30 && p <= 37) { fg = BASE16[p - 30]; continue }
			if (p >= 90 && p <= 97) { fg = BASE16[p - 90 + 8]; continue }
			if (p >= 40 && p <= 47) { bg = BASE16[p - 40]; continue }
			if (p >= 100 && p <= 107) { bg = BASE16[p - 100 + 8]; continue }
		}
		last = re.lastIndex
	}
	push(row.slice(last))
	return runs
}
function cells(row) {
	const out = []
	let col = 0
	for (const run of sgrRuns(row)) {
		for (const ch of run.text) {
			const w = widthOf(ch)
			if (w === 0) {
				if (out.length > 0) out[out.length - 1].ch += ch
				continue
			}
			out.push({ col, ch, fg: run.fg, bg: run.bg, w })
			col += w
		}
	}
	return out
}

const file = process.argv[2]
if (!file) {
	console.error('usage: node parse-frames.mjs <file.ans>')
	process.exit(2)
}
const lines = readFileSync(file, 'utf8').split('\n')
const stripIdx = lines.findIndex((line) => {
	const plain = stripAnsi(line)
	return plain.includes('1 main') && plain.includes('2 todo') && plain.includes('🏠')
})
if (stripIdx < 0) {
	console.log(JSON.stringify({ file, strip_row: null, reason: 'no row contains 1 main + 2 todo + 🏠' }))
	process.exit(1)
}
const rowCells = cells(lines[stripIdx])
const plain = stripAnsi(lines[stripIdx])
const bgRanges = []
for (const c of rowCells) {
	const last = bgRanges[bgRanges.length - 1]
	if (last && last.bg === c.bg && last.end === c.col - 1) last.end = c.col
	else bgRanges.push({ start: c.col, end: c.col, bg: c.bg })
}
const arrows = rowCells.filter((c) => c.ch === '\ue0b0').map((c) => ({ col: c.col, fg: c.fg, bg: c.bg }))
const segStart = (label) => {
	const idx = rowCells.findIndex((c) => c.ch === label[0] && rowCells.slice(rowCells.indexOf(c), rowCells.indexOf(c) + label.length).map((x) => x.ch).join('') === label)
	return idx >= 0 ? rowCells[idx].col : null
}
const mainStart = segStart('1 main')
const todoStart = segStart('2 todo')
const bgAt = (col) => rowCells.find((c) => c.col === col)?.bg ?? null
const chAt = (col) => rowCells.find((c) => c.col === col)?.ch ?? null
const stripEnd = Math.max(...rowCells.map((c) => c.col)) 

console.log(JSON.stringify({
	file,
	strip_row: stripIdx,
	strip_row_of_total: `${stripIdx + 1}/${lines.length}`,
	plain: plain.trimEnd(),
	cells: rowCells.map((c) => ({ col: c.col, ch: c.ch, fg: c.fg, bg: c.bg })),
	bg_ranges: bgRanges,
	arrows,
	main_start_col: mainStart,
	todo_start_col: todoStart,
	last_col: stripEnd,
	bg_at: { [String(mainStart)]: bgAt(mainStart), [String(todoStart)]: bgAt(todoStart) },
}, null, 2))
