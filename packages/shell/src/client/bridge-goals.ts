/**
 * 025 W2-5b — hand-written seam projections for the goals faces released into
 * the generic arm in W2-5a (plan §4.2): goals/{create,get,edit,complete,pause,
 * resume,clear}.
 *
 * DISCIPLINE (R2 / C2 / AMEND-2 C-1 blind-spot family): SECOND whitelist on top
 * of the bridge wire sanitizer. EVERY goal result here is either
 * `additionalProperties:true` (schema-open) or `jsonSchema:null` (goals/get) —
 * i.e. the AMEND-2 static sensitive-key scan is BLIND to undeclared keys. The
 * generator therefore does NOT mark any goal id PROJECTED_BY_HAND, and the wire
 * default projection WOULD pass a hostile apiKey/token/secret through. This
 * module is the load-bearing defence: only the fields the TUI actually renders
 * cross into the seam, enums are closed, free text is capped, and every hostile
 * key is dropped. Each function is pure and unit-testable without a live host.
 *
 * Per-id default-projection assumptions are registered in
 * `.proof/025-w2-5/00-preregistered-expected.md §1 E5.b`.
 */
import type {
	SeamGoalRef,
	SeamGoalView,
} from "../../../tui-base/src/seams/session"

const MAX_TEXT = 4096
const MAX_SHORT = 240

const PHASES = ["active", "paused", "blocked", "complete"] as const
const ACTIVATIONS = ["armed", "disarmed"] as const

function asRecord(value: unknown): Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? value as Record<string, unknown>
		: {}
}

/** The generic wire layer wraps null/arrays/primitives as `{ value: ... }` and
 *  returns plain objects directly. Accept BOTH shapes so the seam never depends
 *  on that subtlety (same helper shape as bridge-directory / bridge-plugins). */
export function unwrapGoalsValue(raw: unknown): unknown {
	const rec = asRecord(raw)
	if (Object.prototype.hasOwnProperty.call(rec, "value")) return rec.value
	return raw
}

function text(value: unknown, max = MAX_TEXT): string | undefined {
	return typeof value === "string" ? value.slice(0, max) : undefined
}

function finiteNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function oneOf<T extends string>(value: unknown, set: readonly T[]): T | undefined {
	return typeof value === "string" && (set as readonly string[]).includes(value) ? value as T : undefined
}

/** GoalRef -> `{id, revision}` only (all other keys — declared or not — dropped). */
export function projectGoalRef(raw: unknown): SeamGoalRef | undefined {
	const rec = asRecord(unwrapGoalsValue(raw))
	const id = text(rec.id, MAX_SHORT)
	const revision = finiteNumber(rec.revision)
	if (id === undefined || id === "" || revision === undefined) return undefined
	return { id, revision }
}

/** goals/get result (`GoalView | undefined`, jsonSchema:null) -> closed seam view.
 *  undefined/null/malformed -> undefined (honest "no current goal", never a
 *  fabricated empty view). Free text capped; phase/activation closed enums. */
export function projectGoalView(raw: unknown): SeamGoalView | undefined {
	const value = unwrapGoalsValue(raw)
	if (value === null || value === undefined) return undefined
	const rec = asRecord(value)
	const id = text(rec.id, MAX_SHORT)
	const revision = finiteNumber(rec.revision)
	const objective = text(rec.objective, MAX_TEXT)
	const phase = oneOf(rec.phase, PHASES)
	const activation = oneOf(rec.activation, ACTIVATIONS)
	const roundsStarted = finiteNumber(rec.roundsStarted)
	const maxGoalRounds = finiteNumber(rec.maxGoalRounds)
	const createdAt = finiteNumber(rec.createdAt)
	const updatedAt = finiteNumber(rec.updatedAt)
	// A view is only accepted when every required field is present and shaped;
	// a partial/hostile reply degrades to "no current goal" instead of a fake row.
	if (
		id === undefined || id === "" || revision === undefined || objective === undefined ||
		phase === undefined || activation === undefined || roundsStarted === undefined ||
		maxGoalRounds === undefined || createdAt === undefined || updatedAt === undefined
	) return undefined
	const view: SeamGoalView = {
		id, revision, objective, phase, activation, roundsStarted, maxGoalRounds, createdAt, updatedAt,
	}
	const reason = asRecord(rec.blockedReason)
	const code = text(reason.code, MAX_SHORT)
	const message = text(reason.message, MAX_TEXT)
	if (code !== undefined && message !== undefined) view.blockedReason = { code, message }
	return view
}

/** goals/create result -> `SeamGoalRef | undefined`. */
export function projectCreateGoalResult(raw: unknown): SeamGoalRef | undefined {
	const rec = asRecord(unwrapGoalsValue(raw))
	return projectGoalRef(rec.ref)
}
