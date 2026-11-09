/**
 * Slash Tab completion — pure decision core (./slash-complete.ts).
 *
 * Pins the bash-style semantics: unique → "/cmd " (trailing separator),
 * several → longest common prefix (menu stays open, selection not moved),
 * zero → consume and rewrite nothing (never a literal tab), full name with
 * prefix siblings → cycle, plain text / argument phase / mid-token caret →
 * fall through untouched.
 */
import { describe, expect, test } from "bun:test"
import { completeSlash, isSlashNamePhase, type SlashCompletion } from "../src/routes/session/slash-complete"
import type { SlashCommand } from "../src/routes/session/commands"

const command = (name: string): SlashCommand => ({ name, description: name, run: () => {} })

const COMMANDS: SlashCommand[] = [
	command("/help"),
	command("/new"),
	command("/model"),
	command("/sessions"),
	command("/session"),
	command("/search"),
	command("/think"),
	command("/theme"),
]

function run(input: string, selected?: string): SlashCompletion | undefined {
	return completeSlash(input, input.length, COMMANDS, selected === undefined ? {} : { selected })
}

describe("completeSlash — name phase", () => {
	test("plain text, argument phase, multi-line and mid-token caret fall through", () => {
		expect(run("hello")).toBeUndefined()
		expect(run("")).toBeUndefined()
		// argument phase: a space leaves the command name
		expect(run("/model provider/model")).toBeUndefined()
		// multi-line: the buffer is not one slash token
		expect(run("/help\nmore")).toBeUndefined()
		expect(run("line\n/x")).toBeUndefined()
		// caret not at the token end: no clobbering
		expect(completeSlash("/hel", 2, COMMANDS)).toBeUndefined()
		expect(isSlashNamePhase("/help")).toBe(true)
		expect(isSlashNamePhase("/help ")).toBe(false)
	})
})

describe("completeSlash — unique match", () => {
	test("fills the command with the trailing argument separator, caret at end", () => {
		expect(run("/he")).toEqual({ text: "/help ", cursor: 6, keepMenu: false, changed: true })
		expect(run("/hel")).toMatchObject({ text: "/help ", cursor: 6, keepMenu: false })
		// already a full name: adds the separator, no cycle (no prefix sibling)
		expect(run("/help")).toMatchObject({ text: "/help ", changed: true })
	})
})

describe("completeSlash — several candidates", () => {
	test("extends to the longest common prefix, menu stays open, selection not moved", () => {
		// /sessions /session /search → "/se" (the third char differs: s/s/a)
		expect(run("/s")).toMatchObject({ text: "/se", cursor: 3, keepMenu: true, changed: true })
		// at the common prefix the next Tab has nothing to extend: it accepts
		// the highlighted row (the palette's first match when none is given)
		expect(run("/se")).toMatchObject({ text: "/sessions ", cursor: 10, keepMenu: false })
	})

	test("no extension past the common prefix: accepts the highlighted row with the separator", () => {
		// "/se" cannot extend; the palette's selected row wins
		expect(run("/se", "/session")).toMatchObject({ text: "/session ", cursor: 9, keepMenu: false })
		// menu closed (no selection): first candidate in table order
		expect(run("/se")).toMatchObject({ text: "/sessions ", keepMenu: false })
	})
})

describe("completeSlash — cycling (bash menu-complete)", () => {
	test("a full name with prefix siblings steps to the next candidate without a space", () => {
		// candidates for "/session": /sessions (index 0), /session (index 1)
		expect(run("/session")).toMatchObject({ text: "/sessions", cursor: 9, keepMenu: true, changed: true })
		// at the longest name the candidate set is unique → finish with the separator
		expect(run("/sessions")).toMatchObject({ text: "/sessions ", cursor: 10, keepMenu: false, changed: true })
	})

	test("the step is stateless: the written name is the next call's cycle index", () => {
		const first = run("/session")
		expect(first?.text).toBe("/sessions")
		const second = run(first!.text)
		expect(second?.text).toBe("/sessions ")
	})
})

describe("completeSlash — no match", () => {
	test("consumes the key but rewrites nothing (no literal tab)", () => {
		expect(run("/zzz")).toEqual({ text: "/zzz", cursor: 4, keepMenu: false, changed: false })
		// bare "/" matches everything: the highlighted (first) row is accepted
		expect(run("/")).toMatchObject({ text: "/help ", changed: true, keepMenu: false })
		// an explicit selection wins over the first-row fallback
		expect(run("/", "/theme")).toMatchObject({ text: "/theme " })
	})
})

describe("completeSlash — unicode command names", () => {
	test("CJK prefixes filter and complete by code point, not bytes", () => {
		const cmds = [command("/思考"), command("/思考模式"), command("/帮助")]
		expect(completeSlash("/思", 2, cmds)).toMatchObject({ text: "/思考", cursor: 3, keepMenu: true })
		// full name with a longer sibling cycles
		expect(completeSlash("/思考", 3, cmds)).toMatchObject({ text: "/思考模式", cursor: 5, keepMenu: true })
		// unique match gets the separator
		expect(completeSlash("/帮", 2, cmds)).toMatchObject({ text: "/帮助 ", cursor: 4, keepMenu: false })
	})
})
