/**
 * AgentsPanel — the /agents agent-definition manager (tui-pi agents manager
 * parity, phase 1: table + fields layers).
 *
 * Three navigation levels in one self-drawn panel:
 *   table  — NAME | MODEL | DEEP | DESCRIPTION, the model cell is the
 *            COMPOSED value (frontmatter baseline (+) workspace profile pin,
 *            resolved by the shell seam), `▸ ` marks the cursor row
 *   fields — model | thinking | deep, values composed, `✎ ` on editable rows
 *   viewer — the system prompt body (`v`), 40 lines + `… N more line(s)`
 *
 * Editing:
 *   m / Enter on model   — two-stage picker: provider/model, then the
 *                          model's REAL effort ladder (first row = provider
 *                          default = clear). Esc at EITHER stage cancels the
 *                          whole change.
 *   t / Enter on thinking — the effort picker for the composed model.
 *   d / Enter on deep     — integer editor; empty keeps, non-digit errors,
 *                          success leaves the editor open with a notice
 *                          ("max depth N saved — takes effect when this agent
 *                          is spawned"), Esc returns with a status line.
 *
 * The limits layer (`l`, tui-pi B3) is a second phase: `l` paints a hint
 * line, it does not open a panel.
 *
 * Rows ride the seam.agents face; the panel re-reads on every open and after
 * every successful write (no I/O in render callbacks). The keymap layer is
 * global priority 2 and gates off while a dialog owns the screen; a
 * focus-catcher input keeps stray printable keys out of the composer while
 * the panel is open.
 */
import { createEffect, createMemo, createSignal, For, Show } from "solid-js"
import type { InputRenderable } from "@opentui/core"
import { TextAttributes } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { Keymap } from "../../context/keymap"
import { useDialog } from "../../ui/dialog"
import { useThemeOptional } from "../../context/theme"
import { warningColor } from "../../skin/semantic"
import { stringWidth } from "../../util/string-width"
import type { SeamAgentRow, SeamEffortOption, SessionSeam } from "../../seams/session"

const MARKER_W = 2
const TABLE_SEP = " │ "
const MAX_VISIBLE = 12
const INHERIT = "(inherit)"
const INHERIT_DEFAULT = "(inherit — default model)"

/** Column-exact clip (keeps leading spaces and runs - layout, not prose). */
function clipText(text: string, limit: number): string {
	if (limit <= 0) return ""
	if (stringWidth(text) <= limit) return text
	let width = 0
	let out = ""
	for (const char of text) {
		const charWidth = stringWidth(char)
		if (width + charWidth > limit - 1) break
		out += char
		width += charWidth
	}
	return limit <= 1 ? "…" : `${out}…`
}

const [bridgeOpen, setBridgeOpen] = createSignal<string | undefined>(undefined)
// The panel's own open state lives at module scope so the session's sidebar
// Esc layer (routes/session/index.tsx, priority 10) can yield while the
// panel owns the screen — one signal, no mirrored "is open" copy.
const [panelOpen, setPanelOpen] = createSignal(false)
/** Whether the /agents manager is on screen. */
export const agentsPanelOpen = panelOpen

/** Open the /agents manager; `name` preselects the exact agent `name` row. */
export function openAgentsPanel(name?: string): void {
	setBridgeOpen(name ?? "")
}

export type PanelTone = "accent" | "selected" | "muted" | "subtle" | "attention"

export interface PanelLine {
	text: string
	tone: PanelTone
}

export type PanelLevel = "table" | "fields" | "picker" | "effort" | "deep" | "viewer"

function padCell(text: string, width: number, align: "left" | "right" = "left"): string {
	const clipped = clipText(text, width)
	const gap = Math.max(0, width - stringWidth(clipped))
	return align === "right" ? " ".repeat(gap) + clipped : clipped + " ".repeat(gap)
}

function rule(widths: readonly number[], junction: "┬" | "┼" | "┴"): string {
	return " ".repeat(MARKER_W) + widths.map((width) => "─".repeat(width)).join(`─${junction}─`)
}

function headerLine(titles: readonly string[], widths: readonly number[], aligns: readonly ("left" | "right")[]): string {
	return (
		" ".repeat(MARKER_W) +
		titles.map((title, index) => padCell(title.toUpperCase(), widths[index]!, aligns[index])).join(TABLE_SEP)
	)
}

function fitWidth(title: string, cells: readonly string[], cap = Number.POSITIVE_INFINITY): number {
	const widest = Math.max(stringWidth(title.toUpperCase()), ...cells.map((cell) => stringWidth(cell)), 1)
	return Math.min(cap, widest)
}

/** The four agent-table columns; DESCRIPTION takes the remaining width. */
export function agentTableWidths(rows: readonly SeamAgentRow[], width: number): number[] {
	const names = rows.map(agentName)
	const models = rows.map((row) => row.model ?? INHERIT)
	const deeps = rows.map((row) => String(row.deep))
	const name = fitWidth("name", names, 16)
	const model = fitWidth("model", models, 30)
	const deep = fitWidth("deep", deeps)
	const used = MARKER_W + name + model + deep + TABLE_SEP.length * 3
	const description = Math.max(8, width - used)
	return [name, model, deep, description]
}

export function agentName(row: SeamAgentRow): string {
	return row.displayName ?? row.name
}

/**
 * The table layer as rendered lines (title + booktabs rules + rows + footer).
 * Pure: the panel test asserts row count, cell content and the `▸ ` marker.
 */
export function agentTableLines(
	rows: readonly SeamAgentRow[],
	cursor: number,
	width: number,
	status?: string,
): PanelLine[] {
	const lines: PanelLine[] = [{ text: clipText("● Agents", width), tone: "accent" }]
	const widths = agentTableWidths(rows, width)
	const titles = ["name", "model", "deep", "description"]
	const aligns: ("left" | "right")[] = ["left", "left", "right", "left"]
	lines.push({ text: rule(widths, "┬"), tone: "subtle" })
	lines.push({ text: headerLine(titles, widths, aligns), tone: "subtle" })
	lines.push({ text: rule(widths, "┼"), tone: "subtle" })
	const start = Math.max(0, Math.min(cursor - MAX_VISIBLE + 1, rows.length - MAX_VISIBLE))
	const visible = rows.slice(start, start + MAX_VISIBLE)
	for (let i = 0; i < visible.length; i++) {
		const row = visible[i]!
		const selected = start + i === cursor
		if (selected) {
			const cells = [agentName(row), row.model ?? INHERIT, String(row.deep), row.description ?? ""]
				.map((cell, index) => padCell(cell, widths[index]!, aligns[index]))
				.join(TABLE_SEP)
			lines.push({ text: clipText(`▸ ${cells}`, width), tone: "selected" })
		} else {
			const cells = [agentName(row), row.model ?? INHERIT, String(row.deep), row.description ?? ""]
				.map((cell, index) => padCell(cell, widths[index]!, aligns[index]))
				.join(TABLE_SEP)
			lines.push({ text: clipText(`  ${cells}`, width), tone: "muted" })
		}
	}
	lines.push({ text: rule(widths, "┴"), tone: "subtle" })
	if (status !== undefined) lines.push({ text: clipText(status, width), tone: "attention" })
	lines.push({ text: "", tone: "subtle" })
	const overflow = rows.length > MAX_VISIBLE ? ` (${cursor + 1}/${rows.length})` : ""
	lines.push({
		text: clipText(`↑↓ navigate · Enter open · Esc back · l limits${overflow}`, width),
		tone: "subtle",
	})
	return lines
}

/**
 * The zero-agent state: the spec copy names the REAL corpus directory, and
 * the footer keeps the `l` hint reachable (the limits entry is a no-op
 * until phase 2, but it must respond on an empty corpus).
 */
export function agentEmptyLines(dir: string, width: number, status?: string): PanelLine[] {
	const lines: PanelLine[] = [
		{ text: clipText("● Agents", width), tone: "accent" },
		{ text: "", tone: "subtle" },
		{ text: clipText(`no agents in ${dir} yet — drop a markdown file to define one`, width), tone: "muted" },
	]
	if (status !== undefined) {
		lines.push({ text: "", tone: "subtle" })
		lines.push({ text: clipText(status, width), tone: "attention" })
	}
	lines.push({ text: "", tone: "subtle" })
	lines.push({ text: clipText("↑↓ navigate · Enter open · Esc back · l limits", width), tone: "subtle" })
	return lines
}

/** The field-layer content rows (description + scope hint). */
export function agentFieldContent(agent: SeamAgentRow): string[] {
	const lines = (agent.description ?? "(no description)").split("\n")
	lines.push(
		agent.pin !== undefined
			? `model/think edits apply to profile "${agent.pin}" (workspace-scoped — the frontmatter baseline stays untouched)`
			: "no workspace profile pin — edits write the frontmatter baseline (global)",
	)
	return lines
}

/** The fields layer as rendered lines. */
export function agentFieldLines(agent: SeamAgentRow, cursor: number, width: number, status?: string): PanelLine[] {
	const lines: PanelLine[] = [{ text: clipText(`● ${agentName(agent)}`, width), tone: "accent" }]
	const content = agentFieldContent(agent)
	lines.push({ text: "", tone: "subtle" })
	for (const line of content) lines.push({ text: clipText(line === "" ? " " : line, width), tone: "muted" })
	lines.push({ text: "", tone: "subtle" })
	const fields = [
		{ key: "model", value: agent.model ?? INHERIT_DEFAULT },
		{ key: "thinking", value: agent.thinking ?? INHERIT },
		{ key: "deep", value: String(agent.deep) },
	]
	const keyWidth = Math.max(...fields.map((field) => stringWidth(field.key)), 1)
	const widths = [keyWidth, Math.max(8, width - MARKER_W - keyWidth - TABLE_SEP.length)]
	lines.push({ text: rule(widths, "┬"), tone: "subtle" })
	lines.push({ text: headerLine(["Field", "Value"], widths, ["left", "left"]), tone: "subtle" })
	lines.push({ text: rule(widths, "┼"), tone: "subtle" })
	for (let i = 0; i < fields.length; i++) {
		const field = fields[i]!
		const selected = i === cursor
		const keyCell = padCell(field.key, widths[0]!)
		const valueCell = padCell(`✎ ${field.value}`, widths[1]!)
		const text = clipText(`${selected ? "▸ " : "  "}${keyCell}${TABLE_SEP}${valueCell}`, width)
		lines.push({ text, tone: selected ? "selected" : "muted" })
	}
	lines.push({ text: rule(widths, "┴"), tone: "subtle" })
	if (status !== undefined) {
		lines.push({ text: "", tone: "subtle" })
		lines.push({ text: clipText(status, width), tone: "attention" })
	}
	lines.push({ text: "", tone: "subtle" })
	lines.push({
		text: clipText("↑↓ field · Enter edit (m model · t think · d deep) · v full prompt · Esc back", width),
		tone: "subtle",
	})
	return lines
}

/** The `v` viewer (40 lines + overflow counter + Esc footer). */
export function agentViewerLines(name: string, body: string, width: number, maxLines = 40): PanelLine[] {
	const all = body.split("\n")
	const lines: PanelLine[] = [
		{ text: clipText(`ⓘ ${name} · system prompt`, width), tone: "accent" },
		{ text: "", tone: "subtle" },
	]
	for (const line of all.slice(0, maxLines)) {
		lines.push({ text: clipText(line === "" ? " " : line, width), tone: "muted" })
	}
	if (all.length > maxLines) {
		lines.push({ text: clipText(`… ${all.length - maxLines} more line(s)`, width), tone: "subtle" })
	}
	lines.push({ text: "", tone: "subtle" })
	lines.push({ text: clipText("  Esc to close", width), tone: "subtle" })
	return lines
}

export interface AgentModelChoice {
	providerID: string
	modelID: string
}

/** Stage 1: every provider/model route, MODEL + PROVIDER columns. */
export function agentPickerLines(models: readonly AgentModelChoice[], cursor: number, width: number): PanelLine[] {
	const lines: PanelLine[] = [{ text: clipText("● Model", width), tone: "accent" }]
	const modelCells = models.map((model) => model.modelID)
	const widths = [fitWidth("Model", modelCells, 40), Math.max(8, width - MARKER_W - fitWidth("Model", modelCells, 40) - TABLE_SEP.length)]
	lines.push({ text: rule(widths, "┬"), tone: "subtle" })
	lines.push({ text: headerLine(["Model", "Provider"], widths, ["left", "left"]), tone: "subtle" })
	lines.push({ text: rule(widths, "┼"), tone: "subtle" })
	const start = Math.max(0, Math.min(cursor - MAX_VISIBLE + 1, models.length - MAX_VISIBLE))
	for (let i = start; i < Math.min(models.length, start + MAX_VISIBLE); i++) {
		const model = models[i]!
		const selected = i === cursor
		const cells = `${padCell(model.modelID, widths[0]!)}${TABLE_SEP}${padCell(model.providerID, widths[1]!)}`
		lines.push({ text: clipText(`${selected ? "▸ " : "  "}${cells}`, width), tone: selected ? "selected" : "muted" })
	}
	lines.push({ text: rule(widths, "┴"), tone: "subtle" })
	lines.push({ text: "", tone: "subtle" })
	lines.push({ text: clipText("↑↓ navigate · Enter select · Esc back", width), tone: "subtle" })
	return lines
}

/**
 * Stage 2: the effort ladder, first row `(provider default)` = clear the
 * override. `current` preselects the recorded effort when the ladder has it.
 */
export function agentEffortLines(efforts: readonly SeamEffortOption[], cursor: number, width: number): PanelLine[] {
	const rows: { id: string; label: string; description: string }[] = [
		{ id: "default", label: "(provider default)", description: "adapter default behavior — clears the effort override" },
		...efforts.map((effort) => ({
			id: effort.id,
			label: effort.name,
			description: effort.description ?? "",
		})),
	]
	const lines: PanelLine[] = [{ text: clipText("● Reasoning effort", width), tone: "accent" }]
	const labels = rows.map((row) => row.label)
	const widths = [fitWidth("Effort", labels, 24), Math.max(8, width - MARKER_W - fitWidth("Effort", labels, 24) - TABLE_SEP.length)]
	lines.push({ text: rule(widths, "┬"), tone: "subtle" })
	lines.push({ text: headerLine(["Effort", "Description"], widths, ["left", "left"]), tone: "subtle" })
	lines.push({ text: rule(widths, "┼"), tone: "subtle" })
	for (let i = 0; i < rows.length; i++) {
		const row = rows[i]!
		const selected = i === cursor
		const cells = `${padCell(row.label, widths[0]!)}${TABLE_SEP}${padCell(row.description, widths[1]!)}`
		lines.push({ text: clipText(`${selected ? "▸ " : "  "}${cells}`, width), tone: selected ? "selected" : "muted" })
	}
	lines.push({ text: rule(widths, "┴"), tone: "subtle" })
	lines.push({ text: "", tone: "subtle" })
	lines.push({ text: clipText("↑↓ navigate · Enter select · Esc back", width), tone: "subtle" })
	return lines
}

/** Deep-editor parse (tui-pi parseDeepInput): empty = keep, non-digit = error. */
export type DeepInputOutcome = { kind: "keep" } | { kind: "error"; error: string } | { kind: "value"; value: number }

export function parseDeepInput(text: string): DeepInputOutcome {
	const trimmed = text.trim()
	if (trimmed === "") return { kind: "keep" }
	if (!/^\d+$/.test(trimmed)) return { kind: "error", error: `expected a non-negative integer, got "${trimmed}"` }
	return { kind: "value", value: Number(trimmed) }
}

/** The cursor index of an agent row for an exact `name` preselect (display
 * names never match - tui-pi parity); -1 when absent. */
export function preselectAgentIndex(rows: readonly SeamAgentRow[], name: string | undefined): number {
	if (name === undefined || name === "") return -1
	return rows.findIndex((row) => row.name === name)
}

/** The two-stage model picker as a pure flow (Esc at either stage cancels
 * the whole change - the surface behaviour the panel renders). */
export type AgentPickerFlow =
	| { stage: "model"; cursor: number }
	| { stage: "effort"; model: string; efforts: SeamEffortOption[]; cursor: number }
	| { stage: "done"; model: string; thinking: string | null }
	| { stage: "cancelled" }

export function beginPickerFlow(cursor = 0): AgentPickerFlow {
	return { stage: "model", cursor }
}

/** Stage-2 cursor: row 0 is `(provider default)`; a recorded effort that is
 * on the ladder sits one past its index. */
export function effortCursorFor(efforts: readonly SeamEffortOption[], thinking: string | undefined): number {
	if (thinking === undefined) return 0
	const index = efforts.findIndex((effort) => effort.id === thinking)
	return index >= 0 ? index + 1 : 0
}

/** Row 0 clears the override (`thinking: null`); other rows pick the effort. */
export function pickerSelectModel(
	flow: AgentPickerFlow,
	choice: AgentModelChoice,
	ladder: readonly SeamEffortOption[],
	currentThinking: string | undefined,
): AgentPickerFlow {
	if (flow.stage !== "model") return flow
	const model = `${choice.providerID}/${choice.modelID}`
	if (ladder.length === 0) return { stage: "done", model, thinking: null }
	return { stage: "effort", model, efforts: [...ladder], cursor: effortCursorFor(ladder, currentThinking) }
}

export function pickerSelectEffort(flow: AgentPickerFlow, cursor: number): AgentPickerFlow {
	if (flow.stage !== "effort") return flow
	if (cursor <= 0) return { stage: "done", model: flow.model, thinking: null }
	return { stage: "done", model: flow.model, thinking: flow.efforts[cursor - 1]?.id ?? null }
}

/** Esc at EITHER stage cancels the entire change (nothing is committed). */
export function pickerCancel(_flow: AgentPickerFlow): AgentPickerFlow {
	return { stage: "cancelled" }
}

function splitRoute(model: string | undefined): AgentModelChoice | undefined {
	if (model === undefined) return undefined
	const slash = model.indexOf("/")
	if (slash <= 0) return undefined
	return { providerID: model.slice(0, slash), modelID: model.slice(slash + 1) }
}

/** Exit summary (tui-pi tri-state, seed branch unreachable in phase 1). */
export function agentsSummary(changed: readonly string[]): string {
	return changed.length > 0 ? `Agents updated: ${changed.join(", ")}` : "Agents unchanged."
}

export function AgentsPanel(props: { seam: SessionSeam; onClosed?: (summary?: string) => void }) {
	const theme = useThemeOptional()
	const dialog = useDialog()
	const dimensions = useTerminalDimensions()

	// The module-level open signal (shared with the sidebar Esc layer).
	const open = agentsPanelOpen
	const setOpen = setPanelOpen
	const [level, setLevel] = createSignal<PanelLevel>("table")
	const [rows, setRows] = createSignal<SeamAgentRow[]>([])
	const [tableCursor, setTableCursor] = createSignal(0)
	const [fieldCursor, setFieldCursor] = createSignal(0)
	const [pickerCursor, setPickerCursor] = createSignal(0)
	const [effortCursor, setEffortCursor] = createSignal(0)
	const [selectedName, setSelectedName] = createSignal<string | undefined>(undefined)
	const [models, setModels] = createSignal<AgentModelChoice[]>([])
	const [efforts, setEfforts] = createSignal<SeamEffortOption[]>([])
	const [status, setStatus] = createSignal<string | undefined>(undefined)
	const [deepError, setDeepError] = createSignal<string | undefined>(undefined)
	const [deepNotice, setDeepNotice] = createSignal<string | undefined>(undefined)
	const [deepValue, setDeepValue] = createSignal("")
	const [deepCommitted, setDeepCommitted] = createSignal(false)
	const [viewerBody, setViewerBody] = createSignal("")
	const [changed, setChanged] = createSignal<string[]>([])
	let catcher: InputRenderable | undefined

	const agent = createMemo(() => rows().find((row) => row.name === selectedName()))
	const width = () => Math.max(20, dimensions().width - 4)

	function readRows(): SeamAgentRow[] {
		try {
			return props.seam.agents?.list().filter((row) => row.broken === undefined) ?? []
		} catch {
			return []
		}
	}

	function markChanged(name: string) {
		setChanged((list) => (list.includes(name) ? list : [...list, name]))
	}

	function close() {
		const summary = agentsSummary(changed())
		setOpen(false)
		setLevel("table")
		setStatus(undefined)
		setChanged([])
		// Refocus AFTER teardown (the plugins-panel C15 law).
		setTimeout(() => props.onClosed?.(summary), 3)
	}

	createEffect(() => {
		const preselected = bridgeOpen()
		if (preselected === undefined) return
		setBridgeOpen(undefined)
		const next = readRows()
		setRows(next)
		setLevel("table")
		setStatus(undefined)
		setChanged([])
		const index = preselectAgentIndex(next, preselected)
		setTableCursor(index >= 0 ? index : 0)
		setOpen(true)
	})

	// Focus the catcher (or the deep editor) after every level transition so
	// printable keys never reach the composer underneath.
	createEffect(() => {
		if (!open()) return
		level()
		setTimeout(() => {
			if (!open()) return
			if (catcher !== undefined && !catcher.isDestroyed) catcher.focus()
		}, 1)
	})

	function showTable() {
		setRows(readRows())
		setLevel("table")
		setStatus(undefined)
	}

	function showFields(name: string) {
		setSelectedName(name)
		setFieldCursor(0)
		setLevel("fields")
	}

	function refreshRows() {
		setRows(readRows())
	}

	async function openModelPicker() {
		const current = agent()
		if (current === undefined) return
		let catalog: { providerID: string; modelID: string }[] = []
		try {
			catalog = await props.seam.modelCatalog()
		} catch {
			catalog = []
		}
		if (catalog.length === 0) {
			setStatus("✘ no models available")
			return
		}
		setModels(catalog)
		const index = current.model === undefined ? 0 : catalog.findIndex((model) => `${model.providerID}/${model.modelID}` === current.model)
		setPickerCursor(index >= 0 ? index : 0)
		setStatus(undefined)
		setLevel("picker")
	}

	async function chooseModel(model: AgentModelChoice) {
		let ladder: SeamEffortOption[] = []
		try {
			ladder = await props.seam.agents?.modelEfforts(model.providerID, model.modelID) ?? []
		} catch {
			ladder = []
		}
		const next = pickerSelectModel(beginPickerFlow(pickerCursor()), model, ladder, agent()?.thinking)
		if (next.stage === "done") {
			commitModel(next.model, next.thinking)
			return
		}
		if (next.stage === "effort") {
			setEfforts(next.efforts)
			setEffortCursor(next.cursor)
			setLevel("effort")
		}
	}

	function commitModel(model: string, thinking: string | null) {
		const current = agent()
		if (current === undefined) return
		const seam = props.seam.agents
		if (seam === undefined) return
		const modelResult = seam.set(current.name, "model", model)
		if (modelResult.error !== undefined) {
			setStatus(`✘ ${modelResult.error}`)
			setLevel("fields")
			return
		}
		const thinkResult = thinking === null ? seam.set(current.name, "thinking", null) : seam.set(current.name, "thinking", thinking)
		if (thinkResult.error !== undefined) {
			setStatus(`✘ ${thinkResult.error}`)
		} else {
			const scope = modelResult.target.kind === "profile" ? ` (profile "${modelResult.target.name}")` : ""
			const think = thinking !== null ? ` · think ${thinking}` : ""
			setStatus(`saved ${current.name} → ${model}${think}${scope}`)
			markChanged(current.name)
			refreshRows()
		}
		setLevel("fields")
	}

	async function openThinkingPicker() {
		const current = agent()
		if (current === undefined) return
		if (current.model === undefined) {
			setStatus("✘ no model set — pick a model first (m)")
			return
		}
		const route = splitRoute(current.model)
		if (route === undefined) {
			setStatus(`✘ cannot resolve think levels for ${current.model}`)
			return
		}
		let ladder: SeamEffortOption[] = []
		try {
			ladder = await props.seam.agents?.modelEfforts(route.providerID, route.modelID) ?? []
		} catch {
			ladder = []
		}
		if (ladder.length === 0) {
			setStatus(`✘ ${current.model} exposes no think levels`)
			return
		}
		setEfforts(ladder)
		const index = current.thinking === undefined ? 0 : ladder.findIndex((effort) => effort.id === current.thinking) + 1
		setEffortCursor(index > 0 ? index : 0)
		setStatus(undefined)
		setLevel("effort")
	}

	function commitThinking() {
		const current = agent()
		if (current === undefined) return
		const seam = props.seam.agents
		if (seam === undefined) return
		const next = pickerSelectEffort({ stage: "effort", model: current.model ?? "", efforts: efforts(), cursor: effortCursor() }, effortCursor())
		const thinking = next.stage === "done" ? next.thinking : null
		const result = seam.set(current.name, "thinking", thinking)
		if (result.error !== undefined) {
			setStatus(`✘ ${result.error}`)
		} else {
			const scope = result.target.kind === "profile" ? ` (profile "${result.target.name}")` : ""
			setStatus(`saved ${current.name} → think ${thinking ?? "inherit"}${scope}`)
			markChanged(current.name)
			refreshRows()
		}
		setLevel("fields")
	}

	function openDeepEditor() {
		const current = agent()
		if (current === undefined) return
		setDeepValue(String(current.deep))
		setDeepError(undefined)
		setDeepNotice(undefined)
		setDeepCommitted(false)
		setLevel("deep")
	}

	function commitDeep(text: string) {
		const current = agent()
		if (current === undefined) return
		const parsed = parseDeepInput(text)
		if (parsed.kind === "keep") {
			setLevel("fields")
			return
		}
		if (parsed.kind === "error") {
			setDeepError(parsed.error)
			setDeepNotice(undefined)
			return
		}
		const trimmed = String(parsed.value)
		const seam = props.seam.agents
		if (seam === undefined) return
		const result = seam.set(current.name, "deep", trimmed)
		if (result.error !== undefined) {
			setDeepError(result.error)
			setDeepNotice(undefined)
			return
		}
		const n = Number(trimmed)
		setDeepError(undefined)
		setDeepNotice(`max depth ${n} saved — takes effect when this agent is spawned`)
		setDeepCommitted(true)
		markChanged(current.name)
		refreshRows()
	}

	function leaveDeepEditor() {
		const current = agent()
		if (deepCommitted() && current !== undefined) {
			setStatus(`saved ${current.name} → max depth ${current.deep}`)
		}
		setDeepError(undefined)
		setDeepNotice(undefined)
		setLevel("fields")
	}

	function showViewer() {
		const current = agent()
		if (current === undefined) return
		let body = ""
		try {
			body = props.seam.agents?.body(current.name) ?? ""
		} catch {
			body = ""
		}
		setViewerBody(body)
		setLevel("viewer")
	}

	// ---- keymap layer: global, priority 2, yields while a dialog owns focus ----
	Keymap.createLayer(() => ({
		mode: "global",
		enabled: open() && dialog.stack.length === 0,
		priority: 2,
		commands: [
			{
				bind: "escape",
				title: "Agents: back",
				group: "Agents",
				run: () => {
					const current = level()
					if (current === "table") close()
					else if (current === "fields") showTable()
					else if (current === "picker" || current === "effort") {
						// Esc at either picker stage cancels the whole change.
										setEfforts([])
						setStatus(undefined)
						setLevel("fields")
					} else if (current === "deep") leaveDeepEditor()
					else if (current === "viewer") setLevel("fields")
				},
			},
			{
				bind: "up",
				title: "Agents: previous row",
				group: "Agents",
				run: () => step(-1),
			},
			{
				bind: "down",
				title: "Agents: next row",
				group: "Agents",
				run: () => step(1),
			},
			{
				bind: "pageup",
				title: "Agents: page up",
				group: "Agents",
				run: () => step(-MAX_VISIBLE),
			},
			{
				bind: "pagedown",
				title: "Agents: page down",
				group: "Agents",
				run: () => step(MAX_VISIBLE),
			},
			{
				bind: "return",
				title: "Agents: open / edit",
				group: "Agents",
				run: () => {
					const current = level()
					if (current === "table") {
						const row = rows()[tableCursor()]
						if (row !== undefined) showFields(row.name)
					} else if (current === "fields") {
						const index = fieldCursor()
						if (index === 0) void openModelPicker()
						else if (index === 1) void openThinkingPicker()
						else openDeepEditor()
					} else if (current === "picker") {
						const model = models()[pickerCursor()]
						if (model !== undefined) void chooseModel(model)
					} else if (current === "effort") {
						commitThinking()
					} else if (current === "deep") {
						commitDeep(deepValue())
					} else if (current === "viewer") {
						setLevel("fields")
					}
				},
			},
			{
				bind: "m",
				title: "Agents: model",
				group: "Agents",
				run: () => {
					if (level() === "fields") void openModelPicker()
				},
			},
			{
				bind: "t",
				title: "Agents: think level",
				group: "Agents",
				run: () => {
					if (level() === "fields") void openThinkingPicker()
				},
			},
			{
				bind: "d",
				title: "Agents: spawn depth",
				group: "Agents",
				run: () => {
					if (level() === "fields") openDeepEditor()
				},
			},
			{
				bind: "v",
				title: "Agents: full prompt",
				group: "Agents",
				run: () => {
					if (level() === "fields") showViewer()
				},
			},
			{
				bind: "l",
				title: "Agents: limits (next phase)",
				group: "Agents",
				run: () => {
					if (level() !== "table") return
					setStatus("limits panel — next phase")
				},
			},
		],
	}))

	function step(delta: number) {
		const current = level()
		if (current === "table") {
			const count = rows().length
			if (count === 0) return
			setTableCursor((index) => Math.max(0, Math.min(count - 1, index + delta)))
		} else if (current === "fields") {
			setFieldCursor((index) => Math.max(0, Math.min(2, index + delta)))
		} else if (current === "picker") {
			const count = models().length
			if (count === 0) return
			setPickerCursor((index) => Math.max(0, Math.min(count - 1, index + delta)))
		} else if (current === "effort") {
			const count = efforts().length + 1
			setEffortCursor((index) => Math.max(0, Math.min(count - 1, index + delta)))
		}
	}

	function lines(): PanelLine[] {
		const current = level()
		if (current === "table") {
			if (rows().length === 0) {
				return agentEmptyLines(props.seam.agents?.dir?.() ?? "$DSH_HOME/agents", width(), status())
			}
			return agentTableLines(rows(), tableCursor(), width(), status())
		}
		if (current === "fields") {
			const row = agent()
			return row === undefined ? [] : agentFieldLines(row, fieldCursor(), width(), status())
		}
		if (current === "picker") return agentPickerLines(models(), pickerCursor(), width())
		if (current === "effort") return agentEffortLines(efforts(), effortCursor(), width())
		if (current === "viewer") {
			return agentViewerLines(agent()?.displayName ?? agent()?.name ?? "", viewerBody(), width())
		}
		// deep editor
		const currentAgent = agent()
		const out: PanelLine[] = [
			{ text: clipText(`Max spawn depth — ${currentAgent ? agentName(currentAgent) : ""}`, width()), tone: "accent" },
			{ text: clipText("0 = this agent never spawns subagents · no unlimited", width()), tone: "muted" },
		]
		if (deepError() !== undefined) out.push({ text: clipText(`✘ ${deepError()}`, width()), tone: "attention" })
		else if (deepNotice() !== undefined) out.push({ text: clipText(deepNotice()!, width()), tone: "muted" })
		out.push({ text: "", tone: "subtle" })
		out.push({ text: clipText(`> ${deepValue()}`, width()), tone: "accent" })
		out.push({ text: "", tone: "subtle" })
		out.push({ text: clipText("Enter save · Esc back", width()), tone: "subtle" })
		return out
	}

	function focusColor(tone: PanelTone) {
		switch (tone) {
			case "accent":
			case "selected":
				return theme?.text.action.primary.base ?? "#7aa2f7"
			case "attention":
				return warningColor(theme ?? undefined)
			case "subtle":
				return theme?.text.faint ?? "#565f89"
			default:
				return theme?.text.muted ?? "#565f89"
		}
	}

	const totalLines = createMemo(() => lines().length)

	return (
		<Show when={open()}>
			<box
				flexShrink={0}
				width="100%"
				height={totalLines() + 1}
				flexDirection="column"
				border={["left"]}
				borderColor={theme?.border.base ?? "#7aa2f7"}
				backgroundColor={theme?.background.raised.base ?? "#1a1b26"}
				paddingLeft={1}
				paddingRight={1}
			>
				<For each={lines()}>
					{(line) => (
						<box height={1} flexShrink={0}>
							<text
								fg={focusColor(line.tone)}
								attributes={line.tone === "accent" || line.tone === "selected" ? TextAttributes.BOLD : TextAttributes.NONE}
								wrapMode="none"
							>
								{line.text}
							</text>
						</box>
					)}
				</For>
				<Show
					when={level() === "deep"}
					fallback={
						<box height={1} flexShrink={0}>
							<input
								width={1}
								value=""
								onInput={() => {}}
								ref={(renderable: InputRenderable) => {
									catcher = renderable
									setTimeout(() => {
										if (!renderable.isDestroyed) renderable.focus()
									}, 1)
								}}
							/>
						</box>
					}
				>
					<box height={1} flexShrink={0} flexDirection="row">
						<input
							flexGrow={1}
							value={deepValue()}
							onInput={(value: string) => setDeepValue(value)}
							onSubmit={() => commitDeep(deepValue())}
							ref={(renderable: InputRenderable) => {
								catcher = renderable
								setTimeout(() => {
									if (renderable.isDestroyed) return
									renderable.focus()
									renderable.gotoLineEnd()
								}, 1)
							}}
						/>
					</box>
				</Show>
			</box>
		</Show>
	)
}
