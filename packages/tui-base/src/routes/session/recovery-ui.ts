/**
 * RecoveryUiController — the UI-side state machine for DEAD bridge recovery
 * (blocky design §2.5/§2.6). Pure logic (no Solid / renderer dependency) so
 * `bun test` can drive it against a fake seam event stream.
 *
 * Only the four seam events below move the UI; the transport/session state
 * machine (A3/A4/A5) stays in the shell package. This controller consumes
 * events, owns the R-key availability gate, the composer-disable gate, the
 * three-state footer value and the persistent failure/locked banner.
 *
 * Wiring law: every user-visible string is INJECTED through `texts` (the page
 * builds the object from `t()` at call time, so a live language switch is
 * honoured). No CJK copy and no hardcoded English is baked into this module —
 * the i18n leak-guard scans tui-base/src with a zero baseline.
 */

export type RecoveryPhase = "ready" | "recovering" | "dead" | "failed" | "locked"
export type RecoveryFooterStatus = "ready" | "recovering" | "dead"
export type RecoveryBannerKind = "failed" | "locked"

/** Transient notices retire after 4s (blocky §2.6 recovered notice). */
export const RECOVERY_NOTICE_TTL_MS = 4000

/** Plain R is the reconnect key. Verified free of a base-layer binding in
 *  config/keybind.ts (ctrl+r and <leader>r are separate strokes). */
export const RECOVERY_RECONNECT_BIND = "r"
export const RECOVERY_RECONNECT_COMMAND = "session.bridge.recover"

export type RecoveryEvent = { type: string; details?: unknown }

export type RecoveryTexts = {
	/** "Connection lost - reconnecting..." transient line. */
	transient: () => string
	/** "Reconnected - {count} events caught up". */
	recovered: (count: number) => string
	/** Persistent banner reason: "Recovery failed: {reason}". */
	failedReason: (reason: string) => string
	/**
	 * Locked notice + banner reason (writer-held). `reason` is the host-reported
	 * occupancy detail from the seam; `holder` is the owning session id, passed
	 * only when `reason` does not already name it. Both are optional so a bare
	 * locked event still renders the base copy.
	 */
	locked: (reason?: string, holder?: string) => string
	/** P2-2: transient cooldown notice ("cooling down, N ms left"). */
	cooldown: (remainingMs: number) => string
	/** Failed-banner reconnect action label. */
	reconnect: () => string
	/** Locked-banner retry action label. */
	retry: () => string
	/** Both banners' new-session action label. */
	newSession: () => string
	/** Failed-banner quit action label. */
	quit: () => string
}

export type RecoveryBanner = {
	kind: RecoveryBannerKind
	reason: string
	sessionId?: string
	/** Raw owning-session id (P2-1) so the renderer can width-clip long ids. */
	holder?: string
}

export interface RecoveryUiOptions {
	/** Injected recovery entry (the page passes a recoverBridgeSession wrapper). */
	recover: () => Promise<unknown>
	texts: RecoveryTexts
	onNotice?: (text: string, ttlMs: number, kind?: "error") => void
	onNewSession?: () => void
	onQuit?: () => void
}

function asRecord(value: unknown): Record<string, unknown> {
	return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {}
}

function reasonOf(details: Record<string, unknown>): string {
	const error = asRecord(details.error)
	for (const value of [error.message, details.message]) {
		if (typeof value === "string" && value.trim() !== "") return value
	}
	return ""
}

/** Pure banner view model (renderer-free): reason row + action row. */
export function recoveryBannerLines(banner: RecoveryBanner | undefined, texts: RecoveryTexts): string[] {
	if (banner === undefined) return []
	const actions =
		banner.kind === "failed"
			? [texts.reconnect(), texts.newSession(), texts.quit()]
			: [texts.retry(), texts.newSession()]
	return [banner.reason, actions.join(" · ")]
}

export class RecoveryUiController {
	readonly texts: RecoveryTexts
	#recover: RecoveryUiOptions["recover"]
	#onNotice: RecoveryUiOptions["onNotice"]
	#onNewSession: RecoveryUiOptions["onNewSession"]
	#onQuit: RecoveryUiOptions["onQuit"]
	#phase: RecoveryPhase = "ready"
	#banner: RecoveryBanner | undefined
	#listeners = new Set<() => void>()

	constructor(options: RecoveryUiOptions) {
		this.#recover = options.recover
		this.texts = options.texts
		this.#onNotice = options.onNotice
		this.#onNewSession = options.onNewSession
		this.#onQuit = options.onQuit
	}

	get phase(): RecoveryPhase {
		return this.#phase
	}

	get banner(): RecoveryBanner | undefined {
		return this.#banner
	}

	/** Composer is disabled ONLY while a recovery is in flight. */
	get composerDisabled(): boolean {
		return this.#phase === "recovering"
	}

	/** Three-state footer: recovering / dead / ready. failed + locked use the
	 *  dead slot (session is not usable) until a retry/new-session changes it. */
	get footerStatus(): RecoveryFooterStatus {
		if (this.#phase === "recovering") return "recovering"
		if (this.#phase === "ready") return "ready"
		return "dead"
	}

	/** R key does nothing except in dead / failed / locked. */
	canRecover(): boolean {
		return this.#phase === "dead" || this.#phase === "failed" || this.#phase === "locked"
	}

	subscribe(listener: () => void): () => void {
		this.#listeners.add(listener)
		return () => this.#listeners.delete(listener)
	}

	#emit(): void {
		for (const listener of [...this.#listeners]) listener()
	}

	#phaseTo(next: RecoveryPhase): void {
		if (this.#phase === next) return
		this.#phase = next
		this.#emit()
	}

	#bannerTo(next: RecoveryBanner | undefined): void {
		this.#banner = next
		this.#emit()
	}

	handleEvent(event: RecoveryEvent): void {
		switch (event.type) {
			case "bridge.dead":
				this.#bannerTo(undefined)
				this.#phaseTo("dead")
				return
			case "bridge.recovered": {
				const details = asRecord(event.details)
				const count = typeof details.applied === "number" ? details.applied : 0
				this.#bannerTo(undefined)
				this.#phaseTo("ready")
				this.#onNotice?.(this.texts.recovered(count), RECOVERY_NOTICE_TTL_MS)
				return
			}
			case "bridge.recovery.failed": {
				const reason = reasonOf(asRecord(event.details))
				this.#phaseTo("failed")
				this.#bannerTo({ kind: "failed", reason: this.texts.failedReason(reason) })
				return
			}
			case "bridge.recovery.locked": {
				const details = asRecord(event.details)
				const sessionId = typeof details.sessionId === "string" ? details.sessionId : undefined
				// P2-1: prefer the seam's host-reported message (it carries the
				// occupancy diagnostic), then fall back to error.message. A bare
				// event has neither — the base copy still renders.
				const detailMessage =
					typeof details.message === "string" && details.message.trim() !== "" ? details.message : undefined
				const rawReason = detailMessage ?? reasonOf(details)
				// The holder is the owning session id carried in the bridge error's
				// detail.holder; read the seam's top-level field first, then the
				// nested error detail defensively ("unknown" is not an id).
				const errorDetail = asRecord(asRecord(details.error).detail)
				const holderValue = typeof details.holder === "string" ? details.holder : errorDetail.holder
				const holder =
					typeof holderValue === "string" && holderValue !== "" && holderValue !== "unknown"
						? holderValue
						: undefined
				// If the message already names the holder, do not print it twice.
				const holderSuffix = holder !== undefined && rawReason.includes(holder) ? undefined : holder
				const reason = this.texts.locked(rawReason !== "" ? rawReason : undefined, holderSuffix)
				this.#phaseTo("locked")
				this.#bannerTo({ kind: "locked", reason, sessionId, holder })
				// The locked branch carries BOTH a transient notice and actions.
				this.#onNotice?.(reason, RECOVERY_NOTICE_TTL_MS)
				return
			}
			default:
				return
		}
	}

	/** R-key body: no-op outside dead/failed/locked; one recover per press. */
	async recover(): Promise<void> {
		if (!this.canRecover()) return
		this.#bannerTo(undefined)
		this.#phaseTo("recovering")
		this.#onNotice?.(this.texts.transient(), RECOVERY_NOTICE_TTL_MS)
		try {
			await this.#recover()
			// Terminal state arrives as a seam event (recovered / failed / locked).
			// A recover() that resolves without an event leaves the UI recovering —
			// the event is the single source of truth, never a guessed success.
		} catch (err) {
			// P2-2: BRIDGE_RECOVERY_COOLDOWN is a TRANSIENT "too soon" response
			// ({remainingMs}), not a terminal recovery failure. Restoring the dead
			// phase keeps R available and avoids the persistent failed banner;
			// only a retiring notice reports the remaining wait. Detect by SHAPE
			// (code + numeric detail.remainingMs) so tui-base imports no shell type.
			const code = (err as { code?: unknown } | null)?.code
			const detail = asRecord((err as { detail?: unknown } | null)?.detail)
			if (
				code === "BRIDGE_RECOVERY_COOLDOWN" &&
				typeof detail.remainingMs === "number" &&
				Number.isFinite(detail.remainingMs)
			) {
				this.#phaseTo("dead")
				this.#onNotice?.(this.texts.cooldown(detail.remainingMs), RECOVERY_NOTICE_TTL_MS)
				return
			}
			const reason = err instanceof Error ? err.message : String(err)
			this.#phaseTo("failed")
			this.#bannerTo({ kind: "failed", reason: this.texts.failedReason(reason) })
		}
	}

	/**
	 * Shared new-session UI cleanup. Footer goes back to ready and the
	 * persistent failure/locked banner is removed. Both entry points call
	 * this SAME function: the banner action below and the typed `/new` slash
	 * command (via the page's `clearRecoveryUi` hook), so a session switch
	 * can never leave a stale dead footer / locked banner.
	 */
	clearRecoveryState(): void {
		this.#bannerTo(undefined)
		this.#phaseTo("ready")
	}

	/** Banner "new session" action: page clears the session + transcript. */
	newSession(): void {
		this.#onNewSession?.()
		this.clearRecoveryState()
	}

	/** Banner "quit" action: page shutdown. */
	quit(): void {
		this.#onQuit?.()
	}

	/** Keymap descriptor for the page layer (real engine binding is `r`). */
	reconnectCommand() {
		return {
			id: RECOVERY_RECONNECT_COMMAND,
			title: this.texts.reconnect(),
			group: "Session",
			bind: RECOVERY_RECONNECT_BIND,
			enabled: () => this.canRecover(),
			run: () => void this.recover(),
		}
	}
}
