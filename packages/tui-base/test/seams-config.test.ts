/** seams/config (batch F2 cacheHitMode): the CH footer mode reader, tui-pi
 * narrowCacheHitMode parity — only the exact "session" string selects the
 * session-cumulative rate, everything else (including absent) narrows to
 * the lastMessage default. */
import { describe, expect, test } from "bun:test"
import { DEFAULT_CACHE_HIT_MODE, narrowCacheHitMode, readCacheHitMode } from "../src/seams/config.ts"

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
