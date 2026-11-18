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
 * original text: "错误自包含诊断 + 修复命令 + '该模式无 append'提示"):
 *   1. diagnosis       — what failed, with the expected/actual values;
 *   2. repair command  — the concrete command to fix it;
 *   3. no-append notice — this mode has no append-system support yet (M3).
 * Every `BridgeBootstrapError` message contains all three. There is NO
 * catch that falls back to the remote seam: in inproc mode a failed
 * handshake / fingerprint check is terminal and readable.
 */

import type { SessionSeam } from "../../../tui-base/src/seams/session"
import {
	BridgeProtocolError,
	BridgeSessionSeam,
	type BridgeSeamContext,
	type BridgeTransport,
} from "./bridge-session-seam.ts"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** `bridge.hello` protocol version this client speaks (ADR-0010:56). */
export const BRIDGE_PROTOCOL_VERSION = 1

/** Concrete repair command carried by every bridge bootstrap error (T11 #2). */
export const BRIDGE_REPAIR_COMMAND = "dsh-opentui --repair-bridge"

/** The "no append in this mode" half of the error text (T11 #3). */
export const BRIDGE_NO_APPEND_NOTICE =
	"inproc bridge mode has no append-system support in 0.22.0 (M3 section not landed); presets are standard only."

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

/** Compose the three elements into a single, copy-pasteable message. */
export function formatBridgeBootstrapMessage(options: BridgeBootstrapErrorOptions): string {
	return [
		`dsh-opentui inproc bridge seam failed [${options.code}]: ${options.diagnosis}`,
		`Fix: ${options.repairCommand ?? BRIDGE_REPAIR_COMMAND}`,
		BRIDGE_NO_APPEND_NOTICE,
	].join("\n")
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

// ---------------------------------------------------------------------------
// Seam construction — no fallback
// ---------------------------------------------------------------------------

export interface CreateBridgeSessionSeamOptions {
	transport: BridgeTransport
	ctx: BridgeSeamContext
	expectedProtocolVersion?: number
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
		throw toBridgeBootstrapError(err)
	}
	// Throws BridgeBootstrapError on mismatch — no `catch` that degrades.
	verifyBridgeFingerprint(hello, version)
	const seam = new BridgeSessionSeam({ transport: options.transport, ctx: options.ctx })
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
