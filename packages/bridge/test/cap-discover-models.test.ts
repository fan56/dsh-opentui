/**
 * 025-w3-2 — wire-side whitelist for the one PROJECTED_BY_HAND id.
 * The generic arm's E5 SENTINEL stays in cap-generic-arm.test.ts; this tests
 * the dedicated hand-wired branch's projector (no credential crosses).
 */
import { describe, expect, test } from "bun:test"
import { projectDiscoverModelsForWire } from "../src/cap-discover-models.ts"

const SENTINEL = "W3B_SENTINEL_no_real_credential"

describe("W3-2 discoverModels wire whitelist", () => {
	test("only the five rendered fields cross; additionalProperties keys dropped", () => {
		const out = projectDiscoverModelsForWire([
			{
				id: "m1", name: "One", contextWindow: 128000, maxTokens: 8192,
				inputModalities: ["text", "image"], apiKey: SENTINEL, baseURL: "https://secret", token: SENTINEL,
			},
		])
		expect(out).toEqual([{ id: "m1", name: "One", contextWindow: 128000, maxTokens: 8192, inputModalities: ["text", "image"] }])
		const text = JSON.stringify(out)
		expect(text).not.toContain(SENTINEL)
		expect(text).not.toContain("https://secret")
	})

	test("accepts the { value: [...] } wire wrap; rejects non-array / no-id rows", () => {
		expect(projectDiscoverModelsForWire({ value: [{ id: "m" }] })).toEqual([{ id: "m" }])
		expect(projectDiscoverModelsForWire({ nope: 1 })).toEqual([])
		expect(projectDiscoverModelsForWire([{ name: "no id" }, { id: "" }, { id: "ok" }])).toEqual([{ id: "ok" }])
	})

	test("hostile modality values and absurd numbers are dropped/capped", () => {
		const out = projectDiscoverModelsForWire([
			{ id: "m", inputModalities: ["voice", "text", "image", "other", "text"], contextWindow: -1, maxTokens: 1e12 },
		])
		expect(out[0]!.inputModalities).toEqual(["text", "image", "text"])
		expect(out[0]!.contextWindow).toBeUndefined()
		expect(out[0]!.maxTokens).toBe(10_000_000)
	})
})
