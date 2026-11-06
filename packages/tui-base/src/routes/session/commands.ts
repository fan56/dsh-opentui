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
import type { SessionSeam } from "../../seams/session"
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
	 */
	pickOne(
		title: string,
		options: { title: string; description?: string; value: string }[],
	): Promise<string | undefined>
	/**
	 * Open the /btw side-question overlay (feature batch F3). Optional: an
	 * entry without the overlay host gets the "unavailable" notice.
	 */
	openBtw?(argText: string): void
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
			name: "/sessions",
			description: "list and resume stored sessions",
			async run(ctx) {
				const sessions = await ctx.seam.listSessions()
				if (sessions.length === 0) {
					ctx.say("no stored sessions")
					return
				}
				const picked = await ctx.pickOne(
					"Resume session",
					sessions.map((session) => ({
						title: session.title,
						value: session.id,
						description: session.updatedAt,
					})),
				)
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
