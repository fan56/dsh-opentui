/**
 * /session info panel (feature batch F4) — the key/value rows, in display
 * order, ported from dsh-tui-pi's sessions.ts `sessionInfoRows` (the same
 * field vocabulary: em-dash for unknown, tokens paired on shared rows,
 * speed rounded to whole tok/s).
 *
 * Pure and renderer-free: the command prints the rows as an aligned
 * transcript block (the /help print path), so the whole panel is
 * unit-testable without a renderer. The speed line carries BOTH rates the
 * batch asks for — last turn tok/s and the session average over summed
 * decode windows (first delta → settle per turn; unknown reads as "—",
 * never as 0 tok/s).
 */
import type { SeamSessionInfo } from "../../seams/session"

/** One panel row (field label + plain-text value). */
export interface SessionInfoRow {
	field: string
	value: string
}

/** Whole tok/s or "—" — the reference's speed-cell rule (no 0 tok/s lies). */
export function formatTps(tps: number | null | undefined): string {
	return tps === null || tps === undefined || !(tps > 0) ? "—" : `${Math.round(tps)} tok/s`
}

/**
 * The /session panel rows, in display order (reference sessions.ts
 * sessionInfoRows shape, restricted to the fields our session layer bills).
 */
export function sessionInfoRows(info: SeamSessionInfo): SessionInfoRow[] {
	const speed =
		info.lastTurnTps == null && info.sessionAvgTps == null
			? "—"
			: `last ${formatTps(info.lastTurnTps)} · avg ${formatTps(info.sessionAvgTps)}`
	return [
		{ field: "session", value: info.sessionId ?? "—" },
		{ field: "model", value: info.model ?? "—" },
		{ field: "messages", value: String(info.messageCount) },
		{ field: "turns", value: String(info.turnCount) },
		{ field: "tokens in/out", value: `${info.tokensIn} / ${info.tokensOut}` },
		{ field: "cache read/write", value: `${info.cacheRead} / ${info.cacheWrite}` },
		{ field: "speed", value: speed },
	]
}

/** Render the rows as an aligned transcript block (one line per row). */
export function formatSessionInfoPanel(rows: SessionInfoRow[]): string[] {
	const width = Math.max(...rows.map((row) => row.field.length))
	return rows.map((row) => `${row.field.padEnd(width)}  ${row.value}`)
}
