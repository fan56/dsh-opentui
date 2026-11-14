/**
 * /agents mount-bridge regression (the "not mounted in this entry" bug).
 *
 * Live symptom: `./dsh-opentui` + `/agents` answered
 *   "/agents: the manager panel is not mounted in this entry"
 * although the panel was mounted and the seam carried the agents face. Root
 * cause: `createSlashHost` (routes/session/slash-palette.tsx) built the
 * SlashCommandContext without carrying `openAgents` — the deps type and the
 * ctx spread both missed the hook, so `ctx.openAgents` was undefined even
 * though v2-entry passed it. The command-level unit test (commands.test.ts)
 * builds the ctx by hand, so it could never see the gap.
 *
 * This guards the ENTRY shape (the file ts-nocheck boot path no typecheck
 * reaches): the real client entry must keep (a) the panel mounted in the
 * render tree and (b) the hook wired into createSlashHost. The behavioural
 * pin (dispatch -> ctx.openAgents) lives in test/slash-palette.test.ts and
 * the real-client gate in verify/agents-mount-repro.mjs.
 */
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const entry = readFileSync(join(import.meta.dir, "..", "examples", "v2-entry.tsx"), "utf8")

describe("/agents is mounted in the real client entry", () => {
	test("v2-entry mounts AgentsPanel in the render tree", () => {
		expect(entry).toMatch(/import \{ AgentsPanel, openAgentsPanel \} from "\.\.\/src\/routes\/session\/agents-panel"/)
		expect(entry).toMatch(/createComponent\(AgentsPanel, \{/)
	})

	test("v2-entry wires openAgents into createSlashHost (the gap that broke /agents)", () => {
		expect(entry).toMatch(/openAgents: \(name\?: string\) => openAgentsPanel\(name\)/)
	})
})

describe("/skills is mounted in the real client entry (gap C3)", () => {
	/** The `createComponent(SkillsPanel, { … })` block (balanced braces from
	 * the call to its closing `})`). The exit-2 bug lived inside this block:
	 * the root children getters read a BOOT-scope const
	 * (`skillsManagerRoots`, declared in bootClientV2) instead of the page
	 * props — legal at build time (the file is @ts-nocheck), a
	 * ReferenceError the moment the panel first mounted, and the root
	 * ErrorBoundaryDiagnostics fallback answers that with process.exit(2)
	 * (the graceful-teardown clean exit; nothing reaches
	 * opentui-client.errors.log because it is neither a rejection nor an
	 * uncaught exception). */
	function skillsPanelMount(): string {
		const start = entry.indexOf("createComponent(SkillsPanel, {")
		expect(start).toBeGreaterThan(-1)
		let depth = 0
		for (let i = start; i < entry.length; i++) {
			if (entry[i] === "{") depth++
			else if (entry[i] === "}") {
				depth--
				if (depth === 0) return entry.slice(start, i + 1)
			}
		}
		return ""
	}

	test("v2-entry mounts SkillsPanel in the render tree", () => {
		expect(entry).toMatch(/import \{ SkillsPanel, openSkillsPanel \} from "\.\.\/src\/routes\/session\/skills-panel"/)
		expect(entry).toMatch(/openSkills: \(\) => openSkillsPanel\(\)/)
	})

	test("the panel's roots ride ARROW-FUNCTION props over page props", () => {
		const mount = skillsPanelMount()
		// HistoryPanel `sessionId: () => …` precedent: the root children's
		// PROP RECAST LAW bakes object getters (`get source()`) into static
		// values before the component body runs, so a getter prop arrives as
		// the bare string and `props.source()` inside the panel throws
		// TypeError (the second half of the exit-2 bug). Arrow-function props
		// survive the recast and keep the panel's lazy reads lazy.
		expect(mount).toContain("source: () => props.skillsSource")
		expect(mount).toContain("curated: () => props.skillsCurated")
		// The first bug shape: object getters reading boot scope
		// (`return skillsManagerRoots.source`) must never come back.
		expect(mount).not.toMatch(/get (source|curated)\(\)/)
		expect(mount).not.toContain("skillsManagerRoots.")
	})

	test("V2SessionPage declares the roots as props and boot passes them", () => {
		expect(entry).toMatch(/skillsSource: string/)
		expect(entry).toMatch(/skillsCurated: string/)
		expect(entry).toMatch(/skillsSource: skillsManagerRoots\.source/)
		expect(entry).toMatch(/skillsCurated: skillsManagerRoots\.curated/)
	})
})
