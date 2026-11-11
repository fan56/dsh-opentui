/**
 * Boot regression guard (ui-matrix finding): 11 `resize` listeners were added
 * to the CliRenderer at startup because every session-page component called
 * `useTerminalDimensions()` (one renderer listener each), crossing Node's
 * default 10-listener cap and printing MaxListenersExceededWarning.
 *
 * `routes/session/terminal-size.ts` owns ONE reference-counted listener per
 * renderer; every session-tree component must read that shared signal.
 */
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const SESSION_DIR = join(import.meta.dir, "..", "src", "routes", "session")

const SHARED_CONSUMERS = [
	"transcript.tsx",
	"widgets-dock.tsx",
	"session-composer.tsx",
	"composer-context.tsx",
	"hints-line.tsx",
	"lastrequest-dock.tsx",
	"notices-dock.tsx",
	"powerline.tsx",
]

describe("shared terminal size (one resize listener)", () => {
	test("the shared module registers exactly one renderer listener and detaches it", () => {
		const source = readFileSync(join(SESSION_DIR, "terminal-size.ts"), "utf8")
		expect(source.match(/renderer\.on\("resize", entry\.onResize\)/g)).toHaveLength(1)
		expect(source).toContain('renderer.off("resize", entry.onResize)')
	})

	test("session-page components use useTerminalSize, never the per-component hook", () => {
		for (const file of SHARED_CONSUMERS) {
			const source = readFileSync(join(SESSION_DIR, file), "utf8")
			expect(source).not.toContain("useTerminalDimensions")
			expect(source).toContain("useTerminalSize")
		}
	})
})
