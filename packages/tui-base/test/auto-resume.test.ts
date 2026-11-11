/**
 * Auto-resume startup decision tests (feat/auto-resume).
 *
 * Coverage mirrors the acceptance list: the N-day window (inclusive edge,
 * expiry, configurable), empty/blank sessions, the OFF-BY-DEFAULT policy (a
 * plain launch starts a new session), the explicit `autoResume: "last"` /
 * `--resume-last` opt-ins, `--new`, explicit `--session`, workspace scoping,
 * failure degradation (a rejected/timed-out list or a throwing resume degrades
 * to a fresh session with one warning), and no interference with an explicit
 * resume.
 */
import { describe, expect, test } from "bun:test"
import {
	AUTO_RESUME_LIST_LIMIT,
	DEFAULT_AUTO_RESUME_DAYS,
	autoResumeLine,
	parseLaunchArgs,
	readAutoResumeDays,
	readAutoResumeMode,
	resolveAutoResumeMode,
	runAutoResume,
	selectAutoResumeSession,
	type AutoResumeRow,
	type LaunchArgs,
} from "../src/routes/session/auto-resume"

const NOW = Date.parse("2026-11-10T12:00:00Z")
const HOUR = 3_600_000
const DAY = 86_400_000
const WS = "/repo/alpha"

const row = (over: Partial<AutoResumeRow> = {}): AutoResumeRow => ({
	id: "s1",
	title: "first prompt",
	cwd: WS,
	updatedAt: String(NOW - HOUR),
	blank: false,
	...over,
})

const pick = (rows: readonly AutoResumeRow[], over: { windowDays?: number; mode?: "last" | "off"; workspace?: string; newRequested?: boolean; sessionId?: string } = {}) =>
	selectAutoResumeSession(rows, {
		workspace: over.workspace ?? WS,
		mode: over.mode ?? "last",
		windowDays: over.windowDays,
		now: NOW,
		newRequested: over.newRequested,
		sessionId: over.sessionId,
	})

describe("config readers", () => {
	test("autoResume defaults to off; only the literal last enables a restore", () => {
		expect(readAutoResumeMode(undefined)).toBe("off")
		expect(readAutoResumeMode({})).toBe("off")
		expect(readAutoResumeMode({ autoResume: "off" })).toBe("off")
		expect(readAutoResumeMode({ autoResume: "last" })).toBe("last")
		expect(readAutoResumeMode({ autoResume: "banana" })).toBe("off")
	})
	test("autoResumeDays defaults to 7; non-positive/garbage keeps the default", () => {
		expect(DEFAULT_AUTO_RESUME_DAYS).toBe(7)
		expect(readAutoResumeDays(undefined)).toBe(7)
		expect(readAutoResumeDays({ autoResumeDays: 30 })).toBe(30)
		expect(readAutoResumeDays({ autoResumeDays: "14" })).toBe(14)
		expect(readAutoResumeDays({ autoResumeDays: 0 })).toBe(7)
		expect(readAutoResumeDays({ autoResumeDays: -3 })).toBe(7)
		expect(readAutoResumeDays({ autoResumeDays: "soon" })).toBe(7)
	})
})

describe("parseLaunchArgs", () => {
	const blank: LaunchArgs = { newRequested: false, resumeLastRequested: false }
	test("--new, --resume-last and --session in both spellings", () => {
		expect(parseLaunchArgs([])).toEqual(blank)
		expect(parseLaunchArgs(["--new"])).toEqual({ newRequested: true, resumeLastRequested: false })
		expect(parseLaunchArgs(["--resume-last"])).toEqual({ newRequested: false, resumeLastRequested: true })
		expect(parseLaunchArgs(["--session", "abc"])).toEqual({ newRequested: false, resumeLastRequested: false, sessionId: "abc" })
		expect(parseLaunchArgs(["--session=abc"])).toEqual({ newRequested: false, resumeLastRequested: false, sessionId: "abc" })
		expect(parseLaunchArgs(["--new", "--session", "abc", "--resume-last"])).toEqual({
			newRequested: true,
			resumeLastRequested: true,
			sessionId: "abc",
		})
	})
	test("provisioning flags and a valueless --session are ignored", () => {
		expect(parseLaunchArgs(["--model", "zai/x", "--plugins=none", "--dry-run"])).toEqual(blank)
		expect(parseLaunchArgs(["--session"])).toEqual(blank)
		expect(parseLaunchArgs(["--session", "--new"])).toEqual({ newRequested: true, resumeLastRequested: false })
	})
})

describe("resolveAutoResumeMode: opt-in priority", () => {
	const launch = (over: Partial<LaunchArgs> = {}): LaunchArgs => ({
		newRequested: false,
		resumeLastRequested: false,
		...over,
	})
	test("a plain launch defaults to off (new session)", () => {
		expect(resolveAutoResumeMode({}, launch())).toBe("off")
		expect(resolveAutoResumeMode(undefined, launch())).toBe("off")
	})
	test("an explicit autoResume: last restores; off/garbage stays off", () => {
		expect(resolveAutoResumeMode({ autoResume: "last" }, launch())).toBe("last")
		expect(resolveAutoResumeMode({ autoResume: "off" }, launch())).toBe("off")
		expect(resolveAutoResumeMode({ autoResume: "banana" }, launch())).toBe("off")
	})
	test("--resume-last overrides the stored config", () => {
		expect(resolveAutoResumeMode({ autoResume: "off" }, launch({ resumeLastRequested: true }))).toBe("last")
		expect(resolveAutoResumeMode({}, launch({ resumeLastRequested: true }))).toBe("last")
	})
	test("--new wins over --resume-last and the config", () => {
		expect(resolveAutoResumeMode({ autoResume: "last" }, launch({ newRequested: true }))).toBe("off")
		expect(
			resolveAutoResumeMode({ autoResume: "last" }, launch({ newRequested: true, resumeLastRequested: true })),
		).toBe("off")
	})
	test("an explicit --session wins over --resume-last and the config", () => {
		expect(
			resolveAutoResumeMode({ autoResume: "last" }, launch({ resumeLastRequested: true, sessionId: "abc" })),
		).toBe("off")
	})
})

describe("selectAutoResumeSession: window", () => {
	test("picks the newest in-window session, regardless of input order", () => {
		const rows = [row({ id: "old", updatedAt: String(NOW - 3 * DAY) }), row({ id: "newest", updatedAt: String(NOW - HOUR) })]
		expect(pick(rows)?.id).toBe("newest")
	})
	test("expired activity is excluded; the 7-day edge is inclusive", () => {
		expect(pick([row({ id: "expired", updatedAt: String(NOW - 8 * DAY) })])).toBeUndefined()
		expect(pick([row({ id: "edge", updatedAt: String(NOW - 7 * DAY) })])?.id).toBe("edge")
		expect(pick([row({ id: "just-in", updatedAt: String(NOW - 7 * DAY + 1) })])?.id).toBe("just-in")
	})
	test("the window is configurable (autoResumeDays)", () => {
		const rows = [row({ id: "ten-days", updatedAt: String(NOW - 10 * DAY) })]
		expect(pick(rows)).toBeUndefined()
		expect(pick(rows, { windowDays: 30 })?.id).toBe("ten-days")
	})
	test("unknown / unparseable timestamps cannot prove activity and are skipped", () => {
		expect(pick([row({ updatedAt: undefined })])).toBeUndefined()
		expect(pick([row({ updatedAt: "" })])).toBeUndefined()
		expect(pick([row({ updatedAt: "not-a-date" })])).toBeUndefined()
	})
	test("ISO timestamps parse the same as the ms-epoch wire spelling", () => {
		expect(pick([row({ updatedAt: "2026-11-10T11:00:00Z" })])?.id).toBe("s1")
	})
})

describe("selectAutoResumeSession: emptiness", () => {
	test("the host blank flag wins", () => {
		expect(pick([row({ blank: true })])).toBeUndefined()
		expect(pick([row({ blank: false, title: "" })])?.id).toBe("s1")
	})
	test("older hosts without blank fall back to title/size", () => {
		expect(pick([row({ blank: undefined, title: "", sizeBytes: 0 })])).toBeUndefined()
		expect(pick([row({ blank: undefined, title: "  " })])).toBeUndefined()
		expect(pick([row({ blank: undefined, title: "hello" })])?.id).toBe("s1")
		expect(pick([row({ blank: undefined, title: "", sizeBytes: 2048 })])?.id).toBe("s1")
	})
})

describe("selectAutoResumeSession: explicit intent and workspace scope", () => {
	test("autoResume off never restores", () => {
		expect(pick([row()], { mode: "off" })).toBeUndefined()
	})
	test("--new never restores", () => {
		expect(pick([row()], { newRequested: true })).toBeUndefined()
	})
	test("an explicit --session is left alone (no auto-resume conflict)", () => {
		expect(pick([row()], { sessionId: "explicit" })).toBeUndefined()
	})
	test("only THIS workspace is considered; unknown cwd is not attributable", () => {
		expect(pick([row({ id: "other", cwd: "/repo/beta" })])).toBeUndefined()
		expect(pick([row({ id: "no-cwd", cwd: undefined })])).toBeUndefined()
		const rows = [row({ id: "other", cwd: "/repo/beta", updatedAt: String(NOW - HOUR) }), row({ id: "mine", updatedAt: String(NOW - DAY) })]
		expect(pick(rows)?.id).toBe("mine")
	})
})

describe("autoResumeLine", () => {
	test("reads `resumed <title> · <time ago>` and collapses whitespace", () => {
		expect(autoResumeLine(row({ title: "fix  the\ncomposer" }), NOW)).toBe("resumed fix the composer · 1h ago")
		expect(autoResumeLine(row({ title: "", id: "abcdef12-3456" }), NOW)).toBe("resumed abcdef12 · 1h ago")
	})
})

describe("runAutoResume", () => {
	const launch = (over: Partial<LaunchArgs> = {}): LaunchArgs => ({
		newRequested: false,
		resumeLastRequested: false,
		...over,
	})
	const decision = (deps: {
		config?: Record<string, unknown> | undefined | null
		launch?: LaunchArgs
		listSessions?: (limit?: number) => Promise<readonly AutoResumeRow[]>
		resumeSession?: (id: string) => unknown
		warnings?: string[]
		timeoutMs?: number
	}) => {
		// The helper defaults to the opt-in config; an explicit `config` key
		// (including `undefined`) must reach runAutoResume untouched.
		const config = "config" in deps ? deps.config : { autoResume: "last" }
		return runAutoResume(
			{ config, launch: deps.launch ?? launch(), workspace: WS },
			{
				listSessions: deps.listSessions ?? (async () => [row()]),
				resumeSession: deps.resumeSession ?? (() => "ok"),
				warn: (message) => deps.warnings?.push(message),
				now: () => NOW,
				...(deps.timeoutMs !== undefined ? { timeoutMs: deps.timeoutMs } : {}),
			},
		)
	}

	test("lists with the wider limit, stages the picked id and returns the notice", async () => {
		let asked: number | undefined
		let resumed: string | undefined
		const got = await decision({
			listSessions: async (limit) => {
				asked = limit
				return [row({ id: "picked" })]
			},
			resumeSession: (id) => {
				resumed = id
				return "ok"
			},
		})
		expect(asked).toBe(AUTO_RESUME_LIST_LIMIT)
		expect(resumed).toBe("picked")
		expect(got?.id).toBe("picked")
		expect(got?.line).toBe("resumed first prompt · 1h ago")
	})

	test("the default config starts a fresh session (no list, no stage, no notice)", async () => {
		let listed = 0
		let resumed = 0
		for (const config of [undefined, {}, { autoResume: "off" }]) {
			const got = await decision({
				config,
				listSessions: async () => {
					listed++
					return [row()]
				},
				resumeSession: () => {
					resumed++
				},
			})
			expect(got).toBeUndefined()
		}
		expect(listed).toBe(0)
		expect(resumed).toBe(0)
	})

	test("--resume-last restores even when the config says off", async () => {
		let resumed: string | undefined
		const got = await decision({
			config: { autoResume: "off" },
			launch: launch({ resumeLastRequested: true }),
			resumeSession: (id) => {
				resumed = id
				return "ok"
			},
		})
		expect(resumed).toBe("s1")
		expect(got?.line).toBe("resumed first prompt · 1h ago")
	})

	test("nothing worth restoring leaves the boot alone (no resume call)", async () => {
		let resumed = 0
		const got = await decision({
			listSessions: async () => [row({ blank: true })],
			resumeSession: () => {
				resumed++
			},
		})
		expect(got).toBeUndefined()
		expect(resumed).toBe(0)
	})

	test("a rejected list degrades with one warning", async () => {
		const warnings: string[] = []
		const got = await decision({ listSessions: async () => { throw new Error("rpc down") }, warnings })
		expect(got).toBeUndefined()
		expect(warnings).toHaveLength(1)
		expect(warnings[0]).toContain("auto-resume skipped")
		expect(warnings[0]).toContain("rpc down")
	})

	test("a hung list is bounded by the timeout and degrades", async () => {
		const warnings: string[] = []
		const got = await decision({ listSessions: () => new Promise(() => {}), warnings, timeoutMs: 20 })
		expect(got).toBeUndefined()
		expect(warnings).toHaveLength(1)
		expect(warnings[0]).toContain("20ms")
	})

	test("a throwing resume degrades with one warning", async () => {
		const warnings: string[] = []
		const got = await decision({ resumeSession: () => { throw new Error("writer held") }, warnings })
		expect(got).toBeUndefined()
		expect(warnings).toHaveLength(1)
		expect(warnings[0]).toContain("writer held")
	})

	test("off / --new / --session skip the list call entirely", async () => {
		let calls = 0
		const listSessions = async () => {
			calls++
			return [row()]
		}
		const deps = { listSessions, resumeSession: () => "ok" }
		expect(
			await runAutoResume({ config: { autoResume: "off" }, launch: launch(), workspace: WS }, deps),
		).toBeUndefined()
		expect(
			await runAutoResume(
				{ config: { autoResume: "last" }, launch: launch({ newRequested: true }), workspace: WS },
				deps,
			),
		).toBeUndefined()
		expect(
			await runAutoResume(
				{ config: {}, launch: launch({ newRequested: true, resumeLastRequested: true }), workspace: WS },
				deps,
			),
		).toBeUndefined()
		expect(
			await runAutoResume(
				{ config: { autoResume: "last" }, launch: launch({ sessionId: "abc" }), workspace: WS },
				deps,
			),
		).toBeUndefined()
		expect(calls).toBe(0)
	})

	test("autoResumeDays from the config widens the window", async () => {
		const got = await runAutoResume(
			{ config: { autoResume: "last", autoResumeDays: 30 }, launch: launch(), workspace: WS },
			{ listSessions: async () => [row({ updatedAt: String(NOW - 20 * DAY) })], resumeSession: () => "ok", now: () => NOW },
		)
		expect(got?.id).toBe("s1")
	})
})
