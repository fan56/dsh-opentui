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
