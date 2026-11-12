/**
 * AgentsPanel — the /agents agent-definition manager, migrated onto the
 * panel-kit modal stack (T18 sibling: /settings shares the same skeleton).
 *
 * Eight navigation levels map 1:1 onto PanelStack layers; depth increases with
 * every drill-down and Esc pops exactly one layer (inner-first, panel-kit's own
 * semantics — the consumer no longer owns an Esc chain):
 *
 *   table    — NAME | MODEL | THINK | DEEP | LIMITS columns (panel-kit List
 *              columns/cells), paged through List.pageSize (PgUp/PgDn/Home/End)
 *   fields   — model | thinking | deep (`✎` badge on every row)
 *   limits   — maxRounds | background (editable) + the two read-only official
 *              subagent caps (`n/a` when the host does not serve them)
 *   limitEdit— positive-integer editor for maxRounds (raw input, autofocused)
 *   picker   — provider/model route list
 *   effort   — the model's real effort ladder, row 0 = provider default
 *   deep     — spawn-depth editor (non-negative integer)
 *   viewer   — the system prompt body, truncated to the body window
 *
 * Zero-agent corpus lands on `limits` (its only layer, so Esc closes the
 * manager); this preserves the shipped behaviour and its device gate.
 *
 * The data face is unchanged: `seam.agents.list/set/body/modelEfforts/
 * officialCaps`, `bridgeOpen` → `openAgentsPanel(name?)`, and
 * `close()` → `agentsSummary(changed())` → `onClosed`. The panel re-reads the
 * corpus after every successful write (no optimistic rows).
 *
 * Keys: panel-kit owns Esc / Enter / arrows / Space for the top layer. The
 * letter hotkeys (m/t/d/v/l) stay on the consumer's own Keymap layer — they
 * are deliberately NOT added to the kit's PANEL_KEY_IDS. The paged-list keys
 * (PgUp/PgDn/Home/End) are bound there too: the session's global
 * `session.page.*` layer runs before the focused List, so without this layer
 * the table could never page; every binding returns false unless the panel is
 * stack-top and the list overflows one page. Every List pins `query=""` so a
 * stray printable key can never hide rows (the kit's List would otherwise
 * treat it as a filter).
 */
import type { InputRenderable, Renderable } from "@opentui/core"
import { createEffect, createMemo, createSignal, For, onCleanup, Show, type JSX } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
import {
	List,
	PanelActions,
	PanelBody,
	usePanelTheme,
	usePanels,
	nextListPage,
	type ListColumn,
	type ListItem,
	type PanelHandle,
} from "@dsh-opentui/panel-kit"
import { Keymap } from "../../context/keymap"
import { stringWidth } from "../../util/string-width"
import type { SeamAgentOfficialCaps, SeamAgentRow, SeamEffortOption, SessionSeam } from "../../seams/session"
import { openSettingsPanel } from "./settings-panel"

const INHERIT = "(inherit)"
const INHERIT_DEFAULT = "(inherit — default model)"
/** Rows per paged window (List.pageSize); the kit pages, not the consumer. */
const PAGE_SIZE = 12
/** Frame preset: xlarge = 116 cells, clamped to terminalWidth - 2 by the kit. */
const PANEL_SIZE = "xlarge" as const

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

/**
 * The panel's module-scope open state. Unmount resets it: the sidebar's
 * priority-10 Esc layer yields on this signal, so a stale `true` would leave
 * Esc dead for the rest of the session.
 */
export function useAgentsPanelOpenState() {
	onCleanup(() => setPanelOpen(false))
	return [agentsPanelOpen, setPanelOpen] as const
}

export type PanelLevel =
	| "table"
	| "fields"
	| "limits"
	| "limitEdit"
	| "picker"
	| "effort"
	| "deep"
	| "viewer"

/**
 * The level a fresh open lands on. The table needs a row to render; an empty
 * corpus goes straight to the limits layer (the official caps stay reachable)
 * where Esc closes the manager instead of returning to an absent table.
 */
export function initialAgentLevel(rows: readonly SeamAgentRow[]): PanelLevel {
	return rows.length === 0 ? "limits" : "table"
}

export function agentName(row: SeamAgentRow): string {
	return row.displayName ?? row.name
}

/** The corpus-level broken-file notice (table + limits layers both print it). */
export function brokenLine(count: number): string {
	return `${count} broken file(s) ignored`
}

// ---------------------------------------------------------------------------
// Table / fields / limits / picker row models (panel-kit List items)
// ---------------------------------------------------------------------------

/** Fixed table columns. Widths are declared cells; List shrinks the widest
 * first when the body budget is smaller (never overlapping). */
export const AGENT_TABLE_COLUMNS: ListColumn[] = [
	{ id: "name", title: "NAME", width: 18 },
	{ id: "model", title: "MODEL", width: 30 },
	{ id: "thinking", title: "THINK", width: 10 },
	{ id: "deep", title: "DEEP", width: 5, align: "right" },
	{ id: "limits", title: "LIMITS", width: 24 },
]

/** The LIMITS cell summary: per-agent frontmatter caps only. */
export function agentLimitsCell(row: SeamAgentRow): string {
	const parts: string[] = []
	if (row.maxRounds !== undefined) parts.push(`rounds ${row.maxRounds}`)
	if (row.background === true) parts.push("background")
	return parts.join(" · ")
}

/**
 * One agent-table row. `cells` deliberately omits `name`: panel-kit's List
 * falls back to `label` in the first column, so the display name rides the
 * label (and the composed model/thinking/deep/limits ride `cells`).
 */
export function agentTableItem(row: SeamAgentRow): ListItem<SeamAgentRow> {
	return {
		id: row.name,
		label: agentName(row),
		value: row,
		cells: {
			model: row.model ?? INHERIT,
			thinking: row.thinking ?? "—",
			deep: String(row.deep),
			limits: agentLimitsCell(row) || "—",
		},
	}
}

export function agentTableItems(rows: readonly SeamAgentRow[]): ListItem<SeamAgentRow>[] {
	return rows.map(agentTableItem)
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

export const AGENT_FIELD_COLUMNS: ListColumn[] = [
	{ id: "field", title: "FIELD", width: 20 },
	{ id: "value", title: "VALUE", width: 62 },
]

/** The three editable field rows (model → thinking → deep order). */
export function agentFieldItems(agent: SeamAgentRow): ListItem<"model" | "thinking" | "deep">[] {
	return [
		{
			id: "model",
			label: "model",
			value: "model",
			badge: "✎",
			cells: { value: agent.model ?? INHERIT_DEFAULT },
		},
		{
			id: "thinking",
			label: "thinking",
			value: "thinking",
			badge: "✎",
			cells: { value: agent.thinking ?? INHERIT },
		},
		{
			id: "deep",
			label: "deep",
			value: "deep",
			badge: "✎",
			cells: { value: String(agent.deep) },
		},
	]
}

/** One limits-layer row: key, value phrase, and whether Enter edits it. */
export interface AgentLimitsRow {
	key: "maxRounds" | "background" | "maxActiveSubagents" | "maxDepth"
	editable: boolean
	value: string
}

export const LIMIT_DESCRIPTIONS: Record<AgentLimitsRow["key"], string> = {
	maxRounds: "assistant messages before wrap-up",
	background: "run this agent in background sessions",
	maxActiveSubagents: "official concurrent-children cap (subagent plugin)",
	maxDepth: "official delegation depth (subagent plugin)",
}

/** The limits rows in FIXED order. The two official caps are always there;
 * the per-agent rows exist only when an agent is selected (zero corpus →
 * official caps + empty hint). Unreadable official caps render `n/a`. */
export function agentLimitsRows(agent: SeamAgentRow | undefined, caps: SeamAgentOfficialCaps | undefined): AgentLimitsRow[] {
	const rows: AgentLimitsRow[] = []
	if (agent !== undefined) {
		rows.push({
			key: "maxRounds",
			editable: true,
			value: agent.maxRounds === undefined ? INHERIT : String(agent.maxRounds),
		})
		rows.push({ key: "background", editable: true, value: agent.background === true ? "on" : "off" })
	}
	rows.push({
		key: "maxActiveSubagents",
		editable: false,
		value: caps?.maxActiveSubagents === undefined ? "n/a" : String(caps.maxActiveSubagents),
	})
	rows.push({
		key: "maxDepth",
		editable: false,
		value: caps?.maxDepth === undefined ? "n/a" : String(caps.maxDepth),
	})
	return rows
}

export function agentLimitsItem(row: AgentLimitsRow): ListItem<AgentLimitsRow["key"]> {
	return {
		id: row.key,
		label: row.key,
		value: row.key,
		...(row.editable ? { badge: "✎" } : { tone: "muted" as const }),
		cells: { value: `${row.value} · ${LIMIT_DESCRIPTIONS[row.key]}` },
	}
}

export function agentLimitsItems(rows: readonly AgentLimitsRow[]): ListItem<AgentLimitsRow["key"]>[] {
	return rows.map(agentLimitsItem)
}

/** The /settings row id an official-cap Enter jumps to (settings whitelist
 * ids: `subagent.maxActiveSubagents` / `subagent.maxDepth`). */
export function officialCapSettingsRow(key: "maxActiveSubagents" | "maxDepth"): string {
	return `subagent.${key}`
}

// ---------------------------------------------------------------------------
// Model picker rows
// ---------------------------------------------------------------------------

export interface AgentModelChoice {
	providerID: string
	modelID: string
}

export const AGENT_PICKER_COLUMNS: ListColumn[] = [
	{ id: "model", title: "MODEL", width: 40 },
	{ id: "provider", title: "PROVIDER", width: 24 },
]

export function agentPickerItems(models: readonly AgentModelChoice[]): ListItem<AgentModelChoice>[] {
	return models.map((model) => ({
		id: `${model.providerID}/${model.modelID}`,
		label: model.modelID,
		value: model,
		cells: { provider: model.providerID },
	}))
}

export const AGENT_EFFORT_COLUMNS: ListColumn[] = [
	{ id: "effort", title: "EFFORT", width: 24 },
	{ id: "description", title: "DESCRIPTION", width: 56 },
]

/** Row 0 is `(provider default)` = clear the recorded effort override. */
export function agentEffortItems(efforts: readonly SeamEffortOption[]): ListItem<string | null>[] {
	return [
		{
			id: "default",
			label: "(provider default)",
			value: null,
			cells: { description: "adapter default behavior — clears the effort override" },
		},
		...efforts.map((effort) => ({
			id: effort.id,
			label: effort.name,
			value: effort.id,
			cells: { description: effort.description ?? "" },
		})),
	]
}

// ---------------------------------------------------------------------------
// Viewer window
// ---------------------------------------------------------------------------

export interface ViewerWindow {
	lines: string[]
	/** Lines dropped by the row cap (`… N more line(s)` when > 0). */
	hidden: number
}

/**
 * Truncate the system-prompt body to `maxRows` lines. v1.1 ships no scroll
 * container, so the viewer pages/truncates instead (the overflow counter keeps
 * the loss visible).
 */
export function viewerWindow(body: string, maxRows: number): ViewerWindow {
	const all = body.split("\n")
	const cap = Math.max(0, Math.floor(maxRows))
	if (all.length <= cap) return { lines: all, hidden: 0 }
	return { lines: all.slice(0, cap), hidden: all.length - cap }
}

// ---------------------------------------------------------------------------
// Editors + pure flows
// ---------------------------------------------------------------------------

/** Deep-editor parse (tui-pi parseDeepInput): empty = keep, non-digit = error. */
export type DeepInputOutcome = { kind: "keep" } | { kind: "error"; error: string } | { kind: "value"; value: number }

export function parseDeepInput(text: string): DeepInputOutcome {
	const trimmed = text.trim()
	if (trimmed === "") return { kind: "keep" }
	if (!/^\d+$/.test(trimmed)) return { kind: "error", error: `expected a non-negative integer, got "${trimmed}"` }
	return { kind: "value", value: Number(trimmed) }
}

/** The same keep/error/value shape for the per-agent round cap. The value is
 * a POSITIVE integer: the registry (the consumer of this key) rejects 0 and
 * marks the file broken, so 0 must never be written. Empty = keep (inherit
 * the global ladder). */
export function parseMaxRoundsInput(text: string): DeepInputOutcome {
	const trimmed = text.trim()
	if (trimmed === "") return { kind: "keep" }
	const value = Number(trimmed)
	if (!/^\d+$/.test(trimmed) || !Number.isSafeInteger(value) || value < 1) {
		return { kind: "error", error: `expected a positive integer, got "${trimmed}"` }
	}
	return { kind: "value", value }
}

/** The cursor index of an agent row for an exact `name` preselect (display
 * names never match - tui-pi parity); -1 when absent. */
export function preselectAgentIndex(rows: readonly SeamAgentRow[], name: string | undefined): number {
	if (name === undefined || name === "") return -1
	return rows.findIndex((row) => row.name === name)
}

/** The two-stage model picker as a pure flow. The panel renders each stage as
 * its own layer, so Esc walks back one stage at a time (effort → model →
 * fields); only an explicit selection commits. */
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

// ---------------------------------------------------------------------------
// Focus helper: focus the first focusable control inside a layer
// ---------------------------------------------------------------------------

function findFocusable(node: Renderable | undefined): Renderable | undefined {
	if (!node) return undefined
	if (node.focusable === true) return node
	for (const child of node.getChildren()) {
		const hit = findFocusable(child)
		if (hit) return hit
	}
	return undefined
}

/**
 * Focus the first focusable control of a freshly mounted layer (deferred one
 * tick so children are attached). The kit's stack blurs the previous layer's
 * focus on push and restores it on pop, so this is the only focus owner.
 */
function focusWhenReady(renderable: Renderable): void {
	const attempt = () => {
		if (renderable.isDestroyed) return
		findFocusable(renderable)?.focus()
	}
	// Children attach during the same render pass; the microtask lands right
	// after it, the timer covers a delayed layout.
	attempt()
	queueMicrotask(attempt)
	setTimeout(attempt, 1)
}

function FocusRoot(props: { children?: JSX.Element }): JSX.Element {
	return (
		<box flexDirection="column" flexGrow={1} ref={(renderable: Renderable) => focusWhenReady(renderable)}>
			{props.children}
		</box>
	)
}

// ---------------------------------------------------------------------------
// The panel component
// ---------------------------------------------------------------------------

interface LayerEntry {
	id: string
	level: PanelLevel
	handle: PanelHandle
}

export function AgentsPanel(props: { seam: SessionSeam; onClosed?: (summary?: string) => void }) {
	const panels = usePanels()
	const theme = usePanelTheme()
	const dimensions = useTerminalDimensions()

	// The module-level open signal (shared with the sidebar Esc layer).
	const [open, setOpen] = useAgentsPanelOpenState()
	const [layers, setLayers] = createSignal<LayerEntry[]>([])
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
	const [limitsCursor, setLimitsCursor] = createSignal(0)
	const [caps, setCaps] = createSignal<SeamAgentOfficialCaps | undefined>(undefined)
	const [limitValue, setLimitValue] = createSignal("")
	const [limitError, setLimitError] = createSignal<string | undefined>(undefined)
	const [brokenCount, setBrokenCount] = createSignal(0)
	let sequence = 0

	const agent = createMemo(() => rows().find((row) => row.name === selectedName()))
	const activeLevel = createMemo(() => layers().at(-1)?.level)
	/** Body text budget in cells (List columns shrink inside it). */
	const bodyWidth = createMemo(() => {
		const frame = Math.min(116, dimensions().width - 2)
		const inner = Math.max(1, frame - 2)
		const inset = inner < 64 || dimensions().height - 4 < 20 ? 1 : 3
		return Math.max(20, inner - inset * 2)
	})
	/** Viewer row cap: leave room for title/actions inside `height - 4`. */
	const viewerRows = createMemo(() => Math.max(3, dimensions().height - 10))

	/** Every parsed row, broken files included (the caller splits them). */
	function readAllRows(): SeamAgentRow[] {
		try {
			return props.seam.agents?.list() ?? []
		} catch {
			return []
		}
	}

	/** Re-read the corpus; keeps the broken-file count for the notice. */
	function reloadRows(): SeamAgentRow[] {
		const all = readAllRows()
		const valid = all.filter((row) => row.broken === undefined)
		setRows(valid)
		setBrokenCount(all.length - valid.length)
		return valid
	}

	function markChanged(name: string) {
		setChanged((list) => (list.includes(name) ? list : [...list, name]))
	}

	// ---- stack plumbing ----
	function finish() {
		setOpen(false)
		setStatus(undefined)
		setSelectedName(undefined)
		setEfforts([])
		const summary = agentsSummary(changed())
		setChanged([])
		// Refocus AFTER teardown (the plugins-panel C15 law).
		setTimeout(() => props.onClosed?.(summary), 3)
	}

	function removeLayer(id: string) {
		setLayers((list) => list.filter((entry) => entry.id !== id))
		if (layers().length === 0) finish()
	}

	function pushLevel(level: PanelLevel, subtitle?: string) {
		const id = `agents-${level}-${++sequence}`
		const handle = panels.open(() => renderLevel(level), {
			id,
			title: levelTitle(level),
			...(subtitle === undefined ? {} : { subtitle }),
			size: PANEL_SIZE,
			onClose: () => {
				if (level === "deep") leaveDeepEditor()
				removeLayer(id)
			},
		})
		setLayers((list) => [...list, { id, level, handle }])
	}

	/** Pop the top layer (panel-kit fades it out; its onClose runs teardown). */
	function closeTop() {
		panels.close()
	}

	/** Pop every layer above `level`, top-down, so Esc lands one level back. */
	function popAbove(level: PanelLevel) {
		const at = layers().findIndex((entry) => entry.level === level)
		if (at < 0) return
		const above = layers().slice(at + 1)
		for (let index = above.length - 1; index >= 0; index -= 1) panels.close(above[index]!.handle)
	}

	function levelTitle(level: PanelLevel): string {
		switch (level) {
			case "table":
				return "Agents"
			case "fields": {
				const current = agent()
				return current === undefined ? "Agent" : agentName(current)
			}
			case "limits":
				return "Limits"
			case "limitEdit": {
				const current = agent()
				return current === undefined ? "Max rounds" : `Max rounds — ${agentName(current)}`
			}
			case "picker":
				return "Model"
			case "effort":
				return "Reasoning effort"
			case "deep": {
				const current = agent()
				return current === undefined ? "Max spawn depth" : `Max spawn depth — ${agentName(current)}`
			}
			case "viewer": {
				const current = agent()
				return current === undefined ? "System prompt" : `${agentName(current)} · system prompt`
			}
		}
	}

	// ---- open / close ----
	createEffect(() => {
		const preselected = bridgeOpen()
		if (preselected === undefined) return
		setBridgeOpen(undefined)
		// A second /agents while the manager is on screen is a no-op (the
		// command is not reachable from inside the modal anyway).
		if (layers().length > 0) return
		const next = reloadRows()
		setStatus(undefined)
		setChanged([])
		setEfforts([])
		setLimitError(undefined)
		const index = preselectAgentIndex(next, preselected)
		setTableCursor(index >= 0 ? index : 0)
		setLimitsCursor(0)
		setOpen(true)
		const level = initialAgentLevel(next)
		if (level === "limits") {
			setSelectedName(undefined)
			setCaps(undefined)
			void loadOfficialCaps()
			pushLevel("limits")
			return
		}
		pushLevel("table")
	})

	// ---- limits layer (l) ----
	const limitsRows = createMemo(() => agentLimitsRows(agent(), caps()))

	function showLimits() {
		const row = rows()[tableCursor()]
		setSelectedName(row?.name)
		setLimitsCursor(0)
		setLimitError(undefined)
		setCaps(undefined)
		setStatus(undefined)
		pushLevel("limits", row === undefined ? undefined : `target: ${agentName(row)}`)
		void loadOfficialCaps()
	}

	/** Official caps ride the host settings document; `n/a` until/unless read. */
	async function loadOfficialCaps() {
		let next: SeamAgentOfficialCaps = {}
		try {
			next = (await props.seam.agents?.officialCaps?.()) ?? {}
		} catch {
			next = {}
		}
		setCaps(next)
	}

	/**
	 * The two official caps are host settings (ns `subagent`), so Enter jumps
	 * to their real editor in /settings instead of a dead hint (the old copy
	 * said "edit them in /settings" with no way to get there).
	 */
	function openSettingsRow(key: "maxActiveSubagents" | "maxDepth") {
		panels.closeAll()
		setTimeout(() => openSettingsPanel(officialCapSettingsRow(key)), 3)
	}

	function openMaxRoundsEditor() {
		const current = agent()
		if (current === undefined) return
		setLimitValue(current.maxRounds === undefined ? "" : String(current.maxRounds))
		setLimitError(undefined)
		pushLevel("limitEdit")
	}

	function toggleBackground() {
		const current = agent()
		const seam = props.seam.agents
		if (current === undefined || seam === undefined) return
		const next = current.background !== true
		const result = seam.set(current.name, "background", next ? "true" : "false")
		if (result.error !== undefined) {
			setStatus(`✘ ${result.error}`)
			return
		}
		setStatus(
			next
				? "background on — this agent runs in background sessions"
				: "background off — foreground dispatch",
		)
		markChanged(current.name)
		reloadRows()
	}

	function commitMaxRounds(text: string) {
		const current = agent()
		if (current === undefined) return
		const parsed = parseMaxRoundsInput(text)
		if (parsed.kind === "keep") {
			setLimitError(undefined)
			closeTop()
			return
		}
		if (parsed.kind === "error") {
			setLimitError(parsed.error)
			return
		}
		const seam = props.seam.agents
		if (seam === undefined) return
		const result = seam.set(current.name, "maxRounds", String(parsed.value))
		if (result.error !== undefined) {
			setLimitError(result.error)
			return
		}
		setLimitError(undefined)
		setStatus(`maxRounds → ${parsed.value} saved — applies to future subagent spawns`)
		markChanged(current.name)
		reloadRows()
		closeTop()
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
		pushLevel("picker")
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
			pushLevel("effort")
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
			popAbove("fields")
			return
		}
		const thinkResult = thinking === null ? seam.set(current.name, "thinking", null) : seam.set(current.name, "thinking", thinking)
		// The model write already landed, so this is a real change even when
		// the effort write fails: mark it and re-read, then report both halves
		// (a silent failure here used to leave "Agents unchanged." in the exit
		// summary after a persisted model edit).
		markChanged(current.name)
		reloadRows()
		const scope = modelResult.target.kind === "profile" ? ` (profile "${modelResult.target.name}")` : ""
		const think = thinking !== null ? ` · think ${thinking}` : ""
		if (thinkResult.error !== undefined) {
			setStatus(`✘ thinking not saved: ${thinkResult.error} — model ${current.name} → ${model} saved`)
		} else {
			setStatus(`saved ${current.name} → ${model}${think}${scope}`)
		}
		popAbove("fields")
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
		pushLevel("effort")
	}

	function commitThinking(cursor: number) {
		const current = agent()
		if (current === undefined) return
		const seam = props.seam.agents
		if (seam === undefined) return
		const next = pickerSelectEffort({ stage: "effort", model: current.model ?? "", efforts: efforts(), cursor }, cursor)
		const thinking = next.stage === "done" ? next.thinking : null
		const result = seam.set(current.name, "thinking", thinking)
		if (result.error !== undefined) {
			setStatus(`✘ ${result.error}`)
		} else {
			const scope = result.target.kind === "profile" ? ` (profile "${result.target.name}")` : ""
			setStatus(`saved ${current.name} → think ${thinking ?? "inherit"}${scope}`)
			markChanged(current.name)
			reloadRows()
		}
		popAbove("fields")
	}

	function openDeepEditor() {
		const current = agent()
		if (current === undefined) return
		setDeepValue(String(current.deep))
		setDeepError(undefined)
		setDeepNotice(undefined)
		setDeepCommitted(false)
		pushLevel("deep")
	}

	function commitDeep(text: string) {
		const current = agent()
		if (current === undefined) return
		const parsed = parseDeepInput(text)
		if (parsed.kind === "keep") {
			closeTop()
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
		reloadRows()
	}

	/** Esc routed through the stack still reports the committed depth. */
	function leaveDeepEditor() {
		const current = agent()
		if (deepCommitted() && current !== undefined) {
			setStatus(`saved ${current.name} → max depth ${current.deep}`)
		}
		setDeepError(undefined)
		setDeepNotice(undefined)
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
		pushLevel("viewer")
	}

	function openFields(name: string) {
		setSelectedName(name)
		setFieldCursor(0)
		setStatus(undefined)
		pushLevel("fields")
	}

	/**
	 * The paged List state of the current level, or undefined when the level
	 * has no paged list. Only the table and the model picker page; the fields,
	 * limits, effort and viewer lists are short by construction.
	 */
	function pagedList(): { count: number; cursor: number; setCursor: (index: number) => void } | undefined {
		switch (activeLevel()) {
			case "table":
				return { count: rows().length, cursor: tableCursor(), setCursor: setTableCursor }
			case "picker":
				return { count: models().length, cursor: pickerCursor(), setCursor: setPickerCursor }
			default:
				return undefined
		}
	}

	/**
	 * PgUp/PgDn/Home/End for the level's paged List. The session's global
	 * `session.page.*` bindings consume these keys before the focused
	 * renderable, so the kit List never receives them; this layer re-applies
	 * the same semantics. Returns false (= not consumed) when the level is not
	 * a paged list or the list fits one page, so the transcript pager keeps the
	 * keys on a fitting window (and never loses them to a swallowed key).
	 *
	 * The cursor moves to the target page's first row (`end`: the last row) and
	 * the kit List's cursor-follow pulls the window to that row — reusing its
	 * page/clamp logic instead of a second implementation.
	 */
	function pageList(action: "pageup" | "pagedown" | "home" | "end"): boolean {
		const list = pagedList()
		if (list === undefined || list.count <= PAGE_SIZE) return false
		const pages = Math.max(1, Math.ceil(list.count / PAGE_SIZE))
		const page = Math.floor(list.cursor / PAGE_SIZE)
		const targetPage = nextListPage(action, page, pages)
		if (targetPage === undefined) return false
		const target = action === "end" ? list.count - 1 : action === "home" ? 0 : targetPage * PAGE_SIZE
		list.setCursor(Math.max(0, Math.min(list.count - 1, target)))
		return true
	}

	// ---- letter hotkeys: the consumer's own Keymap layer (not PANEL_KEY_IDS) ----
	Keymap.createLayer(() => {
		// Only the manager's own top layer may answer. A kit layer pushed on
		// top (a confirm dialog, a settings dropdown) is `panels.top` while
		// `layers` still names our last level, so the hotkeys stay parked
		// there instead of leaking into the layer below the popup.
		const top = panels.top
		const ownTop = layers().at(-1)?.handle
		return {
			mode: "global",
			enabled: open() && top !== undefined && top === ownTop,
			priority: 2,
			commands: [
			{
				bind: "m",
				title: "Agents: model",
				group: "Agents",
				enabled: () => activeLevel() === "fields",
				run: () => void openModelPicker(),
			},
			{
				bind: "t",
				title: "Agents: think level",
				group: "Agents",
				enabled: () => activeLevel() === "fields",
				run: () => void openThinkingPicker(),
			},
			{
				bind: "d",
				title: "Agents: spawn depth / background",
				group: "Agents",
				enabled: () => activeLevel() === "fields" || activeLevel() === "limits",
				run: () => {
					if (activeLevel() === "fields") openDeepEditor()
					else toggleBackground()
				},
			},
			{
				bind: "v",
				title: "Agents: full prompt",
				group: "Agents",
				enabled: () => activeLevel() === "fields",
				run: () => showViewer(),
			},
			{
				bind: "l",
				title: "Agents: limits",
				group: "Agents",
				enabled: () => activeLevel() === "table",
				run: () => showLimits(),
			},
			// The kit List pages itself, but the session's global
			// `session.page.*` layer consumes these keys first. Bind them here
			// (top layer + over-window only; `pageList` returns false otherwise)
			// and let the List's cursor-follow move the window.
			{ bind: "pageup", title: "Agents: page up", group: "Agents", run: () => pageList("pageup") },
			{ bind: "pagedown", title: "Agents: page down", group: "Agents", run: () => pageList("pagedown") },
			{ bind: "home", title: "Agents: first row", group: "Agents", run: () => pageList("home") },
			{ bind: "end", title: "Agents: last row", group: "Agents", run: () => pageList("end") },
			// The editors' Enter commit path. On every other level the binding
			// is disabled, so panel-kit's Enter (List select) is untouched.
			{
				bind: "return",
				title: "Agents: save",
				group: "Agents",
				enabled: () => activeLevel() === "deep" || activeLevel() === "limitEdit",
				run: () => {
					if (activeLevel() === "deep") commitDeep(deepValue())
					else commitMaxRounds(limitValue())
				},
			},
			],
		}
	})

	// ---- layer rendering ----
	function statusLine() {
		return (
			<Show when={status() !== undefined}>
				<text fg={theme().text.warning} wrapMode="none">
					{clipText(status()!, bodyWidth())}
				</text>
			</Show>
		)
	}

	function brokenLineView() {
		return (
			<Show when={brokenCount() > 0}>
				<text fg={theme().text.muted} wrapMode="none">
					{clipText(brokenLine(brokenCount()), bodyWidth())}
				</text>
			</Show>
		)
	}

	function renderLevel(level: PanelLevel): JSX.Element {
		switch (level) {
			case "table":
				return renderTable()
			case "fields":
				return renderFields()
			case "limits":
				return renderLimits()
			case "limitEdit":
				return renderLimitEditor()
			case "picker":
				return renderPicker()
			case "effort":
				return renderEffort()
			case "deep":
				return renderDeepEditor()
			case "viewer":
				return renderViewer()
		}
	}

	function renderTable(): JSX.Element {
		return (
			<FocusRoot>
				<PanelBody>
					<List
						items={agentTableItems(rows())}
						columns={AGENT_TABLE_COLUMNS}
						pageSize={PAGE_SIZE}
						width={bodyWidth()}
						query=""
						onQueryChange={() => {}}
						emptyLabel="no agents"
						activeId={rows()[tableCursor()]?.name}
						onActiveChange={(id) => {
							const index = rows().findIndex((row) => row.name === id)
							if (index >= 0) setTableCursor(clampStep(tableCursor(), index, rows().length))
						}}
						onSelect={(item) => openFields(item.id)}
					/>
					{brokenLineView()}
					{statusLine()}
				</PanelBody>
				<PanelActions hint="↑↓ navigate · enter open · l limits · esc back" />
			</FocusRoot>
		)
	}

	/** The kit's List wraps at both ends; /agents has always clamped. Recognise
	 * the one-step wrap and pin the cursor to the edge instead. */
	function clampStep(previous: number, next: number, count: number): number {
		if (count <= 1) return Math.max(0, Math.min(Math.max(0, count - 1), next))
		if (next === 0 && previous === count - 1) return count - 1
		if (next === count - 1 && previous === 0) return 0
		return next
	}

	function renderFields(): JSX.Element {
		const current = agent()
		return (
			<FocusRoot>
				<PanelBody>
					<Show when={current !== undefined} fallback={<text fg={theme().text.muted}>agent not found</text>}>
						<For each={agentFieldContent(current!)}>
							{(line) => (
								<text fg={theme().text.muted} wrapMode="none">
									{clipText(line === "" ? " " : line, bodyWidth())}
								</text>
							)}
						</For>
						<box height={1} flexShrink={0} />
						<List
							items={agentFieldItems(current!)}
							columns={AGENT_FIELD_COLUMNS}
							width={bodyWidth()}
							query=""
							onQueryChange={() => {}}
							activeId={agentFieldItems(current!)[fieldCursor()]?.id}
							onActiveChange={(id) => {
								const index = agentFieldItems(current!).findIndex((item) => item.id === id)
								if (index >= 0) setFieldCursor(index)
							}}
							onSelect={(item) => {
								if (item.value === "model") void openModelPicker()
								else if (item.value === "thinking") void openThinkingPicker()
								else openDeepEditor()
							}}
						/>
						{statusLine()}
					</Show>
				</PanelBody>
				<PanelActions hint="↑↓ field · enter edit · m model · t think · d deep · v prompt · esc back" />
			</FocusRoot>
		)
	}

	function renderLimits(): JSX.Element {
		const current = agent()
		const emptyCopy = () =>
			`no agents in ${props.seam.agents?.dir?.() ?? "$DSH_HOME/agents"} yet — drop a markdown file to define one`
		return (
			<FocusRoot>
				<PanelBody>
					<Show when={current === undefined}>
						<text fg={theme().text.muted} wrapMode="none">
							{clipText(emptyCopy(), bodyWidth())}
						</text>
						<box height={1} flexShrink={0} />
					</Show>
					<List
						items={agentLimitsItems(limitsRows())}
						columns={AGENT_FIELD_COLUMNS}
						width={bodyWidth()}
						query=""
						onQueryChange={() => {}}
						emptyLabel="no limits"
						activeId={limitsRows()[limitsCursor()]?.key}
						onActiveChange={(id) => {
							const index = limitsRows().findIndex((row) => row.key === id)
							if (index >= 0) setLimitsCursor(index)
						}}
						onSelect={(item) => {
							if (item.value === "maxRounds") openMaxRoundsEditor()
							else if (item.value === "background") toggleBackground()
							else openSettingsRow(item.value as "maxActiveSubagents" | "maxDepth")
						}}
					/>
					{brokenLineView()}
					{statusLine()}
				</PanelBody>
				<PanelActions hint="↑↓ field · enter edit · d toggle background · esc back" />
			</FocusRoot>
		)
	}

	function renderLimitEditor(): JSX.Element {
		return (
			<PanelBody>
				<text fg={theme().text.muted} wrapMode="none">
					{"positive integer · empty = inherit the global cap"}
				</text>
				<Show when={limitError() !== undefined}>
					<text fg={theme().text.danger} wrapMode="none">
						{clipText(`✘ ${limitError()}`, bodyWidth())}
					</text>
				</Show>
				<box height={1} flexShrink={0} />
				<box flexDirection="row" height={1} flexShrink={0}>
					<text fg={theme().text.accent} wrapMode="none">
						{"> "}
					</text>
					<input
						flexGrow={1}
						value={limitValue()}
						onInput={(value: string) => setLimitValue(value)}
						onSubmit={() => commitMaxRounds(limitValue())}
						ref={(renderable: Renderable) => {
							const attempt = () => {
								if (renderable.isDestroyed) return
								renderable.focus()
							}
							attempt()
							queueMicrotask(attempt)
							setTimeout(attempt, 1)
						}}
					/>
				</box>
				<PanelActions hint="enter save · esc back" />
			</PanelBody>
		)
	}

	function renderDeepEditor(): JSX.Element {
		return (
			<PanelBody>
				<text fg={theme().text.muted} wrapMode="none">
					{"0 = this agent never spawns subagents · no unlimited"}
				</text>
				<Show when={deepError() !== undefined}>
					<text fg={theme().text.danger} wrapMode="none">
						{clipText(`✘ ${deepError()}`, bodyWidth())}
					</text>
				</Show>
				<Show when={deepError() === undefined && deepNotice() !== undefined}>
					<text fg={theme().text.muted} wrapMode="none">
						{clipText(deepNotice()!, bodyWidth())}
					</text>
				</Show>
				<box height={1} flexShrink={0} />
				<box flexDirection="row" height={1} flexShrink={0}>
					<text fg={theme().text.accent} wrapMode="none">
						{"> "}
					</text>
					<input
						flexGrow={1}
						value={deepValue()}
						onInput={(value: string) => setDeepValue(value)}
						onSubmit={() => commitDeep(deepValue())}
						ref={(renderable: InputRenderable) => {
							const attempt = () => {
								if (renderable.isDestroyed) return
								renderable.focus()
							}
							attempt()
							queueMicrotask(attempt)
							setTimeout(() => {
								if (renderable.isDestroyed) return
								renderable.focus()
								renderable.gotoLineEnd()
							}, 1)
						}}
					/>
				</box>
				<PanelActions hint="enter save · esc back" />
			</PanelBody>
		)
	}

	function renderPicker(): JSX.Element {
		return (
			<FocusRoot>
				<PanelBody>
					<List
						items={agentPickerItems(models())}
						columns={AGENT_PICKER_COLUMNS}
						pageSize={PAGE_SIZE}
						width={bodyWidth()}
						query=""
						onQueryChange={() => {}}
						emptyLabel="no models"
						activeId={models()[pickerCursor()] === undefined ? undefined : `${models()[pickerCursor()]!.providerID}/${models()[pickerCursor()]!.modelID}`}
						onActiveChange={(id) => {
							const index = models().findIndex((model) => `${model.providerID}/${model.modelID}` === id)
							if (index >= 0) setPickerCursor(index)
						}}
						onSelect={(item) => void chooseModel(item.value!)}
					/>
				</PanelBody>
				<PanelActions hint="↑↓ navigate · enter select · esc back" />
			</FocusRoot>
		)
	}

	function renderEffort(): JSX.Element {
		const items = () => agentEffortItems(efforts())
		return (
			<FocusRoot>
				<PanelBody>
					<List
						items={items()}
						columns={AGENT_EFFORT_COLUMNS}
						width={bodyWidth()}
						query=""
						onQueryChange={() => {}}
						emptyLabel="no effort levels"
						activeId={items()[effortCursor()]?.id ?? "default"}
						onActiveChange={(id) => {
							const index = items().findIndex((item) => item.id === id)
							if (index >= 0) setEffortCursor(index)
						}}
						onSelect={(item) => commitThinking(items().findIndex((entry) => entry.id === item.id))}
					/>
				</PanelBody>
				<PanelActions hint="↑↓ navigate · enter select · esc back" />
			</FocusRoot>
		)
	}

	function renderViewer(): JSX.Element {
		const view = createMemo(() => viewerWindow(viewerBody(), viewerRows()))
		return (
			<PanelBody maxRows={viewerRows()}>
				<For each={view().lines}>
					{(line) => (
						<text fg={theme().text.muted} wrapMode="none">
							{clipText(line === "" ? " " : line, bodyWidth())}
						</text>
					)}
				</For>
				<Show when={view().hidden > 0}>
					<text fg={theme().text.faint} wrapMode="none">
						{clipText(`… ${view().hidden} more line(s)`, bodyWidth())}
					</text>
				</Show>
			</PanelBody>
		)
	}

	return null
}
