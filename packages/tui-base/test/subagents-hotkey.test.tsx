/**
 * Ctrl+G entry for the live subagents panel — the keybind handover, the keymap
 * dispatch path (a typed `/subagents` command), the v2 wiring and the hint i18n.
 *
 * The panel itself is owned by the slash command host (`/subagents` →
 * `openSubagents`), so the key layer must only dispatch the command. These
 * tests pin that contract without importing the viewer internals.
 */
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { bundledLocalesDir, loadLocales, setLanguage, setLanguages } from "@dsh-opentui/i18n"
import { createBindingLookup } from "@opentui/keymap/extras"
import { testRender } from "@opentui/solid"
import { TuiKeybind } from "../src/config/keybind"
import * as V1 from "../src/config/v1/keybind"
import { Keymap } from "../src/context/keymap"
import { DEFAULT_FOOTER_HINTS, HintsLine, setFooterHints, setHintsShown } from "../src/routes/session/hints-line"

const legs = (value: unknown): string[] => String(value).split(",").map((leg) => leg.trim())

describe("keybind: ctrl+g belongs to the subagents panel in both definitions", () => {
	test("v2 binds session.subagents to ctrl+g and moves session.first to the free ctrl+home leg", () => {
		const defs = TuiKeybind.Definitions
		expect(legs(defs["session.subagents"].default)).toEqual(["ctrl+g"])
		expect(legs(defs["session.first"].default)).toEqual(["ctrl+home", "home", "alt+home"])

		const all = Object.values(defs).flatMap((def) => legs(def.default))
		// ctrl+g freed by session.first is now claimed exactly once; ctrl+home
		// was free in the full table before this handover (verified by exhaust).
		expect(all.filter((leg) => leg === "ctrl+g")).toHaveLength(1)
		expect(all.filter((leg) => leg === "ctrl+home")).toHaveLength(1)
	})

	test("vendored v1 definition mirrors the handover", () => {
		const defs = V1.Definitions
		expect(legs(defs.subagents.default)).toEqual(["ctrl+g"])
		expect(legs(defs.messages_first.default)).toEqual(["ctrl+home", "home", "alt+home"])
		expect(V1.CommandMap.subagents).toBe("session.subagents")
	})
})

describe("keymap: ctrl+g dispatches the /subagents command", () => {
	test("the bound stroke reaches the session.subagents command", async () => {
		const dispatched: string[] = []
		function Probe() {
			Keymap.createLayer(() => ({
				commands: [
					{
						id: "session.subagents",
						title: "Subagents activity panel",
						run: () => {
							dispatched.push("/subagents")
						},
					},
				],
			}))
			return <box width={1} height={1} />
		}
		const setup = await testRender(
			() => (
				<Keymap.Provider
					config={{
						keybinds: createBindingLookup(TuiKeybind.toBindingConfig(TuiKeybind.parse({})), {
							bindingDefaults: TuiKeybind.bindingDefaults(),
						}),
					}}
				>
					<Probe />
				</Keymap.Provider>
			),
			{ width: 40, height: 10, useMouse: false },
		)
		try {
			setup.mockInput.pressKey("g", { ctrl: true })
			await Bun.sleep(60)
			await setup.renderOnce()
			expect(dispatched).toContain("/subagents")
		} finally {
			await setup.dispose()
		}
	})

	test("v2-entry routes the key layer through the slash host, not viewer internals", () => {
		const source = readFileSync(join(import.meta.dir, "..", "examples", "v2-entry.tsx"), "utf8")
		expect(source).toMatch(/Keymap\.createLayer\(\(\) => \(\{/)
		expect(source).toMatch(/id: "session\.subagents"/)
		expect(source).toMatch(/run: \(\) => slash\.interceptSubmit\("\/subagents"\)/)
		// The command host owns the mount bridge; the key layer must not couple
		// to the viewer's internals (the other agent owns that file).
		const layer = source.slice(source.indexOf("Keymap.createLayer"), source.indexOf("const overlayHost"))
		expect(layer).not.toContain("openSubagentsViewer")
		// No running-agent gate: the hint advertises the panel unconditionally.
		expect(layer).not.toMatch(/subagentViews/)
	})
})

describe("i18n: the new hint label is present in both bundled locales", () => {
	const base = join(import.meta.dir, "..", "..", "i18n", "locales")
	const en = JSON.parse(readFileSync(join(base, "en.json"), "utf8")) as Record<string, string>
	const zh = JSON.parse(readFileSync(join(base, "zh-CN.json"), "utf8")) as Record<string, string>
	const KEY = "footer.hint.subagentPanel"

	test("both locales carry the key with the same (empty) parameter set", () => {
		expect(en[KEY]).toBe("ctrl+g subagents panel")
		expect(zh[KEY]).toBe("ctrl+g 子代理活动面板")
		const params = (value: string) => [...value.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]).sort()
		expect(params(en[KEY]!)).toEqual(params(zh[KEY]!))
	})
})

describe("rendered hint row (frame capture)", () => {
	test("the idle row advertises the ctrl+g subagents panel", async () => {
		const { languages } = loadLocales({ bundledDir: bundledLocalesDir() })
		setLanguages(languages, "en")
		setLanguage("en")
		setFooterHints({ ...DEFAULT_FOOTER_HINTS })
		// /hints tests in other files toggle this module signal; a captured
		// frame needs the row actually shown, not just the segments enabled.
		setHintsShown(true)
		const setup = await testRender(() => <HintsLine busy={false} />, { width: 160, height: 4, useMouse: false })
		try {
			await setup.renderOnce()
			const frame = setup.captureCharFrame()
			const line = frame.split("\n").find((row) => row.includes("ctrl+g"))?.trimEnd() ?? ""
			// Captured frame row (width 160 keeps the whole bar). Bun runs test
			// files in parallel and other files flip the shared registry language,
			// so accept either bundled wording of the new segment here.
			console.log(`[hint-frame] ${line}`)
			expect(line).toMatch(/ctrl\+g (subagents panel|子代理活动面板)/)
		} finally {
			await setup.dispose()
		}
	})

	for (const [lang, labels] of [
		["en", { send: "enter send", panel: "ctrl+g subagents panel", quit: "ctrl+c ×2 quit" }],
		["zh-CN", { send: "enter 发送", panel: "ctrl+g 子代理活动面板", quit: "ctrl+c ×2 退出" }],
	] as const) {
		test(`the 80-column row keeps ctrl+g beside the core keys (${lang})`, async () => {
			const { languages } = loadLocales({ bundledDir: bundledLocalesDir() })
			setLanguages(languages, lang)
			setLanguage(lang)
			setFooterHints({ ...DEFAULT_FOOTER_HINTS })
			// /hints tests in other files toggle this module signal; a captured
			// frame needs the row actually shown, not just the segments enabled.
			setHintsShown(true)
			const setup = await testRender(() => <HintsLine busy={false} />, { width: 80, height: 4, useMouse: false })
			try {
				await setup.renderOnce()
				const frame = setup.captureCharFrame()
				const line = frame.split("\n").find((row) => row.includes("⌨"))?.trimEnd() ?? ""
				// subagentPanel is core-adjacent: the panel key survives an
				// 80-column bar alongside send and quit in both languages.
				// Whole-segment folding drops the widest optional label first
				// (newline) and never mid-cuts a segment or emits an ellipsis.
				console.log(`[hint-frame-80-${lang}] ${line}`)
				expect(line).toContain(labels.send)
				expect(line).toContain(labels.panel)
				expect(line).toContain(labels.quit)
				expect(line).not.toContain("alt+enter")
				expect(line).not.toContain("ctrl+shift+f")
				expect(line).not.toContain("pgup/pgdn")
				expect(line).not.toContain("…")
			} finally {
				await setup.dispose()
			}
		})
	}
})
