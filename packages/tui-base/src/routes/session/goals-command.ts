/**
 * 025 W2-5b — pure helpers for the `/goal` command (plan §4.2). UI-free and
 * table-testable: argument parsing + status-row formatting + explicit write
 * confirmation rows. All human text is resolved through `t()` so en/zh stay
 * keyed in parity; no seam/transport/state lives here.
 *
 * The command itself (commands.ts) owns every side effect: read (`goals.status`)
 * is zero-cost and the default; every mutation is an EXPLICIT subcommand that
 * must pass a yes/no confirmation before it calls its seam write face (no silent
 * change). On service absence / no active session the command degrades honestly.
 */
import { t } from "../../i18n"
import type { SeamGoalView } from "../../seams/session"

export type GoalsOp =
	| { kind: "status" }
	| { kind: "create"; objective: string }
	| { kind: "edit"; objective: string }
	| { kind: "pause" | "resume" | "complete" | "clear" }

const KNOWN_OPS = new Set(["create", "edit", "pause", "resume", "complete", "clear"])

/**
 * The misspelled subcommand token, or undefined when the input is a bare read
 * or a recognized op. `parseGoalsArgs` keeps its historical status fallback;
 * this separate probe lets the command surface an explicit hint so a typo like
 * `/goal destory` no longer silently degrades to a status read.
 */
export function goalsUnknownOp(argText: string): string | undefined {
	const trimmed = argText.trim()
	if (trimmed === "") return undefined
	const space = trimmed.search(/\s/)
	const token = (space < 0 ? trimmed : trimmed.slice(0, space)).toLowerCase()
	return KNOWN_OPS.has(token) ? undefined : token
}

/** i18n hint for a misspelled `/goal` subcommand (en/zh keyed, parity-checked). */
export function goalsUnknownOpHint(token: string): string {
	return t("command.goals.unknownOp", { op: token.slice(0, 48) })
}

/**
 * Parse `/goal [op] [text]`. Unknown or missing op -> status; bare write op
 * with no objective (create/edit) -> an op whose empty objective the command
 * refuses and prompts for. Kept deliberately simple: one subcommand + free text.
 */
export function parseGoalsArgs(argText: string): GoalsOp {
	const trimmed = argText.trim()
	if (trimmed === "") return { kind: "status" }
	const space = trimmed.search(/\s/)
	const op = (space < 0 ? trimmed : trimmed.slice(0, space)).toLowerCase()
	const rest = space < 0 ? "" : trimmed.slice(space + 1).trim()
	if (op === "create") return { kind: "create", objective: rest }
	if (op === "edit") return { kind: "edit", objective: rest }
	if (op === "pause" || op === "resume" || op === "complete" || op === "clear") return { kind: op }
	return { kind: "status" }
}

export function isGoalsWriteOp(op: GoalsOp): boolean {
	return op.kind !== "status"
}

/** Bounded status rows for the answer/data area. Never echo a raw host object:
 *  objective is capped, phase/activation are closed enums mapped to i18n keys. */
export function formatGoalStatus(view: SeamGoalView): string[] {
	const phaseKey = `command.goals.phase.${view.phase}`
	const activationKey = `command.goals.activation.${view.activation}`
	const phase = installed(phaseKey) ? t(phaseKey) : view.phase
	const activation = installed(activationKey) ? t(activationKey) : view.activation
	return [
		t("command.goals.header"),
		t("command.goals.objective", { text: view.objective.slice(0, 240) }),
		t("command.goals.phase.line", { phase }),
		t("command.goals.activation.line", { activation }),
		t("command.goals.rounds", { started: view.roundsStarted, max: view.maxGoalRounds }),
		t("command.goals.ref", { id: view.id.slice(0, 48), revision: view.revision }),
		...(view.blockedReason
			? [t("command.goals.blocked", { code: view.blockedReason.code.slice(0, 48), message: view.blockedReason.message.slice(0, 240) })]
			: []),
	]
}

// The status helper never throws on a missing i18n key: fall back to the raw
// enum only when the key is genuinely absent (defensive, no silent fake value).
function installed(key: string): boolean {
	try { return typeof t(key) === "string" && t(key) !== key } catch { return false }
}

/** Yes/no confirmation rows for an explicit write subcommand. */
export function goalsConfirmOptions(): { title: string; value: string }[] {
	return [
		{ title: t("command.goals.confirm.yes"), value: "yes" },
		{ title: t("command.goals.confirm.no"), value: "no" },
	]
}

export function goalsConfirmTitle(op: GoalsOp): string {
	if (op.kind === "status") return ""
	return t(`command.goals.confirm.${op.kind}`)
}
