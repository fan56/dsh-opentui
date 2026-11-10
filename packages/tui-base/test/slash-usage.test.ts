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
		expect(usage.count("/help")).toBe(1)
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
})
