/**
 * A3b+A8 recovery copy: the ten new keys must exist in BOTH bundled locales
 * with identical placeholder sets, and t() must interpolate count / reason
 * in each language. (The generic en/zh parity invariant is checked for every
 * key in t.test.ts; this pins the new surface explicitly.)
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { bundledLocalesDir, extractParams, loadLocales } from "../src/registry"
import { setLanguages, t } from "../src/t"

const bundledDir = bundledLocalesDir()
const KEYS = [
	"recovery.transient",
	"recovery.recovered",
	"recovery.failed.reason",
	"recovery.locked",
	"recovery.action.reconnect",
	"recovery.action.retry",
	"recovery.action.newSession",
	"recovery.action.quit",
	"recovery.command.title",
	"recovery.composer.disabled",
	"recovery.turn.interrupted",
	"recovery.input.unconfirmed",
] as const

const bundled = () => loadLocales({ bundledDir }).languages

beforeEach(() => setLanguages(bundled()))
afterEach(() => setLanguages(new Map()))

describe("recovery locale keys (en / zh-CN)", () => {
	test("every recovery key exists in both locales with matching placeholders", () => {
		const en = bundled().get("en")!
		const zh = bundled().get("zh-CN")!
		for (const key of KEYS) {
			expect(en[key], `en ${key}`).toBeDefined()
			expect(zh[key], `zh-CN ${key}`).toBeDefined()
			expect([...extractParams(zh[key]!)].sort(), `${key} params`).toEqual([...extractParams(en[key]!)].sort())
		}
		expect([...extractParams(bundled().get("en")!["recovery.recovered"]!)].sort()).toEqual(["count"])
		expect([...extractParams(bundled().get("en")!["recovery.failed.reason"]!)].sort()).toEqual(["reason"])
		expect([...extractParams(bundled().get("en")!["recovery.turn.interrupted"]!)].sort()).toEqual(["turnId"])
		expect([...extractParams(bundled().get("en")!["recovery.input.unconfirmed"]!)].sort()).toEqual([])
	})

	test("en interpolates count and reason, zh-CN keeps the same placeholders", () => {
		setLanguages(bundled(), "en")
		expect(t("recovery.recovered", { count: 5 })).toBe("Reconnected - 5 event(s) caught up")
		expect(t("recovery.failed.reason", { reason: "spawn failed" })).toBe("Recovery failed: spawn failed")
		expect(t("recovery.action.reconnect")).toContain("[R]")
		setLanguages(bundled(), "zh-CN")
		expect(t("recovery.recovered", { count: 5 })).toBe("已恢复连接，补齐 5 条事件")
		expect(t("recovery.failed.reason", { reason: "spawn failed" })).toBe("恢复连接失败：spawn failed")
		expect(t("recovery.action.reconnect")).toContain("重连 [R]")
		expect(t("recovery.composer.disabled")).toBe("正在恢复连接…")
	})

	test("the transient line paints the reconnect-in-progress reason", () => {
		setLanguages(bundled(), "zh-CN")
		expect(t("recovery.transient")).toContain("正在恢复")
		setLanguages(bundled(), "en")
		expect(t("recovery.transient")).toContain("reconnecting")
	})
})
