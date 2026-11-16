/**
 * ask-replay.test.tsx — the transcript's structured ask block (spec §9, D5).
 *
 * The replay must paint the same normalized label the option list showed: a
 * settled answer whose raw pick label carries a trailing `(Recommended)` /
 * `（推荐）` token renders the bare label, never the raw suffix. The block
 * itself is a record, so no badge is painted there.
 */
import { beforeAll, describe, expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { bundledLocalesDir, loadLocales, setLanguage, setLanguages } from "@dsh-opentui/i18n"
import { AskReplayBlock } from "../src/routes/session/transcript"

beforeAll(() => {
	const { languages } = loadLocales({ bundledDir: bundledLocalesDir() })
	setLanguages(languages)
})

async function render(row: Parameters<typeof AskReplayBlock>[0]["row"]): Promise<{ frame: () => string; dispose: () => Promise<void> }> {
	const setup = await testRender(() => <AskReplayBlock row={row} />, { width: 80, height: 12, exitOnCtrlC: false })
	for (let index = 0; index < 4; index += 1) {
		await new Promise((resolve) => setTimeout(resolve, 5))
		await setup.renderOnce()
	}
	return { frame: () => setup.captureCharFrame(), dispose: () => setup.dispose() }
}

describe("ask replay block (spec §9)", () => {
	test("D5: a picked (Recommended) label paints without the raw suffix", async () => {
		const view = await render({
			key: "k",
			kind: "ask",
			entries: [
				{
					question: "Which storage backend should I use?",
					header: "Storage",
					options: [{ label: "SQLite (Recommended)" }, { label: "Postgres" }],
					selected: ["SQLite (Recommended)"],
					declined: false,
				},
			],
		})
		try {
			const painted = view.frame()
			expect(painted).toContain("→ SQLite")
			expect(painted).not.toContain("(Recommended)")
			expect(painted).toContain("Storage")
			expect(painted).toContain("✓ Which storage backend should I use?")
		} finally {
			await view.dispose()
		}
	})

	test("D5: the full-width （推荐） token is stripped too", async () => {
		setLanguage("zh-CN")
		const view = await render({
			key: "k",
			kind: "ask",
			entries: [
				{
					question: "用哪个引擎？",
					options: [{ label: "SQLite（推荐）" }],
					selected: ["SQLite（推荐）"],
					declined: false,
				},
			],
		})
		try {
			const painted = view.frame()
			expect(painted).toContain("→ SQLite")
			expect(painted).not.toContain("（推荐）")
		} finally {
			setLanguage("en")
			await view.dispose()
		}
	})

	test("a multi-select answer joins the normalized labels", async () => {
		const view = await render({
			key: "k",
			kind: "ask",
			entries: [
				{
					question: "Which features?",
					options: [{ label: "Cache" }, { label: "Retry" }],
					selected: ["Cache", "Retry"],
					declined: false,
				},
			],
		})
		try {
			expect(view.frame()).toContain("→ Cache, Retry")
		} finally {
			await view.dispose()
		}
	})
})
