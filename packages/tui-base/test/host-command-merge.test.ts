/**
 * mergeHostCommands unit tests (027 — host-published slash commands).
 *
 * Pure table test of the palette-level merge: local rows pass through
 * untouched, host rows map to `source: "host"` rows whose `run` proxies
 * `seam.hostCommands.execute` with the GESTURE name + typed args. Wire
 * names arrive BARE (dsh CommandDescriptor omits the slash) and are
 * normalized to the palette's slash form (`/name`) at the merge — the
 * normalized name is THE identity for filtering (`filterCommands` is
 * `/`-anchored), exact dispatch and Tab completion. Duplicate names are
 * double-listed under the SAME name (local first): the host twin marks its
 * origin through the render-only `displayName` (the i18n
 * `command.hostSource` suffix — asserted through an injected stub `t`,
 * never a hardcoded locale string), so the suffix never pollutes the
 * match key. Output is alphabetically ordered with local-before-host
 * ties, and the 100-row cap applies to HOST rows only (the local registry
 * is never truncated).
 */
import { describe, expect, test } from "bun:test"
import {
	dispatchLine,
	filterCommands,
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

	test("duplicate name: double-listed under the SAME gesture name — the host twin carries the i18n source suffix in displayName (stub t asserts the key)", () => {
		const { t, calls } = stubT()
		const local = localRow("/help")
		const merged = mergeHostCommands([local], [hostRow("/help")], { t })
		expect(merged).toHaveLength(2)
		// BOTH rows keep the slash name — it is the match key; the suffix
		// moved to the render-only displayName.
		expect(names(merged)).toEqual(["/help", "/help"])
		const twin = merged[1]
		expect(twin?.source).toBe("host")
		expect(twin?.displayName).toBe("/help ‹host›")
		// the gesture name rides the suffix params — execute must proxy the same form
		expect(calls).toContainEqual({ key: "command.hostSource", params: { name: "/help" } })
		// and the local row is the untouched original, first in the tie
		expect(merged[0]?.run).toBe(local.run)
		expect(merged[0]?.source).not.toBe("host")
		expect(merged[0]?.displayName).toBeUndefined()
	})

	test("output is alphabetically ordered; name-identical ties keep local before host", () => {
		const { t } = stubT()
		// local deliberately NOT alphabetical on input — the merge owns the order
		const merged = mergeHostCommands(
			[localRow("/zeta"), localRow("/alpha"), localRow("/dup")],
			[hostRow("/mid"), hostRow("/dup")],
			{ t },
		)
		// the duplicate twin now shares the bare gesture name, so the table
		// lists "/dup" twice (local row first, then the host twin)
		expect(names(merged)).toEqual(["/alpha", "/dup", "/dup", "/mid", "/zeta"])
		expect(merged[1]?.source).not.toBe("host")
		expect(merged[2]?.source).toBe("host")
		expect(merged[2]?.displayName).toBe("/dup ‹host›")
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

	test("host run with `undefined` (seam contract: the command FAILED) paints the failure copy, never the executed one (key via stub t)", async () => {
		const { t, calls } = stubT()
		const merged = mergeHostCommands([], [hostRow("/foo")], { t })
		const run = merged.find((c) => c.name === "/foo")!.run
		const { ctx, said } = fakeCtx(async () => undefined)
		await run(ctx, "")
		expect(said).toEqual(["failed:/foo"])
		expect(calls).toContainEqual({ key: "command.hostExecuteFailed", params: { name: "/foo" } })
	})

	test("host run with a settled no-text round ({}) paints the executed copy (key via stub t)", async () => {
		const { t, calls } = stubT()
		const merged = mergeHostCommands([], [hostRow("/foo")], { t })
		const run = merged.find((c) => c.name === "/foo")!.run
		const { ctx, said } = fakeCtx(async () => ({}))
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

	test("bare wire name is normalized to the slash gesture: {name:'dcp'} merges as /dcp", () => {
		const { t } = stubT()
		const merged = mergeHostCommands([localRow("/alpha")], [hostRow("dcp")], { t })
		// length = local + host — the row is LISTED, not dropped
		expect(merged).toHaveLength(2)
		const dcp = merged.find((c) => c.source === "host")
		expect(dcp?.name).toBe("/dcp")
		expect(dcp?.description).toBe("host dcp")
		expect(dcp?.displayName).toBeUndefined() // no local collision → no suffix
	})

	test("the normalized /dcp is reachable through the palette's /-prefix filter", () => {
		const { t } = stubT()
		const merged = mergeHostCommands([localRow("/alpha")], [hostRow("dcp")], { t })
		// filterCommands is the palette's own filter — slash-anchored; before
		// the normalization a bare wire name matched NOTHING here (the bug).
		const hits = filterCommands(merged, "/dc")
		expect(hits.map((c) => c.name)).toEqual(["/dcp"])
		// and the raw table assertion the task pins: startsWith("/dc") hits
		expect(merged.filter((c) => c.name.startsWith("/dc"))).toHaveLength(1)
	})

	test("bare-name duplicate (local /help + host help): both rows listed, dispatchLine('/help') still hits the LOCAL row", () => {
		const { t } = stubT()
		const local = localRow("/help")
		const merged = mergeHostCommands([local], [hostRow("help")], { t })
		// both columns present under the same gesture name
		expect(merged).toHaveLength(2)
		expect(names(merged)).toEqual(["/help", "/help"])
		// exact dispatch resolves the FIRST exact match — the local row
		const dispatch = dispatchLine(merged, "/help")
		expect(dispatch.kind).toBe("command")
		if (dispatch.kind !== "command") return
		expect(dispatch.command).toBe(local)
		expect(dispatch.command.source).not.toBe("host")
		// with args too: "/help me out" keeps hitting the local /help
		const withArgs = dispatchLine(merged, "/help me out")
		expect(withArgs.kind).toBe("command")
		if (withArgs.kind === "command") {
			expect(withArgs.command).toBe(local)
			expect(withArgs.argText).toBe("me out")
		}
	})

	test("displayName rides ONLY the duplicate twin: unique host rows keep the bare gesture name with no suffix", () => {
		const { t, calls } = stubT()
		const merged = mergeHostCommands(
			[localRow("/help")],
			[hostRow("help"), hostRow("dcp"), hostRow("opencode-status")],
			{ t },
		)
		const twins = merged.filter((c) => c.name === "/help" && c.source === "host")
		expect(twins).toHaveLength(1)
		expect(twins[0]?.displayName).toBe("/help ‹host›")
		// the unique host rows: gesture name preserved, displayName unset —
		// the suffix never leaks onto non-duplicate rows
		const dcp = merged.find((c) => c.name === "/dcp")
		expect(dcp?.source).toBe("host")
		expect(dcp?.displayName).toBeUndefined()
		const ocs = merged.find((c) => c.name === "/opencode-status")
		expect(ocs?.displayName).toBeUndefined()
		// hostSource was translated exactly once (the single twin)
		expect(calls.filter((c) => c.key === "command.hostSource")).toEqual([
			{ key: "command.hostSource", params: { name: "/help" } },
		])
	})
})
