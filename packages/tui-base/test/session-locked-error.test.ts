/**
 * ADR-0010 I4 — SESSION_LOCKED → localised `writer-held` diagnostic.
 *
 * The bridge maps the host's SessionAlreadyOwnedError to a typed error frame
 * (code=SESSION_LOCKED, detail.holder=<locked session id>); the transport
 * decodes it to a BridgeProtocolError; the seam rethrows it from turn() before
 * any live callback fires. These tests pin the tui-base mapping + the render
 * point that turns that rejection into the transcript error row / ⚠ notice.
 */
import { beforeEach, describe, expect, test } from "bun:test"
import { applyI18nConfig } from "@dsh-opentui/i18n"
import { createRoot } from "solid-js"
import { NullSessionSeam, type SeamTurnCallbacks } from "../src/seams/session"
import { createSeamRows } from "../src/routes/session/seam-rows"
import { errorMessage, sessionLockedErrorText } from "../src/util/error"

const lockedError = (holder: unknown, extra?: Record<string, unknown>) =>
	Object.assign(new Error("session already owned by another process"), {
		code: "SESSION_LOCKED",
		detail: holder === undefined ? undefined : { holder, ...extra },
	})

beforeEach(() => {
	applyI18nConfig()
})

describe("sessionLockedErrorText (mapping)", () => {
	test("SESSION_LOCKED + holder → writer-held diagnostic with the session id and holder", () => {
		const text = sessionLockedErrorText(lockedError("sess-42"))
		expect(text).toBeDefined()
		expect(text).toContain("writer-held")
		expect(text).toContain("sess-42")
		// both {id} and {holder} placeholders were substituted
		expect(text).not.toContain("{id}")
		expect(text).not.toContain("{holder}")
	})

	test("SESSION_LOCKED + distinct sessionId/holder fills both placeholders", () => {
		const text = sessionLockedErrorText(lockedError("holder-9", { sessionId: "sess-7" }))
		expect(text).toContain("sess-7")
		expect(text).toContain("holder-9")
	})

	test("SESSION_LOCKED without holder (missing / unknown / empty) → degradation, never a raw string or placeholder", () => {
		for (const value of [undefined, "unknown", ""]) {
			const text = sessionLockedErrorText(lockedError(value))
			expect(text).toBeDefined()
			expect(text).toContain("writer-held")
			expect(text).not.toContain("{holder}")
			expect(text).not.toContain("already owned by another process") // raw message not leaked
		}
		// a non-object detail must not throw either
		expect(() => sessionLockedErrorText({ code: "SESSION_LOCKED", detail: "nope" })).not.toThrow()
		expect(sessionLockedErrorText({ code: "SESSION_LOCKED", detail: "nope" })).toContain("writer-held")
	})

	test("other codes (and non-error values) are untouched — no diagnostic rewrite", () => {
		expect(sessionLockedErrorText({ code: "SESSION_NOT_FOUND", message: "gone" })).toBeUndefined()
		expect(sessionLockedErrorText({ code: "INTERNAL", detail: { holder: "x" } })).toBeUndefined()
		expect(sessionLockedErrorText(new Error("plain"))).toBeUndefined()
		expect(sessionLockedErrorText(undefined)).toBeUndefined()
		// errorMessage's existing behaviour stays intact for unrelated errors
		expect(errorMessage(new Error("plain"))).toBe("plain")
	})
})

class ThrowingSeam extends NullSessionSeam {
	error: unknown
	override async turn(_text: string, _cb: SeamTurnCallbacks): Promise<void> {
		throw this.error
	}
}

describe("seam-rows render path (rejected turn)", () => {
	test("a rejected SESSION_LOCKED turn paints the diagnostic row + onError notice and still rejects", async () => {
		const seam = new ThrowingSeam()
		seam.error = lockedError("sess-42")
		const notices: string[] = []
		let dispose!: () => void
		const projection = createRoot((d) => {
			dispose = d
			return createSeamRows(seam, () => "sess-42", { onError: (m) => notices.push(m) })
		})
		try {
			await expect(projection.send("hi")).rejects.toBe(seam.error)
			expect(notices).toHaveLength(1)
			expect(notices[0]).toContain("sess-42")
			expect(notices[0]).toContain("writer-held")
			const row = projection.rows.find((r) => r.kind === "assistant" && r.text.startsWith("error: "))
			expect(row).toBeDefined()
			expect(row?.text).toContain("sess-42")
			expect(row?.text).not.toContain("already owned by another process")
		} finally {
			dispose()
		}
	})

	test("a rejected non-SESSION_LOCKED turn does NOT emit a diagnostic notice (regression)", async () => {
		const seam = new ThrowingSeam()
		seam.error = Object.assign(new Error("boom"), { code: "INTERNAL" })
		const notices: string[] = []
		let dispose!: () => void
		const projection = createRoot((d) => {
			dispose = d
			return createSeamRows(seam, () => "s1", { onError: (m) => notices.push(m) })
		})
		try {
			await expect(projection.send("hi")).rejects.toBe(seam.error)
			expect(notices).toHaveLength(0)
		} finally {
			dispose()
		}
	})
})
