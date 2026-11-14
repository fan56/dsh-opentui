/**
 * /subagents transcript viewer tests (gap C3, tui-pi subagent-viewer parity):
 * the pure helpers (list ordering, row text, scroll window, double-press arm,
 * steer/stop echoes) plus the command wiring (degrade / honest empty / hook /
 * pinned entry hook — the /agents incident law).
 */
import { describe, expect, test } from "bun:test"
import {
	doublePressArmed,
	formatViewerElapsed,
	MIN_DOUBLE_PRESS_GAP_MS,
	rowElapsedText,
	scrollTarget,
	stopAllSummary,
	steerEchoText,
	transcriptWindow,
	viewerRowText,
	viewerRows,
} from "../src/routes/session/subagents-viewer"
import { coreCommands, type SlashCommandContext } from "../src/routes/session/commands"
import { ENTRY_SLASH_HOOKS } from "../src/routes/session/slash-deps"
import { buildSlashDeps } from "../src/routes/session/slash-deps"
import type { SeamSubagentView } from "../src/seams/session"

function view(overrides: Partial<SeamSubagentView> & { id: string }): SeamSubagentView {
	return {
		label: `agent ${overrides.id}`,
		status: "running",
		rounds: 1,
		...overrides,
	}
}

describe("viewer rows", () => {
	test("running children come first, settled ones are capped at the recent slice", () => {
		const rows = viewerRows([
			view({ id: "s1", status: "completed", endedAt: 100 }),
			view({ id: "s2" }),
			view({ id: "s3", status: "failed", endedAt: 300 }),
			view({ id: "s4" }),
			view({ id: "s5", status: "cancelled", endedAt: 500 }),
			view({ id: "s6", status: "completed", endedAt: 700 }),
			view({ id: "s7", status: "completed", endedAt: 900 }),
			view({ id: "s8", status: "completed", endedAt: 800 }),
		])
		expect(rows.map((row) => row.status === "running")).toEqual([true, true, false, false, false, false, false])
		// Seven settled rows entered (s1…s8 minus the two running); the five
		// most RECENTLY ended survive — s1 (endedAt 100) drops, not s8.
		expect(rows.map((row) => row.id)).toEqual(["s2", "s4", "s7", "s8", "s6", "s5", "s3"])
	})

	test("P1-5: settled rows sort by endedAt descending before the cap (recent, not oldest)", () => {
		// The seam's views() ride a spawn-order Map — the old plain slice
		// surfaced the five OLDEST ended children once the cap engaged.
		const rows = viewerRows([
			view({ id: "old-1", status: "completed", endedAt: 1_000 }),
			view({ id: "old-2", status: "completed", endedAt: 2_000 }),
			view({ id: "old-3", status: "completed", endedAt: 3_000 }),
			view({ id: "old-4", status: "completed", endedAt: 4_000 }),
			view({ id: "old-5", status: "completed", endedAt: 5_000 }),
			view({ id: "fresh", status: "completed", endedAt: 9_000 }),
		])
		const settled = rows.filter((row) => row.status !== "running").map((row) => row.id)
		expect(settled).toEqual(["fresh", "old-5", "old-4", "old-3", "old-2"])
	})

	test("rows without endedAt (legacy producers) lose to dated rows and keep their relative order", () => {
		const rows = viewerRows([
			view({ id: "a", status: "completed" }),
			view({ id: "b", status: "failed", endedAt: 5 }),
			view({ id: "c", status: "completed" }),
		])
		expect(rows.map((row) => row.id)).toEqual(["b", "a", "c"])
	})

	test("an empty roster stays empty (the viewer renders the honest fallback)", () => {
		expect(viewerRows([])).toEqual([])
	})
})

describe("viewer row text", () => {
	test("a running row reads glyph · label · rounds · elapsed · model", () => {
		const text = viewerRowText(view({ id: "s1", label: "workhorse", rounds: 3, model: "glm-5.3" }), 10, "12.0s")
		expect(text).toContain("⠋ Workhorse")
		expect(text).toContain("rounds 3/10")
		expect(text).toContain("12.0s")
		expect(text).toContain("glm-5.3")
	})

	test("the F6 marker suffix rides the row (⚡ injected / ⏻ hard-stopped)", () => {
		const text = viewerRowText(view({ id: "s1", injectedRound: 4, hardStopRound: 6 }), 0, undefined)
		expect(text).toContain("⏻ hard-stopped @6")
		expect(text).toContain("⚡ injected")
	})

	test("a settled row carries its outcome glyph", () => {
		expect(viewerRowText(view({ id: "s1", status: "completed" }), undefined, undefined)).toContain("✓")
		expect(viewerRowText(view({ id: "s1", status: "failed" }), undefined, undefined)).toContain("✗")
		expect(viewerRowText(view({ id: "s1", status: "cancelled" }), undefined, undefined)).toContain("—")
	})
})

describe("elapsed text", () => {
	test("formatViewerElapsed: seconds under a minute, m+s above", () => {
		expect(formatViewerElapsed(42_100)).toBe("42.1s")
		expect(formatViewerElapsed(192_000)).toBe("3m12s")
	})

	test("running rows tick off startedAt; settled rows read the frozen elapsedSec", () => {
		const now = 1_000_000
		expect(rowElapsedText(view({ id: "s1", startedAt: now - 5_000 }), now)).toBe("5.0s")
		expect(rowElapsedText(view({ id: "s2", status: "completed", elapsedSec: 9.5 }), now)).toBe("9.5s")
		// Absent facts render nothing — never a guess.
		expect(rowElapsedText(view({ id: "s3" }), now)).toBeUndefined()
	})
})

describe("transcript scroll window", () => {
	test("pinned to the tail when the offset saturates (follow), clamped when detached", () => {
		const tail = transcriptWindow(100, Number.MAX_SAFE_INTEGER, 14)
		expect(tail.start).toBe(86)
		expect(tail.end).toBe(100)
		expect(tail.follow).toBe(true)

		const detached = transcriptWindow(100, 20, 14)
		expect(detached.start).toBe(20)
		expect(detached.follow).toBe(false)

		// Reaching the bottom re-attaches.
		const bottom = transcriptWindow(100, 86, 14)
		expect(bottom.follow).toBe(true)
	})

	test("a short log never scrolls", () => {
		expect(transcriptWindow(5, 0, 14)).toEqual({ start: 0, end: 5, follow: true })
	})
})

describe("scroll detach (P1-3)", () => {
	test("scroll-up from the tail DETACHES (the follow offset rebases before stepping)", () => {
		// openTranscript pins the tail with MAX_SAFE_INTEGER; a bare offset+delta
		// re-clamped to maxScroll forever and made ↑/k a visual no-op.
		expect(scrollTarget(-1, Number.MAX_SAFE_INTEGER, 100, 14)).toBe(85)
		// 85 < maxScroll(86): the window now reports detached.
		expect(transcriptWindow(100, 85, 14).follow).toBe(false)
	})

	test("scrolled-up rows keep shifting with repeated presses and never go under zero", () => {
		expect(scrollTarget(-1, 85, 100, 14)).toBe(84)
		expect(scrollTarget(-100, 84, 100, 14)).toBe(0)
		expect(scrollTarget(-1, 0, 100, 14)).toBe(0)
	})

	test("scrolling back to the bottom re-follows (and survives new tail lines)", () => {
		// Re-attach at the current bottom...
		expect(scrollTarget(1, 85, 100, 14)).toBe(86)
		expect(transcriptWindow(100, 86, 14).follow).toBe(true)
		// ...when new lines landed while detached the offset stays put and the
		// window reports still-detached — stepping down re-follows at the NEW
		// bottom (the saturating offset clamps onto the grown window).
		expect(scrollTarget(1, 85, 120, 14)).toBe(86)
		expect(transcriptWindow(120, 86, 14).follow).toBe(false)
		expect(scrollTarget(100, 86, 120, 14)).toBe(106)
		expect(transcriptWindow(120, 106, 14).follow).toBe(true)
	})
})

describe("steer / stop echoes", () => {
	test("steerEchoText mirrors the picker's e2e-asserted shapes", () => {
		expect(steerEchoText(true, "workhorse")).toBe("steered workhorse")
		expect(steerEchoText(false, "workhorse")).toBe("steer rejected — Workhorse is not running")
	})

	test("stopAllSummary counts one vs many", () => {
		expect(stopAllSummary(1)).toBe("stop requested — 1 subagent")
		expect(stopAllSummary(3)).toBe("stop requested — 3 subagents")
	})

	test("doublePressArmed: a deliberate second press within the window acts", () => {
		expect(doublePressArmed(0, 500)).toBe(false)
		expect(doublePressArmed(100, 100 + 599)).toBe(true)
		expect(doublePressArmed(100, 100 + 700)).toBe(false)
	})

	test("P1-4: a held key's auto-repeat never completes the double press (min-gap floor)", () => {
		// Terminal auto-repeat fires ~30-50ms apart; the interrupt is
		// irreversible, so the arm requires a human-paced gap too.
		expect(MIN_DOUBLE_PRESS_GAP_MS).toBe(80)
		expect(doublePressArmed(100, 100 + 49)).toBe(false) // auto-repeat pace
		expect(doublePressArmed(100, 100 + MIN_DOUBLE_PRESS_GAP_MS - 1)).toBe(false)
		expect(doublePressArmed(100, 100 + MIN_DOUBLE_PRESS_GAP_MS)).toBe(true)
	})
})

describe("/subagents command wiring", () => {
	function makeCtx(seamViews: SeamSubagentView[] | undefined): SlashCommandContext & {
		lines: string[]
		opened: { count: number }
	} {
		const lines: string[] = []
		const opened = { count: 0 }
		const ctx: SlashCommandContext & { lines: string[]; opened: { count: number } } = {
			say: (text) => lines.push(text),
			clear: () => {},
			reload: () => {},
			quit: () => {},
			pickOne: async () => undefined,
			seam: {
				subagentViews: seamViews === undefined ? undefined : () => seamViews,
			} as SlashCommandContext["seam"],
			openSubagents: () => {
				opened.count++
			},
			lines,
			opened,
		}
		return ctx
	}

	test("/subagents without the hook degrades to the notice", async () => {
		const lines: string[] = []
		const ctx = {
			say: (text: string) => lines.push(text),
			clear: () => {},
			reload: () => {},
			quit: () => {},
			pickOne: async () => undefined,
			seam: {} as SlashCommandContext["seam"],
		}
		await coreCommands().find((c) => c.name === "/subagents")!.run(ctx, "")
		expect(lines).toEqual(["/subagents: the transcript viewer is not mounted in this entry"])
	})

	test("/subagents with no subagents answers honestly and opens nothing", async () => {
		const ctx = makeCtx([])
		await coreCommands().find((c) => c.name === "/subagents")!.run(ctx, "")
		expect(ctx.opened.count).toBe(0)
		expect(ctx.lines).toEqual(["no subagents in this session — spawn one and run /subagents again"])
	})

	test("/subagents with live subagents opens the viewer", async () => {
		const ctx = makeCtx([view({ id: "child-1" })])
		await coreCommands().find((c) => c.name === "/subagents")!.run(ctx, "")
		expect(ctx.opened.count).toBe(1)
		expect(ctx.lines).toEqual([])
	})

	test("openSubagents is a pinned entry hook (the /agents incident law)", () => {
		expect(ENTRY_SLASH_HOOKS).toContain("openSubagents")
		const deps = buildSlashDeps(
			{
				say: () => {},
				clear: () => {},
				reload: () => {},
				quit: () => {},
				pickOne: async () => undefined,
			},
			{
				promptText: async () => undefined,
				openBtw: () => {},
				themes: undefined as never,
				openSearch: () => {},
				openPlugins: () => {},
				openSkills: () => {},
				openAgents: () => {},
				openSettings: () => {},
				openHistory: () => {},
				openSubagents: () => {},
				refreshFooter: () => {},
				invalidateFooter: () => {},
				flushQueue: () => ({ kind: "empty", started: 0, remaining: 0 }),
			},
		)
		expect(typeof deps.openSubagents).toBe("function")
	})
})
