/**
 * Slash-command registry (batch 8) — the rebuilt replacement for the old
 * `ShellHost` COMMANDS table + runCommand switch (the cutover delete
 * target; nothing here imports it).
 *
 * Shape: a simple table of `{ name, description, run }`. `run` receives a
 * `SlashCommandContext` the page supplies (seam + the host-side effects a
 * command can ask for: transcript feedback rows, client-side clear, reload,
 * quit, and one generic modal picker). Commands stay UI-free except through
 * those hooks, so the registry is table-testable without a renderer.
 *
 * Batch 8 carries the Q5 minimal face exactly: /help /new /model /quit
 * /sessions /clear, plus /btw (feature batch F3). Later commands (/attach …)
 * are POST-CUTOVER fill — absent from the table, not stubbed.
 *
 * Dispatch vocabulary (old ShellHost parity):
 *   "/model provider/id"  → argument form runs directly
 *   "/nope"               → "unknown command" (a harmless error row, NOT a
 *                            send to the model)
 *   plain text            → not a command; caller sends/steers as batch 4
 */
import type { SeamPresetRow, SessionSeam } from "../../seams/session"
import { hotkeyRows, hotkeysHeader } from "./hotkeys"
import { emptyFilteredCopy, filterSessionsBySizeFloor, resumePickerOptions } from "./resume-picker"
import { formatSessionInfoPanel, sessionInfoRows } from "./session-info"

/** One registry row: name carries the leading slash ("/help"). */
export interface SlashCommand {
	name: string
	description: string
	run(ctx: SlashCommandContext, argText: string): void | Promise<void>
}

/** Host-side effects a command may ask for; the page owns each hook. */
export interface SlashCommandContext {
	seam: SessionSeam
	/** Append a system-style line to the transcript view (command feedback). */
	say(text: string): void
	/** Client-side transcript reset (/clear). */
	clear(): void
	/** Re-hydrate the transcript from the seam (/new, /sessions resume).
	 * May return a settle promise; commands awaiting it can append rows
	 * AFTER the re-hydrate instead of being wiped by it. */
	reload(): void | Promise<void>
	/** Exit the app (/quit). */
	quit(): void
	/**
	 * One generic modal picker (the vendored dialog-select through the page's
	 * overlay host). Resolves the picked value, or undefined on esc/cancel.
	 * `headerLine` (G1 resume-picker batch) paints an aligned column-header
	 * line under the dialog title (the /sessions UPDATED/DIR columns).
	 */
	pickOne(
		title: string,
		options: { title: string; value: string; description?: string }[],
		headerLine?: string,
	): Promise<string | undefined>
	/**
	 * Open the /btw side-question overlay (feature batch F3). Optional: an
	 * entry without the overlay host gets the "unavailable" notice.
	 */
	openBtw?(argText: string): void
	/**
	 * Theme-switch surface (batch F7a): the page's ThemeSeam slice. Optional
	 * — an entry without it gets the "unavailable" notice.
	 */
	themes?: {
		current(): string
		list(): string[]
		set(name: string): boolean
	}
	/**
	 * Open the cross-session FTS search overlay (batch H3). Optional — an
	 * entry without it gets the "unavailable" notice.
	 */
	openSearch?(): void
	/**
	 * Open the plugins manager panel (batch H3 — the /plugins panel upgrade).
	 * Optional — an entry without it keeps the F7a transcript listing.
	 */
	openPlugins?(): void
}

// ---------------------------------------------------------- /preset helpers --
// Batch H2 (tui-pi 60-preset parity). Pure — table-testable like the
// resume-picker helpers.

/**
 * The row `/preset next` would switch to — the roster item after the current
 * selection, wrapping around (tui-pi peekNextPreset semantics). Undefined
 * with 0 or 1 rows (nothing to rotate to). When nothing is current (no
 * session attached yet, or the selection is not in the roster) the anchor is
 * the registry-default row, falling back to the first-listed one.
 */
export function presetNextRow(rows: SeamPresetRow[], currentId: string | undefined): SeamPresetRow | undefined {
	if (rows.length <= 1) return undefined
	const anchorId =
		currentId ?? rows.find((row) => row.isDefault)?.id ?? rows[0]?.id
	const index = rows.findIndex((row) => row.id === anchorId)
	if (index < 0) return rows[0]
	return rows[(index + 1) % rows.length]
}

/** Find a preset by id or display name, case-insensitive (tui-pi
 * findPresetByName semantics, officialName folded into the name). */
export function findPresetRow(rows: SeamPresetRow[], query: string): SeamPresetRow | undefined {
	const needle = query.trim().toLowerCase()
	if (needle === "") return undefined
	return rows.find((row) => row.id.toLowerCase() === needle || row.name.toLowerCase() === needle)
}

/** The batch-8 core set, bound to a context at call time (pure table). */
export function coreCommands(): SlashCommand[] {
	return [
		{
			name: "/help",
			description: "show available commands",
			run(ctx) {
				for (const command of coreCommands()) ctx.say(`${command.name} — ${command.description}`)
			},
		},
		{
			name: "/new",
			description: "start a fresh session",
			async run(ctx) {
				ctx.seam.newSession()
				await ctx.reload()
				ctx.say(`new session ${ctx.seam.currentSessionId() ?? "(unnamed)"}`)
			},
		},
		{
			name: "/model",
			description: "switch model (bare opens the picker)",
			async run(ctx, argText) {
				const arg = argText.trim()
				if (arg) {
					const [providerID, modelID] = arg.split("/")
					if (!providerID || !modelID) {
						ctx.say(`usage: /model or /model provider/model (got "${arg}")`)
						return
					}
					ctx.seam.selectModel(providerID, modelID)
					ctx.say(`model → ${providerID}/${modelID}`)
					return
				}
				const catalog = await ctx.seam.modelCatalog()
				if (catalog.length === 0) {
					ctx.say("no models in the catalog")
					return
				}
				const current = await ctx.seam.currentModelSelection()
				const picked = await ctx.pickOne(
					"Select model",
					catalog.map((model) => ({
						title: `${model.providerID}/${model.modelID}`,
						value: `${model.providerID}/${model.modelID}`,
						description: current?.providerID === model.providerID && current.modelID === model.modelID ? "current" : undefined,
					})),
				)
				if (!picked) return
				const [providerID, modelID] = picked.split("/")
				ctx.seam.selectModel(providerID, modelID)
				ctx.say(`model → ${picked}`)
			},
		},
		{
			name: "/quit",
			description: "exit the app",
			run(ctx) {
				ctx.quit()
			},
		},
		{
			// G1 resume-picker batch: the /sessions picker upgrades to the
			// reference /resume column semantics (dsh-tui-pi 66 Phases C/D):
			// aligned UPDATED (relative time) / DIR (workspace dir) columns
			// under a fitted header line, the 1KB size display floor (rows
			// without a size fail open), and the empty-FILTERED copy distinct
			// from the plain empty-store one. Retention (deletion / age
			// windows) stays host-side — out of scope here.
			name: "/sessions",
			description: "list and resume stored sessions",
			async run(ctx) {
				const sessions = await ctx.seam.listSessions()
				if (sessions.length === 0) {
					ctx.say("no stored sessions")
					return
				}
				const visible = filterSessionsBySizeFloor(sessions)
				if (visible.length === 0) {
					ctx.say(emptyFilteredCopy(sessions.length))
					return
				}
				const { header, options } = resumePickerOptions(visible)
				const picked = await ctx.pickOne("Resume session", options, header)
				if (!picked) return
				ctx.seam.resumeSession(picked)
				await ctx.reload()
				ctx.say(`resumed ${picked}`)
			},
		},
		{
			name: "/clear",
			description: "clear the transcript",
			run(ctx) {
				ctx.clear()
				ctx.say("transcript cleared")
			},
		},
		{
			// Feature batch F3. Never busy-gated: the side call rides a throwaway
			// session, so a mid-turn /btw streams alongside the main turn.
			name: "/btw",
			description: "side question (bare reopens the last answer)",
			run(ctx, argText) {
				if (!ctx.seam.btwAsk || !ctx.openBtw) {
					ctx.say("/btw unavailable in this session")
					return
				}
				ctx.openBtw(argText)
			},
		},
		{
			// Feature batch F4. Prints the info panel as an aligned transcript
			// block (the /help print path) — no overlay, no busy-gate.
			name: "/session",
			description: "show session info (id, model, tokens, speed)",
			async run(ctx) {
				if (!ctx.seam.sessionInfo) {
					ctx.say("/session unavailable in this session")
					return
				}
				const info = await ctx.seam.sessionInfo()
				if (!info || info.sessionId === null) {
					ctx.say("no active session")
					return
				}
			for (const line of formatSessionInfoPanel(sessionInfoRows(info))) ctx.say(line)
		},
		},
		{
			// Feature batch F7a → H3 panel upgrade. With the panel hook the
			// command opens the "🔌 Plugins" manager panel (bundle table +
			// state column + `/` filter); without it the F7a transcript
			// listing remains the degrade path. Never busy-gated — a pure read.
			name: "/plugins",
			description: "manage plugins (opens the panel)",
			run(ctx) {
				if (!ctx.seam.plugins) {
					ctx.say("/plugins unavailable in this session")
					return
				}
				if (ctx.openPlugins) {
					ctx.openPlugins()
					return
				}
				const plugins = ctx.seam.plugins()
				if (plugins.length === 0) {
					ctx.say("no plugins installed")
					return
				}
				for (const plugin of plugins) ctx.say(`● ${plugin.name}@${plugin.version}`)
			},
		},
		{
			// Feature batch H3 (tui-pi 77 search parity). Opens the
			// cross-session FTS overlay over the seam's searchSessions face
			// (both adapters carry it 1:1). Never busy-gated — the query is a
			// pure read over the stored corpus, not a model turn.
			name: "/search",
			description: "full-text search over stored sessions",
			run(ctx) {
				if (!ctx.openSearch) {
					ctx.say("/search unavailable in this session")
					return
				}
				ctx.openSearch()
			},
		},
		{
			// Feature batch F7b. Opens the reasoning-effort picker over the
			// CURRENT model route's real ladder (seam.thinking — the adapters
			// read provider data, never a hardcoded tier set). Picking rides
			// /model's effort semantics (switchModel with a reasoningEffort arm
			// — next-turn effect). Absent surface or an empty ladder = the
			// unavailable notice (the /btw degrade contract).
			name: "/think",
			description: "set reasoning effort (opens the picker)",
			async run(ctx) {
				const thinking = ctx.seam.thinking
				if (!thinking) {
					ctx.say("/think unavailable in this session")
					return
				}
				const efforts = await thinking.efforts()
				if (efforts.length === 0) {
					ctx.say("/think unavailable: the current model exposes no reasoning efforts")
					return
				}
				const current = await thinking.currentEffort()
				const picked = await ctx.pickOne(
					"Select reasoning effort",
					efforts.map((effort) => ({
						title: effort.name,
						value: effort.id,
						description: effort.id === current ? "current" : effort.description,
					})),
				)
				if (!picked || picked === current) return
				thinking.selectEffort(picked)
				ctx.say(`thinking → ${picked} (next turn)`)
			},
		},
		{
			// Feature batch F7b. Static keybind surface: rows generated from
			// THIS stack's config/keybind.ts Definitions (the /help print path
			// — aligned transcript lines, no overlay, no busy-gate).
			name: "/hotkeys",
			description: "show keybinds",
			run(ctx) {
				ctx.say(hotkeysHeader())
				for (const row of hotkeyRows()) ctx.say(row)
			},
		},
		{
			// Feature batch F7a. Bare opens the picker over the bundled theme
			// list (the generic pickOne modal — the same shape as /model), the
			// preselected current marked; picking applies the theme live. No
			// argument form — the picker IS the reference surface.
			name: "/theme",
			description: "switch theme (opens the picker)",
			async run(ctx) {
				if (!ctx.themes) {
					ctx.say("/theme unavailable in this session")
					return
				}
				const current = ctx.themes.current()
				const picked = await ctx.pickOne(
					"Select theme",
					ctx.themes.list().map((name) => ({
						title: name,
						value: name,
						description: name === current ? "current" : undefined,
					})),
				)
				if (!picked || picked === current) return
				if (ctx.themes.set(picked)) ctx.say(`Theme: ${picked} — applied`)
				else ctx.say(`unknown theme: ${picked}`)
			},
		},
		{
			// Feature batch H2 (tui-pi 60-preset parity). The deployment's agent
			// preset roster (seam.preset — the host agentPresets registry).
			// Bare opens the picker over the roster (the current row marked),
			// "/preset next" rotates one slot with wrap, "/preset <id|name>"
			// targets directly. The switch rides the adapters' switchPreset
			// semantics — the picked id composes the NEXT session — so a live
			// session confirms first ("Switch preset to <name>?", the reference
			// dialog copy; Esc/Cancel keeps everything), a fresh app (nothing
			// attached) applies directly. Absent face or an empty roster =
			// the degrade notices (the /plugins contract).
			name: "/preset",
			description: "switch agent preset (bare opens the picker, next rotates)",
			async run(ctx, argText) {
				const face = ctx.seam.preset
				if (!face) {
					ctx.say("/preset unavailable in this session")
					return
				}
				const rows = await face.list()
				if (rows.length === 0) {
					ctx.say("no agent presets available")
					return
				}
				const currentId = await face.currentId()
				const arg = argText.trim()
				let target: SeamPresetRow | undefined
				if (arg === "") {
					const picked = await ctx.pickOne(
						"Select agent preset",
						rows.map((row) => ({
							title: row.name,
							value: row.id,
							description: row.id === currentId ? "current" : row.description,
						})),
					)
					if (!picked || picked === currentId) return
					target = rows.find((row) => row.id === picked)
				} else if (arg === "next") {
					target = presetNextRow(rows, currentId)
					if (!target) {
						ctx.say("no other preset to switch to")
						return
					}
				} else {
					target = findPresetRow(rows, arg)
					if (!target) {
						ctx.say(`unknown preset: ${arg}`)
						return
					}
					if (target.id === currentId) {
						ctx.say(`preset already: ${target.name}`)
						return
					}
				}
				if (!target) return
				if (ctx.seam.status().sessionAttached) {
					const verdict = await ctx.pickOne(`Switch preset to ${target.name}?`, [
						{ title: `Switch to ${target.name}`, value: "switch" },
						{ title: "Cancel", value: "cancel" },
					])
					if (verdict !== "switch") return
				}
				if (!(await face.select(target.id))) {
					ctx.say(`preset switch failed: ${target.name}`)
					return
				}
				ctx.say(`preset → ${target.name} (new session)`)
				await ctx.reload()
			},
		},
	]
}

/**
 * Prefix filter for the palette: the query must be the head of the name,
 * slash included ("/lo" matches "/logout"-shaped rows — here "/clear" no,
 * "/model" only from "/m…"). Empty query = the full table.
 */
export function filterCommands(commands: SlashCommand[], query: string): SlashCommand[] {
	if (!query.startsWith("/")) return []
	const needle = query.toLowerCase()
	return commands.filter((command) => command.name.toLowerCase().startsWith(needle))
}

/** Dispatch one submitted line. Returns what the caller should do next. */
export type SlashDispatch =
	| { kind: "command"; command: SlashCommand; argText: string }
	| { kind: "unknown"; name: string }
	| { kind: "text" }

/**
 * Classify a submitted line: exact/prefixed command name (with the rest of
 * the line as its argument text), an unknown "/xxx" (harmless error row —
 * never sent to the model), or plain text.
 *
 * Resolution is by table lookup: the first command whose name the line
 * starts with, longest match first, so a typed "/model provider/id" is not
 * hijacked by bare "/model" — the argument text rides along and /model's
 * argument branch handles it.
 */
export function dispatchLine(commands: SlashCommand[], line: string): SlashDispatch {
	const text = line.trim()
	if (!text.startsWith("/")) return { kind: "text" }
	const [head, ...rest] = text.split(/\s+/)
	const needle = head.toLowerCase()
	// Exact name wins first — "/session" must not be shadowed by the longer
	// "/sessions" (both start with the typed head); the length sort then only
	// orders the remaining prefix matches (palette-style abbreviations).
	const match =
		commands.find((command) => command.name.toLowerCase() === needle) ??
		commands
			.filter((command) => command.name.toLowerCase().startsWith(needle))
			.sort((a, b) => b.name.length - a.name.length)[0]
	if (!match) return { kind: "unknown", name: head }
	return { kind: "command", command: match, argText: rest.join(" ") }
}

/** The harmless error row text for an unknown command (old ShellHost parity). */
export function unknownCommandRow(name: string): string {
	return `unknown command: ${name} (try /help)`
}
