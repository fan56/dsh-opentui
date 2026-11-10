/**
 * Slash-command usage memory (frequent-first palette ordering).
 *
 * Pins the persistence contract the palette relies on: the count map rides
 * the config seam under one namespaced key, round-trips across rebuilds, and
 * every failure leg (unreadable config, throwing writer, missing seam) turns
 * into a silent session-scoped counter instead of a startup error.
 */
import { describe, expect, test } from "bun:test"
import {
	CommandUsage,
	SLASH_USAGE_KEY,
	createCommandUsage,
	normalizeCommandUsage,
} from "../src/routes/session/slash-usage"

describe("normalizeCommandUsage", () => {
	test("keeps only slash names with positive finite counts", () => {
		expect(
			normalizeCommandUsage({
				"/help": 3,
				"/model": 1.9,
				notACommand: 4,
				"/zero": 0,
				"/negative": -2,
				"/nan": Number.NaN,
				"/string": "3",
			}),
		).toEqual({ "/help": 3, "/model": 1 })
	})

	test("non-object values collapse to an empty map", () => {
		expect(normalizeCommandUsage(undefined)).toEqual({})
		expect(normalizeCommandUsage(null)).toEqual({})
		expect(normalizeCommandUsage([])).toEqual({})
		expect(normalizeCommandUsage("nope")).toEqual({})
	})
})

describe("CommandUsage", () => {
	test("record increments and reports the per-name count", () => {
		const usage = new CommandUsage()
		expect(usage.count("/help")).toBe(0)
		usage.record("/help")
		usage.record("/help")
		usage.record("/new")
		expect(usage.count("/help")).toBe(2)
		expect(usage.count("/new")).toBe(1)
		expect(usage.counts()).toEqual({ "/help": 2, "/new": 1 })
	})

	test("a throwing writer degrades silently and keeps the in-memory count", () => {
		const usage = new CommandUsage({}, () => {
			throw new Error("disk full")
		})
		expect(() => usage.record("/help")).not.toThrow()
		expect(() => usage.flush()).not.toThrow()
		expect(usage.count("/help")).toBe(1)
	})

	test("records inside the window coalesce into ONE save of the merged map", async () => {
		const writes: Record<string, number>[] = []
		const usage = new CommandUsage({}, (counts) => writes.push(counts), 30)
		usage.record("/help")
		usage.record("/help")
		usage.record("/new")
		expect(writes).toHaveLength(0) // still debouncing, not one write per dispatch
		await new Promise((resolve) => setTimeout(resolve, 80))
		expect(writes).toEqual([{ "/help": 2, "/new": 1 }])
	})

	test("flush writes immediately and clears the timer (no double save)", async () => {
		let saves = 0
		const usage = new CommandUsage({}, () => saves++, 30)
		usage.record("/help")
		usage.flush()
		expect(saves).toBe(1)
		await new Promise((resolve) => setTimeout(resolve, 80))
		expect(saves).toBe(1) // the pending timer was cancelled, not re-fired
		usage.flush()
		expect(saves).toBe(1) // clean counter = no redundant write
	})
})

describe("createCommandUsage (config seam)", () => {
	test("loads, saves, and round-trips through the config seam", () => {
		const config: Record<string, unknown> = {}
		const seam = {
			configLoad: () => config,
			configSave: (patch: Record<string, unknown>) => Object.assign(config, patch),
		}
		const usage = createCommandUsage(seam)
		expect(usage.count("/help")).toBe(0)
		usage.record("/help")
		usage.record("/help")
		usage.flush()
		expect(config[SLASH_USAGE_KEY]).toEqual({ "/help": 2 })
		// a fresh boot over the same config sees the persisted counts
		expect(createCommandUsage(seam).count("/help")).toBe(2)
	})

	test("an unreadable config starts empty (startup never fails)", () => {
		const seam = {
			configLoad: () => {
				throw new Error("bad json")
			},
			configSave: () => ({}),
		}
		const usage = createCommandUsage(seam)
		expect(usage.counts()).toEqual({})
		usage.record("/new")
		expect(usage.count("/new")).toBe(1)
	})

	test("a seam without the config face stays session-scoped", () => {
		const usage = createCommandUsage(undefined)
		usage.record("/help")
		expect(usage.count("/help")).toBe(1)

		const bare = createCommandUsage({} as any)
		bare.record("/help")
		expect(bare.count("/help")).toBe(1)
	})

	test("a legacy /sessions count is read once as /resume and then retired", () => {
		const config: Record<string, unknown> = {
			[SLASH_USAGE_KEY]: { "/sessions": 4, "/help": 1 },
		}
		const seam = {
			configLoad: () => config,
			configSave: (patch: Record<string, unknown>) => Object.assign(config, patch),
		}
		const usage = createCommandUsage(seam)
		// the rename keeps the ranking history: /resume now counts 4
		expect(usage.count("/resume")).toBe(4)
		expect(usage.counts()).toEqual({ "/resume": 4, "/help": 1 })
		usage.record("/resume")
		usage.flush()
		// the next save writes the NEW key only — no stale /sessions in the map
		expect(config[SLASH_USAGE_KEY]).toEqual({ "/resume": 5, "/help": 1 })
	})

	test("legacy and new counts never sum (new key wins the migration)", () => {
		const config: Record<string, unknown> = {
			[SLASH_USAGE_KEY]: { "/sessions": 9, "/resume": 2 },
		}
		const usage = createCommandUsage({
			configLoad: () => config,
			configSave: (patch: Record<string, unknown>) => Object.assign(config, patch),
		})
		expect(usage.count("/resume")).toBe(2)
		expect(usage.count("/sessions")).toBe(0)
		usage.flush()
	})
})
