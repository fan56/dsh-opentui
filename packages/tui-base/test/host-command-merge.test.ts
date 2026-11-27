/**
 * mergeHostCommands unit tests (027 — host-published slash commands).
 *
 * Pure table test of the palette-level merge: local rows pass through
 * untouched, host rows map to `source: "host"` rows whose `run` proxies
 * `seam.hostCommands.execute` with the RAW name + typed args, duplicate
 * names are double-listed (local keeps its name, the host twin carries the
 * i18n `command.hostSource` suffix — asserted through an injected stub `t`,
 * never a hardcoded locale string), the output is alphabetically ordered
 * with local-before-host ties, and the 100-row cap applies to HOST rows
 * only (the local registry is never truncated).
 */
import { describe, expect, test } from "bun:test"
import {
	mergeHostCommands,
	type SlashCommand,
	type SlashCommandContext,
} from "../src/routes/session/commands"
import type { SeamHostCommandRow, SessionSeam } from "../src/seams/session"

/** Stub translator: records every (key, params) call, resolves distinctive
 * stand-in strings — the tests assert the KEY was used, never a locale text. */
function stubT() {
	const calls: { key: string; params?: Record<string, unknown> }[] = []
	const t = (key: string, params?: Record<string, unknown>) => {
		calls.push({ key, params })
		if (key === "command.hostSource") return `${String(params?.name)} ‹host›`
		if (key === "command.hostExecuted") return `executed:${String(params?.name)}`
		if (key === "command.hostExecuteFailed") return `failed:${String(params?.name)}`
		return key
	}
	return { t, calls }
}

function localRow(name: string): SlashCommand {
	return { name, description: `local ${name}`, run: () => {} }
}

function hostRow(name: string, description = `host ${name}`): SeamHostCommandRow {
	return { name, description }
}

/** Minimal fake ctx: only `seam.hostCommands.execute` + `say` are touched by
 * the host row's run; everything else is a never-called stub. */
function fakeCtx(execute: (line: string) => Promise<{ text?: string } | undefined>) {
	const said: string[] = []
	const ctx = {
		seam: { hostCommands: { execute } } as unknown as SessionSeam,
		say: (text: string) => said.push(text),
		clear: () => {},
		reload: () => {},
		quit: () => {},
		pickOne: async () => undefined,
	} as unknown as SlashCommandContext
	return { ctx, said }
}

const names = (commands: readonly SlashCommand[]) => commands.map((c) => c.name)

describe("mergeHostCommands", () => {
	test("empty host list: local rows pass through unchanged (same run refs, no source marker)", () => {
		const { t, calls } = stubT()
		const a = localRow("/alpha")
		const b = localRow("/zeta")
		const merged = mergeHostCommands([a, b], [], { t })
		expect(names(merged)).toEqual(["/alpha", "/zeta"])
		expect(merged).toHaveLength(2)
		expect(merged.find((c) => c.name === "/alpha")?.run).toBe(a.run)
		expect(merged.every((c) => c.source !== "host")).toBe(true)
		expect(calls).toEqual([]) // no host row → the translator is never touched
	})

	test("host rows map to source:'host' rows with a runnable proxy", () => {
		const { t } = stubT()
		const merged = mergeHostCommands([localRow("/b")], [hostRow("/a", "plugin one")], { t })
		const host = merged.find((c) => c.name === "/a")
		expect(host).toBeDefined()
		expect(host?.source).toBe("host")
		expect(host?.description).toBe("plugin one")
		expect(typeof host?.run).toBe("function")
	})

	test("duplicate name: double-listed — local keeps its raw name, host twin gets the i18n source suffix (stub t asserts the key)", () => {
		const { t, calls } = stubT()
		const local = localRow("/help")
		const merged = mergeHostCommands([local], [hostRow("/help")], { t })
		expect(merged).toHaveLength(2)
		expect(names(merged)).toEqual(["/help", "/help ‹host›"])
		const twin = merged.find((c) => c.name === "/help ‹host›")
		expect(twin?.source).toBe("host")
		// the RAW name rides the suffix params — execute must proxy the raw form
		expect(calls).toContainEqual({ key: "command.hostSource", params: { name: "/help" } })
		// and the local row is the untouched original
		expect(merged[0]?.run).toBe(local.run)
		expect(merged[0]?.source).not.toBe("host")
	})

	test("output is alphabetically ordered; name-identical ties keep local before host", () => {
		const { t } = stubT()
		// local deliberately NOT alphabetical on input — the merge owns the order
		const merged = mergeHostCommands(
			[localRow("/zeta"), localRow("/alpha"), localRow("/dup")],
			[hostRow("/mid"), hostRow("/dup")],
			{ t },
		)
		expect(names(merged)).toEqual(["/alpha", "/dup", "/dup ‹host›", "/mid", "/zeta"])
	})

	test("host rows past 100 are capped; the local registry is never truncated (34 locals)", () => {
		const { t } = stubT()
		const locals = Array.from({ length: 34 }, (_, i) => localRow(`/l${String(i).padStart(2, "0")}`))
		const hosts = Array.from({ length: 130 }, (_, i) => hostRow(`/h${String(i).padStart(3, "0")}`))
		const merged = mergeHostCommands(locals, hosts, { t })
		expect(merged).toHaveLength(134) // 34 local + capped 100 host
		expect(merged.filter((c) => c.source === "host")).toHaveLength(100)
		expect(merged.filter((c) => c.source !== "host")).toHaveLength(34)
		// the cap keeps the FIRST 100 wire rows (h000..h099), drops the tail
		expect(merged.find((c) => c.name === "/h099")).toBeDefined()
		expect(merged.find((c) => c.name === "/h100")).toBeUndefined()
	})

	test("host run proxies the raw name + args through seam.hostCommands.execute; echo text lands in say", async () => {
		const { t } = stubT()
		const merged = mergeHostCommands([], [hostRow("/foo")], { t })
		const run = merged.find((c) => c.name === "/foo")!.run
		const lines: string[] = []
		const { ctx, said } = fakeCtx(async (line) => {
			lines.push(line)
			return { text: "host says hi" }
		})
		await run(ctx, "bar baz")
		expect(lines).toEqual(["/foo bar baz"]) // raw name + typed arguments
		expect(said).toEqual(["host says hi"]) // echoed text wins over the fallback
	})

	test("host run with empty args proxies the bare name and falls back to the executed copy (key via stub t)", async () => {
		const { t, calls } = stubT()
		const merged = mergeHostCommands([], [hostRow("/foo")], { t })
		const run = merged.find((c) => c.name === "/foo")!.run
		const { ctx, said } = fakeCtx(async () => undefined)
		await run(ctx, "")
		expect(said).toEqual(["executed:/foo"])
		expect(calls).toContainEqual({ key: "command.hostExecuted", params: { name: "/foo" } })
	})

	test("host run never rejects: a thrown round paints the failure copy (key via stub t)", async () => {
		const { t, calls } = stubT()
		const merged = mergeHostCommands([], [hostRow("/boom")], { t })
		const run = merged.find((c) => c.name === "/boom")!.run
		const { ctx, said } = fakeCtx(async () => {
			throw new Error("wire down")
		})
		await run(ctx, "") // must resolve — the palette fires run fire-and-forget
		expect(said).toEqual(["failed:/boom"])
		expect(calls).toContainEqual({ key: "command.hostExecuteFailed", params: { name: "/boom" } })
	})
})
