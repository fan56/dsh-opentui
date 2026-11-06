// The plugin Config schema (defect fix): dsh-settings SettingsForms.describe()
// only emits a settings row for a plugin entry whose runtime exports a Config
// schema (schema(entry) reads `entry.fiber.runtime.Config`; entries without
// one are filtered out of describe() entirely). Without the export the
// `dsh-opentui` namespace never existed, host-session's #refreshRoundLimits
// always resolved the disabled defaults and the F1 maxRounds hard-stop ladder
// stayed dark (e2e hard-stop scenario: 87 loop rounds, no verdict).
//
// Four layers covered here:
// 1. schema shape — the fields dsh-settings walks: schema(entry) requires a
//    `toJSON`, plainSchema re-hydrates with `new z(schema.toJSON())` and
//    volatileForm reads `type`/`dict`/`meta.volatile` off the live schema;
// 2. the F1 key names/defaults — parseSubagentRoundLimits reads
//    maxRounds/maxRoundsGrace off the `dsh-opentui` row; 0 = disabled;
// 3. resolution — `~standard` (the exact entry point cordis resolveConfig
//    calls) applies the defaults and keeps undeclared patch keys (the baked
//    `theme:` must still reach apply as a plain string). Volatile fields
//    resolve to Volatile references (plainConfig in dsh-settings calls
//    `.get()` on them — mirrored here);
// 4. describe-row feed — a mocked describe() row (value = the volatile
//    projection of the resolved config, exactly what projectForm returns)
//    flows through limitsFromSettingsRows into the SubagentRoundPolicy.
//
// Plus a source-shape guard on the entry: Config must ride ON the default
// `plugin` object (the loader unwraps `exports.default ?? exports`), not
// only as a sibling named export.
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import z from "@deepseek-ai/schemastery"
import { Config } from "../src/plugin-config.ts"
import {
	DEFAULT_SUBAGENT_ROUND_LIMITS,
	SubagentRoundPolicy,
	limitsFromSettingsRows,
} from "../src/subagent-policy.ts"

/** Mirror of dsh-settings plainConfig: detach Volatile references, recurse. */
function plain(value: unknown): unknown {
	if (value !== null && typeof value === "object" && typeof (value as { get?: unknown }).get === "function") {
		return plain((value as { get: () => unknown }).get())
	}
	if (Array.isArray(value)) return value.map(plain)
	if (value !== null && typeof value === "object") {
		return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, plain(child)]))
	}
	return value
}

const validate = Config["~standard"].validate

describe("plugin Config schema (dsh-opentui settings surface)", () => {
	test("exists and re-hydrates through dsh-settings' `new z(toJSON())` path", () => {
		expect(Config).toBeDefined()
		expect(typeof Config.toJSON).toBe("function")
		const rehydrated = new z(Config.toJSON()) as unknown as {
			type: string
			dict: Record<string, { type: string; meta?: { volatile?: boolean; default?: number } }>
		}
		expect(rehydrated.type).toBe("object")
		for (const field of ["maxRounds", "maxRoundsGrace"]) {
			expect(rehydrated.dict[field]?.type).toBe("number")
			expect(rehydrated.dict[field]?.meta?.volatile).toBe(true)
			expect(rehydrated.dict[field]?.meta?.default).toBe(0)
		}
	})

	test("defaults mirror DEFAULT_SUBAGENT_ROUND_LIMITS (0 = disabled)", () => {
		const resolved = plain(validate({}).value) as Record<string, unknown>
		expect(resolved.maxRounds).toBe(DEFAULT_SUBAGENT_ROUND_LIMITS.maxRounds)
		expect(resolved.maxRoundsGrace).toBe(DEFAULT_SUBAGENT_ROUND_LIMITS.maxRoundsGrace)
		expect(resolved.maxRounds).toBe(0)
		expect(resolved.maxRoundsGrace).toBe(0)
	})

	test("patch values resolve (scenario-62 staging: maxRounds 3 + grace 2)", () => {
		expect(plain(validate({ maxRounds: 3, maxRoundsGrace: 2 }).value)).toMatchObject({ maxRounds: 3, maxRoundsGrace: 2 })
	})

	test("undeclared patch keys survive resolution (theme stays a plain string)", () => {
		const resolved = plain(validate({ theme: "catppuccin-mocha", maxRounds: 3 }).value) as Record<string, unknown>
		expect(resolved.theme).toBe("catppuccin-mocha")
		expect(resolved.maxRounds).toBe(3)
	})

	test("a mocked describe() row feeds the F1 policy knobs", async () => {
		// describe() row value = projectForm(volatileForm(schema),
		// plainConfig(effectiveConfig)) — the volatile fields only.
		const resolved = plain(validate({ theme: "catppuccin-mocha", maxRounds: 3, maxRoundsGrace: 2 }).value) as Record<string, number>
		const row = { ns: "dsh-opentui", value: { maxRounds: resolved.maxRounds, maxRoundsGrace: resolved.maxRoundsGrace } }
		expect(limitsFromSettingsRows([row])).toEqual({ maxRounds: 3, maxRoundsGrace: 2 })

		// and the knobs actually arm the ladder (wrap-up at the cap)
		const wrapups: string[] = []
		const policy = new SubagentRoundPolicy({
			limits: () => limitsFromSettingsRows([row]),
			resolveAgentCap: () => undefined,
			isSettled: () => false,
			wrapup: (_childId, message) => {
				wrapups.push(message)
				return true
			},
			forceStop: () => true,
		})
		policy.onRoundCount("child-1", 1)
		policy.onRoundCount("child-1", 3)
		await new Promise((resolve) => setTimeout(resolve, 0))
		expect(wrapups.length).toBe(1)
		expect(wrapups[0]).toContain("Round limit reached")
	})
})

describe("plugin entry source shape (Config on the runtime object)", () => {
	const source = readFileSync(join(import.meta.dir, "..", "src", "host-entry-v2.tsx"), "utf8")

	test("Config rides ON the default plugin object (loader unwraps default ?? exports)", () => {
		expect(source).toMatch(/export const plugin = \{ name: "dsh-opentui", inject, apply, Config \}/)
	})

	test("Config is imported from the schema module", () => {
		expect(source).toMatch(/import \{ Config \} from "\.\/plugin-config\.ts"/)
	})
})
