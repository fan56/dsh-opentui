/**
 * ENTRY WIRING CONTRACT (verification gate, 2026-11).
 *
 * The /agents incident's blind spot: command tests hand-built a
 * `SlashCommandContext`, so they passed while the REAL entry → host wire was
 * broken. This suite never hand-builds a ctx. It exercises the same typed
 * assembly the entry calls (`buildSlashDeps`) and asserts each hook is
 * carried by identity into `createSlashHost` — then spot-checks the dispatch
 * path so a hook cannot be "present but not reaching the command".
 *
 * Test names are prefixed `verify:` so CI can run exactly this class of
 * assembly gate (`bun test -t 'verify:'`) without a dsh profile.
 */
import { describe, expect, test } from "bun:test"
import { createSlashHost } from "../src/routes/session/slash-palette"
import { buildSlashDeps, carrySlashHooks, ENTRY_SLASH_HOOKS } from "../src/routes/session/slash-deps"
import { assertEntryHooks, entryHookRegion, missingEntryHooks } from "./entry-hook-region"

function makeEntryHooks() {
	const calls: string[] = []
	const hooks = {
		promptText: async (title: string) => {
			calls.push(`promptText:${title}`)
			return undefined
		},
		openBtw: (argText: string) => {
			calls.push(`openBtw:${argText}`)
		},
		themes: {
			current: () => "opentui",
			list: () => ["opentui"],
			set: (_name: string) => true,
			mode: () => ({ current: () => "auto" as const, set: () => true }),
		},
		openSearch: () => {
			calls.push("openSearch")
		},
		openPlugins: () => {
			calls.push("openPlugins")
		},
		openAgents: (name?: string) => {
			calls.push(`openAgents:${name ?? ""}`)
		},
		refreshFooter: () => {
			calls.push("refreshFooter")
		},
		invalidateFooter: () => {
			calls.push("invalidateFooter")
		},
	}
	return { hooks, calls }
}

function makeBase() {
	const lines: string[] = []
	return {
		lines,
		base: {
			// The contract test never touches the seam directly; the dispatch
			// spot-checks below only need the faces those commands gate on.
			seam: {
				agents: { list: () => [], officialCaps: async () => ({}) },
				plugins: () => [],
				btwAsk: async () => "ok",
			} as any,
			say: (text: string) => void lines.push(text),
			clear: () => {},
			reload: () => {},
			quit: () => {},
			pickOne: async () => undefined,
		},
	}
}

describe("verify: entry slash deps", () => {
	test("verify: buildSlashDeps carries every entry hook into createSlashHost deps", () => {
		const { hooks } = makeEntryHooks()
		const { base } = makeBase()
		const deps = buildSlashDeps(base, hooks)
		for (const key of ENTRY_SLASH_HOOKS) {
			expect(deps[key], `hook '${key}' missing from the assembled deps`).toBe(hooks[key])
		}
		// Core callbacks survive the assembly untouched.
		expect(deps.seam).toBe(base.seam)
		expect(deps.say).toBe(base.say)
		expect(deps.clear).toBe(base.clear)
		expect(deps.reload).toBe(base.reload)
		expect(deps.quit).toBe(base.quit)
		expect(deps.pickOne).toBe(base.pickOne)
	})

	test("verify: the deps→ctx boundary carries every hook (the second half of the bug)", () => {
		const { hooks } = makeEntryHooks()
		const { base } = makeBase()
		const deps = buildSlashDeps(base, hooks)
		const ctx = carrySlashHooks(deps)
		for (const key of ENTRY_SLASH_HOOKS) {
			expect(ctx[key], `hook '${key}' dropped at the deps→ctx boundary`).toBe(hooks[key])
		}
	})

	test("verify: the assembled deps is exactly what createSlashHost takes (no extra hop)", () => {
		const { hooks, calls } = makeEntryHooks()
		const { base } = makeBase()
		const host = createSlashHost(buildSlashDeps(base, hooks))
		// Hook consumers through the real dispatch path.
		expect(host.interceptSubmit("/search")).toBe(true)
		expect(host.interceptSubmit("/plugins")).toBe(true)
		expect(host.interceptSubmit("/agents workhorse")).toBe(true)
		expect(calls).toEqual(["openSearch", "openPlugins", "openAgents:workhorse"])
	})

	test("verify: /btw reaches the entry opener", () => {
		const { hooks, calls } = makeEntryHooks()
		const { base } = makeBase()
		const host = createSlashHost(buildSlashDeps(base, hooks))
		expect(host.interceptSubmit("/btw why is the sky blue")).toBe(true)
		expect(calls).toEqual(["openBtw:why is the sky blue"])
	})

	test("verify: v2-entry assembles its slash deps through buildSlashDeps", async () => {
		// The entry keeps @ts-nocheck (shell's untyped client classes), so this
		// source assertion is the entry-side half of the gate: it must call the
		// typed assembly instead of growing its own object literal again.
		const entry = await Bun.file(
			new URL("../examples/v2-entry.tsx", import.meta.url).pathname,
		).text()
		expect(entry).toContain("createSlashHost(buildSlashDeps(")
		// Match ONLY inside the second argument literal (`}, {` … `}`). A hook
		// that drifts back into the base literal (the /agents failure shape)
		// must fail here, not stay green because its name still occurs in the
		// file (it also occurs in local declarations and comments).
		const region = entryHookRegion(entry)
		expect(region, "entry must call buildSlashDeps(<base>, <hooks>)").not.toBeNull()
		for (const key of ENTRY_SLASH_HOOKS) {
			// shorthand (`promptText,`) or explicit (`openAgents: …`) both count
			expect(region, `entry does not pass '${key}' in buildSlashDeps's second argument`).toMatch(
				new RegExp(`(^|[\\s{,])${key}[,:]`, "m"),
			)
		}
		// Same verdict through the shared detector (message lists every gap).
		expect(() => assertEntryHooks(entry, ENTRY_SLASH_HOOKS)).not.toThrow()
	})

	test("verify: the detector rejects a hook moved into the base literal", () => {
		// Counter-example: openAgents sits in the FIRST argument while the
		// second argument carries the rest. The old whole-file regex passed
		// this; the region-scoped detector must report the missing hook.
		const source = `
			const slash = createSlashHost(buildSlashDeps({
				seam,
				say: (text: string) => void text,
				// openAgents is deliberately only here, outside the hooks literal.
				openAgents: (name?: string) => void openAgents(name),
			}, {
				promptText,
				openBtw,
				themes,
				openSearch,
				openPlugins,
				refreshFooter,
				invalidateFooter,
			}))
		`
		expect(missingEntryHooks(source, ENTRY_SLASH_HOOKS)).toEqual(["openAgents"])
		expect(() => assertEntryHooks(source, ENTRY_SLASH_HOOKS)).toThrow(/openAgents/)
	})

	test("verify: the detector reports a missing buildSlashDeps call shape", () => {
		expect(() => assertEntryHooks("createSlashHost({ seam })", ENTRY_SLASH_HOOKS)).toThrow(
			/buildSlashDeps/,
		)
	})
})
