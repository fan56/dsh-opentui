/**
 * Gap C12 (/export session export) — the PURE side of the export path.
 *
 * The command body (commands.ts coreCommands) owns every side effect: it
 * fetches the journal through the seam's optional `sessionJournal` face
 * (the same RAW-journal read /history folds) and writes the file INSIDE the
 * command run — this module never touches fs (the commands.ts
 * table-testable-registry red line: no top-level side effects).
 *
 * Format honesty (design §3c): `session/page` returns SessionWireEvent
 * envelope records — the host's native durable journal shape. This is NOT
 * guaranteed schema-identical to tui-pi's `snapshotEvents()` agent events,
 * so the completion copy says "host journal format", never a /resume-replay
 * promise (that claim is the D4 on-device gate, not a static one).
 */
import { homedir } from "node:os"
import { resolve } from "node:path"
import type { HistoryJournalEntry } from "./history-data"

/**
 * Resolve the export target. No arg (or blank) → the tui-pi habit carried
 * over whole: `~/Downloads/dsh-session-<first 8 chars of the session
 * id>.jsonl` (path-unsafe id characters fold to `-` so the filename stays
 * valid). An explicit arg resolves against the client cwd like tui-pi's
 * `resolve(rawInput)`. The caller owns mkdir -p (see the command run).
 */
export function exportTargetPath(sessionId: string, arg?: string): string {
	const trimmed = arg?.trim()
	if (trimmed) return resolve(trimmed)
	const id8 = sessionId.slice(0, 8).replace(/[^A-Za-z0-9._-]/g, "-")
	return resolve(homedir(), "Downloads", `dsh-session-${id8}.jsonl`)
}

/**
 * Serialize journal records to JSONL: one `JSON.stringify` per record,
 * newline-terminated lines (tui-pi export parity). An EMPTY journal yields
 * an EMPTY string — the caller writes an empty file (a real artifact, not
 * a silent skip), mirroring "the session has nothing to replay yet".
 */
export function journalToJSONL(entries: readonly HistoryJournalEntry[]): string {
	if (entries.length === 0) return ""
	return entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n"
}
