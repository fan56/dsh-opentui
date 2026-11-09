/**
 * Slash Tab completion — pure decision core (./slash-complete.ts).
 *
 * Pins the fish-style semantics: unique → "/cmd " (trailing separator),
 * several → longest common prefix (menu stays open, selection not moved),
 * exact full name → "/cmd " (same landing as Enter, never a cycle step),
 * zero → consume and rewrite nothing (never a literal tab), plain text /
 * argument phase / mid-token caret → fall through untouched.
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
		expect(completeSlash("/hepl", 3, COMMANDS)).toBeUndefined()
		expect(isSlashNamePhase("/help")).toBe(true)
		expect(isSlashNamePhase("/help ")).toBe(false)
	})
})

describe("completeSlash — unique match", () => {
	test("fills the command with the trailing argument separator, caret at end", () => {
		expect(run("/he")).toEqual({ text: "/help ", cursor: 6 })
		expect(run("/hel")).toMatchObject({ text: "/help ", cursor: 6 })
	})
})

describe("completeSlash — exact full name (fish model)", () => {
	test("a full name finishes with the separator instead of cycling to a sibling", () => {
		// "/session" has the longer sibling "/sessions", but Tab and Enter must
		// agree: both land on "/session" (no drift, no cycle state).
		expect(run("/session")).toEqual({ text: "/session ", cursor: 9 })
		expect(run("/sessions")).toEqual({ text: "/sessions ", cursor: 10 })
		// no sibling at all: same landing
		expect(run("/help")).toEqual({ text: "/help ", cursor: 6 })
	})

	test("the exact name is not hijacked by the palette highlight", () => {
		// even with another candidate highlighted, the typed full name wins
		expect(run("/session", "/sessions")).toEqual({ text: "/session ", cursor: 9 })
	})
})

describe("completeSlash — several candidates", () => {
	test("extends to the longest common prefix, menu stays open, selection not moved", () => {
		// /sessions /session /search → "/se" (the third char differs: s/s/a)
		expect(run("/s")).toMatchObject({ text: "/se", cursor: 3 })
		// at the common prefix the next Tab has nothing to extend: it accepts
		// the highlighted row (the palette's first match when none is given)
		expect(run("/se")).toMatchObject({ text: "/sessions ", cursor: 10 })
	})

	test("no extension past the common prefix: accepts the highlighted row with the separator", () => {
		// "/se" cannot extend; the palette's selected row wins
		expect(run("/se", "/session")).toMatchObject({ text: "/session ", cursor: 9 })
		// menu closed (no selection): first candidate in table order
		expect(run("/se")).toMatchObject({ text: "/sessions " })
	})
})

describe("completeSlash — no match", () => {
	test("consumes the key but rewrites nothing (no literal tab)", () => {
		expect(run("/zzz")).toEqual({ text: "/zzz", cursor: 4 })
		// bare "/" matches everything: the highlighted (first) row is accepted
		expect(run("/")).toMatchObject({ text: "/help " })
		// an explicit selection wins over the first-row fallback
		expect(run("/", "/theme")).toMatchObject({ text: "/theme " })
	})
})

describe("completeSlash — unicode command names", () => {
	test("CJK prefixes filter and complete by code point, not bytes", () => {
		const cmds = [command("/思考"), command("/思考模式"), command("/帮助")]
		expect(completeSlash("/思", 2, cmds)).toMatchObject({ text: "/思考", cursor: 3 })
		// exact full name: separator, not the longer sibling
		expect(completeSlash("/思考", 3, cmds)).toMatchObject({ text: "/思考 ", cursor: 4 })
		// unique match gets the separator
		expect(completeSlash("/帮", 2, cmds)).toMatchObject({ text: "/帮助 ", cursor: 4 })
	})
})
