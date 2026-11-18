/**
 * Seam selection + fail-fast bootstrap for the in-process bridge (M2 / T9-T11).
 *
 * This is the ONLY place that decides which SessionSeam the synthetic root
 * (tui-base examples/v2-entry.tsx `bootClientV2`) constructs:
 *
 *   - inproc mode (`DSH_OPENTUI_INPROC=1`) + no explicit `--remote`
 *       → BridgeSessionSeam (the new default).
 *   - anything else, or an explicit `--remote`
 *       → RemoteSessionSeam (the legacy thin client, retained in phase one).
 *
 * The remote seam code is deliberately NOT deleted (ADR-0009 Consequences:
 * `--remote` stays visible-but-deprecated until 0.23.0).
 *
 * FAIL-FAST THREE ELEMENTS (tickets/2026-11-18-inproc-bridge-plan.md T11,
 * original text: "错误自包含诊断 + 修复命令 + 模式说明"):
 *   1. diagnosis      — what failed, with the expected/actual values;
 *   2. repair command — the concrete command to fix it;
 *   3. mode notice    — append-system is injected via the bridge section (M3),
 *                      presets are standard only.
 * Every `BridgeBootstrapError` message contains all three. There is NO
 * catch that falls back to the remote seam: in inproc mode a failed
 * handshake / fingerprint check is terminal and readable.
 */

import type { SessionSeam } from "../../../tui-base/src/seams/session"
import {
	BridgeProtocolError,
	BridgeSessionSeam,
	type BridgeDeadCause,
	type BridgeSeamContext,
	type BridgeTransport,
} from "./bridge-session-seam.ts"
// P0 fail-fast: the three-element text has ONE source (scripts/lib/...). This
// handshake path and the provision-script fingerprint path both import it, so
// the mode notice can never diverge between them again.
import {
	BRIDGE_APPEND_PRESET_NOTICE,
	BRIDGE_REPAIR_COMMAND,
	formatBridgeFailFastMessage,
} from "../../scripts/lib/bridge-failfast-text.mjs"
// A3: the host-compat window has ONE source (the provisioning gate). Reuse it
// in the recovery handshake instead of a second literal range in the client.
import { HOST_PEER_RANGE, isHostVersionSupported } from "../../scripts/lib/host-compat.mjs"

export { BRIDGE_APPEND_PRESET_NOTICE, BRIDGE_REPAIR_COMMAND }
export { BRIDGE_REPAIR_HINT } from "../../scripts/lib/bridge-failfast-text.mjs"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** `bridge.hello` protocol version this client speaks (ADR-0010:56). */
export const BRIDGE_PROTOCOL_VERSION = 1

// ---------------------------------------------------------------------------
// Pure seam selection
// ---------------------------------------------------------------------------

export type SeamKind = "bridge" | "remote"

export interface SeamSelectionInput {
	/** `DSH_OPENTUI_INPROC === "1"` (inproc profile/bundle opted in). */
	inproc: boolean
	/** Explicit `--remote` in the launch argv (deprecated override). */
	remote: boolean
}

/**
 * Decide the seam kind. Pure and total — unit-tested for both default
 * branches and for the explicit `--remote` override.
 *
 * `--remote` wins even in inproc mode: it is the retained escape hatch.
 */
export function selectSeamKind(input: SeamSelectionInput): SeamKind {
	if (input.remote) return "remote"
	return input.inproc ? "bridge" : "remote"
}

/** Read inproc mode from an env-like record (default: the process env). */
export function isInprocMode(env: Record<string, string | undefined> = process.env): boolean {
	return env.DSH_OPENTUI_INPROC === "1"
}

// ---------------------------------------------------------------------------
// Fail-fast error: the three elements in one self-contained message
// ---------------------------------------------------------------------------

export interface BridgeBootstrapErrorOptions {
	/** Stable protocol/bootstrap code (e.g. VERSION_INCOMPATIBLE). */
	code: string
	/** Element 1 — what failed, with expected/actual detail. */
	diagnosis: string
	/** Element 2 — override the default repair command when a better one exists. */
	repairCommand?: string
}

/** Compose the three elements into a single, copy-pasteable message. The
 *  repair command + mode notice lines come from the shared fail-fast source. */
export function formatBridgeBootstrapMessage(options: BridgeBootstrapErrorOptions): string {
	return formatBridgeFailFastMessage(
		`dsh-opentui inproc bridge seam failed [${options.code}]: ${options.diagnosis}`,
		options.repairCommand ?? BRIDGE_REPAIR_COMMAND,
	)
}

/**
 * A bridge startup failure. Unlike the seam's sync-degrade paths, this is
 * thrown at the composition root: in inproc mode the bridge is the ONLY
 * channel (no silent fallback to the remote seam).
 */
export class BridgeBootstrapError extends Error {
	readonly code: string
	readonly diagnosis: string
	readonly repairCommand: string

	constructor(options: BridgeBootstrapErrorOptions) {
		super(formatBridgeBootstrapMessage(options))
		this.name = "BridgeBootstrapError"
		this.code = options.code
		this.diagnosis = options.diagnosis
		this.repairCommand = options.repairCommand ?? BRIDGE_REPAIR_COMMAND
	}
}

/** Wrap an unknown thrown value into a bootstrap error without losing the
 *  protocol code / detail carried by a `BridgeProtocolError`. */
export function toBridgeBootstrapError(err: unknown, fallbackCode = "BRIDGE_HANDSHAKE_FAILED"): BridgeBootstrapError {
	if (err instanceof BridgeBootstrapError) return err
	if (err instanceof BridgeProtocolError) {
		const detail = err.detail === undefined ? "" : ` (detail: ${JSON.stringify(err.detail)})`
		return new BridgeBootstrapError({
			code: err.code || fallbackCode,
			diagnosis: `bridge handshake rejected: ${err.message}${detail}`,
		})
	}
	const message = err instanceof Error ? err.message : String(err)
	return new BridgeBootstrapError({ code: fallbackCode, diagnosis: `bridge handshake failed: ${message}` })
}

// ---------------------------------------------------------------------------
// Handshake / fingerprint verification (immediate failure, no fallback)
// ---------------------------------------------------------------------------

export interface BridgeFingerprint {
	protocolVersion: number
	bridgeVersion: string
	hostVersion: string
}

function asRecord(value: unknown): Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {}
}

/**
 * Verify a `bridge.hello` / `bridge.ping` reply against this client's
 * protocol version and required fingerprint fields. Any mismatch throws a
 * `BridgeBootstrapError` (three elements) — it never returns a degraded
 * value and never suggests using the remote seam.
 */
export function verifyBridgeFingerprint(
	hello: unknown,
	expectedProtocolVersion: number = BRIDGE_PROTOCOL_VERSION,
): BridgeFingerprint {
	const h = asRecord(hello)
	const protocolVersion = h.protocolVersion
	if (protocolVersion !== expectedProtocolVersion) {
		throw new BridgeBootstrapError({
			code: "VERSION_INCOMPATIBLE",
			diagnosis:
				`protocolVersion mismatch: client=${expectedProtocolVersion}, ` +
				`bridge=${String(protocolVersion)}, host=${String(h.hostVersion ?? "unknown")}`,
		})
	}
	const bridgeVersion = h.bridgeVersion
	const hostVersion = h.hostVersion
	if (typeof bridgeVersion !== "string" || bridgeVersion === "") {
		throw new BridgeBootstrapError({
			code: "FINGERPRINT_MISSING",
			diagnosis: `bridge.hello reply has no bridgeVersion (got ${String(bridgeVersion)})`,
		})
	}
	if (typeof hostVersion !== "string" || hostVersion === "") {
		throw new BridgeBootstrapError({
			code: "FINGERPRINT_MISSING",
			diagnosis: `bridge.hello reply has no hostVersion (got ${String(hostVersion)})`,
		})
	}
	return { protocolVersion, bridgeVersion, hostVersion }
}

/**
 * A3: the three recovery-handshake checks in one place — protocolVersion,
 * fingerprint fields, and host-compat. The first two reuse `verifyBridgeFingerprint`
 * verbatim (the first-boot path keeps its existing two checks and is NOT
 * changed); the third adds the host window that provisioning already enforces
 * at startup, so a respawned host on an incompatible version is refused here
 * with a readable, classified cause instead of silently drifting.
 *
 * Any mismatch throws `BridgeBootstrapError` whose `code` names the concrete
 * failed check — the transport turns that into a PERMANENT `BridgeDeadCause`.
 */
export function verifyRecoveryHandshake(
	hello: unknown,
	expectedProtocolVersion: number = BRIDGE_PROTOCOL_VERSION,
): BridgeFingerprint {
	const fingerprint = verifyBridgeFingerprint(hello, expectedProtocolVersion)
	if (!isHostVersionSupported(fingerprint.hostVersion)) {
		throw new BridgeBootstrapError({
			code: "HOST_INCOMPATIBLE",
			diagnosis:
				`hostVersion ${fingerprint.hostVersion} is outside the supported window ${HOST_PEER_RANGE} ` +
				`(bridge ${fingerprint.bridgeVersion}, client protocol ${expectedProtocolVersion})`,
		})
	}
	return fingerprint
}

// ---------------------------------------------------------------------------
// Seam construction — no fallback
// ---------------------------------------------------------------------------

export interface CreateBridgeSessionSeamOptions {
	transport: BridgeTransport
	ctx: BridgeSeamContext
	expectedProtocolVersion?: number
	/** A2: notified synchronously on the first DEAD transition (including a
	 *  handshake failure before the seam exists), so the UI can paint the
	 *  transient "连接已断开" notice without polling. */
	onDead?: (cause: BridgeDeadCause) => void
}

/** One-line transient notice text for a structured DEAD cause (A2). Kept in
 *  shell so the handshake path and the runtime path share one wording. */
export function formatDeadNotice(cause: BridgeDeadCause): string {
	const detail: string[] = []
	if (cause.code !== null) detail.push(`exit ${cause.code}`)
	if (cause.signal !== null) detail.push(cause.signal)
	detail.push(`stage ${cause.stage}`)
	return `⚠ 连接已断开: ${cause.message} (${detail.join(", ")})`
}

/** When `bridge.hello` fails because the transport already went DEAD, promote
 *  the captured cause to the `handshake` stage for the notice. */
function deadCauseFromBootstrapError(err: unknown): BridgeDeadCause | undefined {
	if (!(err instanceof BridgeProtocolError) || err.code !== "BRIDGE_DEAD") return undefined
	const detail = err.detail
	if (detail === null || typeof detail !== "object") return undefined
	const r = detail as Record<string, unknown>
	return {
		stage: "handshake",
		code: typeof r.code === "number" ? r.code : null,
		signal: typeof r.signal === "string" ? r.signal : null,
		message: typeof r.message === "string" ? r.message : err.message,
	}
}

/**
 * Handshake → fingerprint verification → BridgeSessionSeam. Any failure is
 * terminal: this function never returns a remote seam. The transport is
 * injected (not constructed here) so every failure path is unit-testable.
 */
export async function createBridgeSessionSeam(
	options: CreateBridgeSessionSeamOptions,
): Promise<BridgeSessionSeam> {
	const version = options.expectedProtocolVersion ?? BRIDGE_PROTOCOL_VERSION
	let hello: unknown
	try {
		hello = await options.transport.request("bridge.hello", { protocolVersion: version })
	} catch (err) {
		const cause = deadCauseFromBootstrapError(err)
		if (cause !== undefined) options.onDead?.(cause)
		throw toBridgeBootstrapError(err)
	}
	// Throws BridgeBootstrapError on mismatch — no `catch` that degrades.
	verifyBridgeFingerprint(hello, version)
	const seam = new BridgeSessionSeam({ transport: options.transport, ctx: options.ctx, onDead: options.onDead })
	// Populate the connection leg of status(); a ping failure after a verified
	// handshake is a recoverable DEAD→READY transition, not a boot failure, so
	// the seam's own lenient connect() is appropriate here.
	await seam.connect()
	return seam
}

export interface CreateSessionSeamOptions {
	kind: SeamKind
	createBridge: () => Promise<SessionSeam>
	createRemote: () => SessionSeam
}

/**
 * Dispatch to the selected seam factory. Deliberately has NO try/catch:
 * a bridge failure must propagate to the boot caller (fail fast), never be
 * swallowed into the remote path. This property is unit-tested.
 */
export async function createSessionSeam(options: CreateSessionSeamOptions): Promise<SessionSeam> {
	if (options.kind === "remote") return options.createRemote()
	return options.createBridge()
}
