/** seams/config (batch F2 cacheHitMode): the CH footer mode reader, tui-pi
 * narrowCacheHitMode parity — only the exact "session" string selects the
 * session-cumulative rate, everything else (including absent) narrows to
 * the lastMessage default. */
import { describe, expect, test } from "bun:test"
import {
	DEFAULT_CACHE_HIT_MODE,
	DEFAULT_SESSION_SCROLLBAR,
	narrowCacheHitMode,
	readCacheHitMode,
	readSessionScrollbar,
	resolveSessionScrollbar,
} from "../src/seams/config.ts"

describe("seams/config cacheHitMode", () => {
	test("default is lastMessage; only the exact 'session' string selects session", () => {
		expect(DEFAULT_CACHE_HIT_MODE).toBe("lastMessage")
		expect(narrowCacheHitMode("session")).toBe("session")
		expect(narrowCacheHitMode("lastMessage")).toBe("lastMessage")
		expect(narrowCacheHitMode("SESSION")).toBe("lastMessage")
		expect(narrowCacheHitMode(undefined)).toBe("lastMessage")
		expect(narrowCacheHitMode(42)).toBe("lastMessage")
	})

	test("readCacheHitMode reads the config seam's cacheHitMode key", () => {
		expect(readCacheHitMode({ cacheHitMode: "session" })).toBe("session")
		expect(readCacheHitMode({ theme: "dark" })).toBe("lastMessage")
		expect(readCacheHitMode({})).toBe("lastMessage")
		expect(readCacheHitMode(undefined)).toBe("lastMessage")
		expect(readCacheHitMode(null)).toBe("lastMessage")
	})
})

/** round7 AMEND — nested `session.scrollbar` off the read-only config faces. */
describe("seams/config session.scrollbar", () => {
	test("absent / malformed config degrades to unset, never a silent false", () => {
		expect(readSessionScrollbar()).toBeUndefined()
		expect(readSessionScrollbar({})).toBeUndefined()
		expect(readSessionScrollbar(undefined, null, { theme: "blue", cacheHitMode: "session" })).toBeUndefined()
		expect(readSessionScrollbar({ session: { scrollbar: "false" } })).toBeUndefined()
		expect(readSessionScrollbar({ session: "off" })).toBeUndefined()
	})

	test("explicit boolean in any config face is read (workspace > profile > configLoad)", () => {
		expect(readSessionScrollbar({ session: { scrollbar: false } })).toBe(false)
		expect(readSessionScrollbar({ session: { scrollbar: true } })).toBe(true)
		expect(readSessionScrollbar({ theme: "blue", session: { scrollbar: false, sidebar: "auto" } })).toBe(false)
		// first explicit value wins: the v2 wiring passes workspace, profile, load.
		expect(readSessionScrollbar({ session: { scrollbar: false } }, { session: { scrollbar: true } })).toBe(false)
		expect(readSessionScrollbar({}, { session: { scrollbar: false } })).toBe(false)
	})

	test("default is true; explicit false survives the resolve", () => {
		expect(DEFAULT_SESSION_SCROLLBAR).toBe(true)
		expect(resolveSessionScrollbar()).toBe(true)
		expect(resolveSessionScrollbar({})).toBe(true)
		expect(resolveSessionScrollbar(undefined, null, { theme: "dark" })).toBe(true)
		expect(resolveSessionScrollbar({ session: { scrollbar: false } })).toBe(false)
		expect(resolveSessionScrollbar({ session: { scrollbar: true } })).toBe(true)
		expect(resolveSessionScrollbar({ session: { scrollbar: "false" } })).toBe(true)
	})
})
