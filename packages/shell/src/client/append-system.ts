/**
 * Append-system (ported from dsh-tui-pi's APPEND_SYSTEM.md, P2 gap closure).
 *
 * tui-pi semantics: `$DSH_HOME/APPEND_SYSTEM.md` is appended to the system
 * prompt of every TUI-created main agent (subagents excluded). The opentui
 * host exposes no wire to register a system-prompt section, so the delivery
 * channel here is an agentPreset: the client maintains one `@deepseek-ai/
 * dsh-agent-preset` row in the opentui profile's `cordis.patch.yml` whose
 * composition is the shipped `standard` preset verbatim with the persona row
 * carrying `{ suffix: <APPEND_SYSTEM.md> }`. The preset scope shadows only
 * the persona sections, so the session face is standard's plus the suffix —
 * additive by construction. `session/create` rides that preset when the host
 * roster composes it (remote-host-session.ts).
 *
 * File-driven persona: the suffix is a `!!js` expression the HOST evaluates
 * at boot — a guarded `readFileSync` of `$DSH_HOME/APPEND_SYSTEM.md` (probe
 * 2026-11-15, host 0.2.2-rc.3: `process.getBuiltinModule('node:module')
 * .createRequire(baseUrl)` and `baseUrl` are both reachable from user-patch
 * `!!js` rows; missing file resolves to '' and the empty section is dropped
 * by the prompt renderer). The patch block is therefore content-independent:
 * it is written once and never resynced, and persona edits follow the file
 * on the next host boot.
 *
 * Boot-time seeding (tui-pi parity): a missing APPEND_SYSTEM.md is seeded
 * from the embedded template; an existing file is user-owned — zero writes.
 */

import { chmodSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

/** The preset id the client rides on `session/create` (unique vs the shipped roster: standard/ptc/minimal/cordis). */
export const APPEND_SYSTEM_PRESET_ID = "opentui-append-system"
/** The patch row id carrying the preset declaration (unique vs profile patch row ids). */
export const APPEND_SYSTEM_ROW_ID = `preset-${APPEND_SYSTEM_PRESET_ID}`
/** The managed-block marker comment: its presence marks OUR lines; resync never touches other lines. */
export const APPEND_SYSTEM_MARKER = "# dsh-opentui:append-system"

/** Default harness home: `$DSH_HOME` or `~/.dsh` (tui-pi parity; an empty DSH_HOME falls back, host-side parity). */
export function defaultDshHome(): string {
	return process.env.DSH_HOME || join(homedir(), ".dsh")
}

/** The user-editable append file (`$DSH_HOME/APPEND_SYSTEM.md`). */
export function appendSystemPath(home: string = defaultDshHome()): string {
	return join(home, "APPEND_SYSTEM.md")
}

/**
 * The seed template for a missing APPEND_SYSTEM.md — neutral scaffolding
 * (the tui-pi template is the original user's personal orchestrator identity,
 * not shippable content) carrying the one iron rule tui-pi maintained. The
 * todo-lifecycle section is deliberately absent: the opentui host clears
 * todos every turn (loop.ts), so tui-pi's pinned-list problem does not exist
 * here.
 */
export const APPEND_SYSTEM_TEMPLATE = `# APPEND_SYSTEM.md — standing system-prompt additions

The content of this file is appended to the system prompt of every main
session the dsh-opentui client creates (ported from dsh-tui-pi).

The file is user-owned: the client seeds it once and never rewrites it.
Edits apply to sessions created after the next client start; clearing or
deleting this file switches the append off (it is not re-seeded).

## Vocabulary

- "subagent" means the registered subagents only; never invent or use
  unregistered subagents.

## Additions

Write your persistent instructions below this line.
`

/**
 * The persona suffix the host evaluates at boot: guarded read of
 * `$DSH_HOME/APPEND_SYSTEM.md`, '' when missing/unreadable. One line, no
 * double quotes (survives YAML double-quoted scalars), no backslashes.
 */
export const APPEND_SYSTEM_SUFFIX_EXPR =
	`((req, path) => { try { const text = req('node:fs').readFileSync(path.join(process.env.DSH_HOME || ((process.env.HOME || '') + '/.dsh'), 'APPEND_SYSTEM.md'), 'utf8'); return text.length > 65536 ? text.slice(0, 65536) + String.fromCharCode(10) + '[append-system: truncated at 64KiB]' : text } catch { return '' } })(process.getBuiltinModule('node:module').createRequire(baseUrl), process.getBuiltinModule('node:path'))`

/**
 * The managed patch block. The plugin list is the shipped `standard` preset
 * verbatim (dsh-web-app presets/standard.patch.yml — the effective default
 * this profile's sessions compose from) except the persona row, whose prefix
 * is copied verbatim and whose suffix is the APPEND_SYSTEM.md read. Copying
 * the whole composition is what makes the preset additive: a persona-only
 * preset would shadow standard's skill/plan/compaction/delegation rows and
 * shrink the session face (agents-mount gate).
 */
export function appendSystemPresetBlock(): string {
	return `${APPEND_SYSTEM_MARKER} — managed block (client-owned; the client appends it once and never rewrites other lines).
${APPEND_SYSTEM_MARKER} persona suffix = $DSH_HOME/APPEND_SYSTEM.md, evaluated by the host at boot (!!js guarded read; empty file => empty section => dropped).
- insert:
    - id: ${APPEND_SYSTEM_ROW_ID}
      name: '@deepseek-ai/dsh-agent-preset'
      config:
        id: ${APPEND_SYSTEM_PRESET_ID}
        name: Standard + Append
        description: The shipped standard preset plus the user's APPEND_SYSTEM.md appended to the system prompt.
        order: 5
        plugins:
          - id: persona
            name: '@deepseek-ai/dsh-persona'
            config:
              prefix: You are a coding agent powered by the {{model}} model.
              suffix: !!js "${APPEND_SYSTEM_SUFFIX_EXPR}"
          - id: agent-instructions
            name: '@deepseek-ai/dsh-agent-instructions'
            config:
              maxBytes: 65536
          - id: time-context
            name: '@deepseek-ai/dsh-time-context'
          - id: tool-bash
            name: '@deepseek-ai/dsh-tool-bash'
            disabled: !!js process.platform === 'win32'
          - id: tool-pwsh
            name: '@deepseek-ai/dsh-tool-pwsh'
            disabled: !!js process.platform !== 'win32'
          - id: tool-fs
            name: '@deepseek-ai/dsh-tool-fs'
            config:
              # Set false to drop the apply_patch tool beside edit.
              applyPatch: false
          - id: tool-fs-search
            name: '@deepseek-ai/dsh-tool-fs-search'
            config:
              sampleOverCapGlobResults: false
          - id: tool-jobs
            name: '@deepseek-ai/dsh-tool-jobs'
          - id: tool-schedule
            name: '@deepseek-ai/dsh-tool-schedule'
          - id: skill-filesystem
            name: '@deepseek-ai/dsh-skill-filesystem'
            config:
              customSkillDirs:
                - !!js process.getBuiltinModule('node:path').join(process.getBuiltinModule('node:path').dirname(process.getBuiltinModule('node:module').createRequire(baseUrl).resolve('@deepseek-ai/dsh-agent-preset/package.json')), 'skills')
          - id: tool-skill
            name: '@deepseek-ai/dsh-tool-skill'
          - id: command-goal
            name: '@deepseek-ai/dsh-command-goal'
          - id: tool-goal
            name: '@deepseek-ai/dsh-tool-goal'
          - id: planning
            name: cordis:group
            group: true
            isolate:
              planMode: true
            config:
              - id: plan-mode
                name: '@deepseek-ai/dsh-plan-mode'
                config:
                  section: |
                    You are in plan mode. Stay in plan mode until the user approves your plan through exit_plan_mode or switches the session mode. Imperative language to implement changes means plan the implementation, not execute it. A user's conversational agreement — including an answer confirming something you asked — approves nothing and does not end plan mode; fold the confirmed decision into the plan and submit it through exit_plan_mode.

                    Explore first. Use non-mutating reads, searches, static analysis, and checks to ground the plan in the actual repository. Do not edit or write files, change configuration, run formatters or code generation that rewrites tracked files, commit, or otherwise carry out the plan. Prefer existing functions and patterns over new machinery.

                    The tool catalog stays the same across modes for request-cache stability. These plan-mode rules override any later tool description or guidance that suggests using mutation tools; those tools remain listed to keep the tool catalog unchanged. Do not use todo_write to track this planning phase: it tracks implementation after an approved plan, while the plan itself belongs in exit_plan_mode.

                    Resolve discoverable facts by inspection. Use ask_user_question only for user-owned choices or material ambiguity that inspection cannot answer. Do not ask the user where code lives or how current behavior works when you can find out.

                    Make the plan decision-complete: state the goal and success criteria; group implementation changes by subsystem; identify public API, schema, and data-flow changes; cover edge cases, failure modes, tests, acceptance criteria, and explicit assumptions. Keep it concise enough to review but detailed enough that another engineer can implement it without making design decisions.

                    When ready, call exit_plan_mode with the complete plan markdown, starting with a # title. Make exit_plan_mode the only and final tool call in that assistant response: it presents the plan for approval, and implementation begins only in a later step after approval. Do not paste the final plan as a plain reply or ask "should I proceed?" through prose or ask_user_question. If review rejects it, incorporate the feedback and present again. If the review channel is unavailable or aborted, stay in plan mode and ask the user to switch modes manually; do not proceed with implementation.
          - id: compaction
            name: cordis:group
            group: true
            isolate:
              compaction: true
              toolResultPruner: true
            config:
              - id: compaction-basic
                name: '@deepseek-ai/dsh-compaction-basic'
              - id: command-compact
                name: '@deepseek-ai/dsh-command-compact'
              - id: tool-result-pruner
                name: '@deepseek-ai/dsh-compaction-tool-result-pruner'
                config:
                  thresholdChars: 8192
                  headChars: 4096
                  tailChars: 1024
          - id: delegation
            name: cordis:group
            group: true
            isolate:
              workflowEngine: true
            config:
              - id: tool-subagent-control
                name: '@deepseek-ai/dsh-tool-subagent-control'
                config:
                  interrupt: false
              - id: tool-subagent
                name: '@deepseek-ai/dsh-tool-subagent'
                config:
                  provider: spawn
                  toolName: subagent
                  modelSelection: true
                  modelDiscovery: true
              - id: tool-subagent-fork
                name: '@deepseek-ai/dsh-tool-subagent'
                config:
                  provider: fork
                  toolName: subagent_fork
              - id: workflow-ptc
                name: '@deepseek-ai/dsh-workflow-ptc'
                config:
                  provider: spawn
              - id: tool-workflow
                name: '@deepseek-ai/dsh-tool-workflow'
          - id: tool-ask-user
            name: '@deepseek-ai/dsh-tool-ask-user'
          - id: tool-todo
            name: '@deepseek-ai/dsh-tool-todo'
            config:
              allowParallelInProgress: true
          - id: tool-web
            name: '@deepseek-ai/dsh-tool-web'
            config:
              fetch: true
              searchTimeoutMs: 60000
          - id: present
            name: '@deepseek-ai/dsh-tool-present'
          - id: tool-office
            name: '@deepseek-ai/dsh-tool-office'
          - id: tool-plugin-manager
            name: '@deepseek-ai/dsh-plugin-manager/tools'
            disabled: !!js "!ctx.get('profileContext')"
          - id: tool-plugin-market
            name: '@deepseek-ai/dsh-plugin-market/tools'
            disabled: true
`
}

/**
 * Read the append file for prompt assembly. Missing/unreadable => ''
 * (tui-pi parity: the empty section is dropped by the renderer).
 */
export function readAppendSystem(path: string = appendSystemPath()): string {
	try {
		return readFileSync(path, "utf8")
	} catch {
		return ""
	}
}

/** Atomic write: temp file in the same directory, then rename (tui-pi parity). */
function writeAtomically(path: string, content: string, mode: number): void {
	mkdirSync(join(path, ".."), { recursive: true })
	const tmp = `${path}.${process.pid}.tmp`
	try {
		writeFileSync(tmp, content, { mode })
		renameSync(tmp, path)
	} catch (error) {
		try {
			unlinkSync(tmp)
		} catch {
			/* sweep is best-effort */
		}
		throw error
	}
}

/**
 * Seed the append file — FIRST PROVISIONING ONLY: a missing file is seeded
 * solely when the managed preset block is absent too. After provisioning,
 * deleting the file is how the user switches the append OFF (an empty persona
 * suffix renders no section), and this function must not resurrect it (the
 * block's presence answers "provisioned"). An existing file — even an empty
 * one — is user-owned: zero writes. Atomic; throws on write failure (the
 * caller degrades to booting without the feature, never fails the boot).
 * @param path - target file (injectable for tests). Whether the install is
 *   already provisioned (managed block present => deleted file stays deleted)
 *   is the CALLER's judgment — see {@link provisionAppendSystem}.
 */
export function ensureAppendSystemFile(path: string = appendSystemPath()): "seeded" | "kept" {
	try {
		readFileSync(path, "utf8")
		return "kept"
	} catch {
		writeAtomically(path, APPEND_SYSTEM_TEMPLATE, 0o644)
		try {
			chmodSync(path, 0o644)
		} catch {
			/* best-effort mode normalization */
		}
		return "seeded"
	}
}

/** Outcome of one profile-patch sync pass. */
export type AppendPresetSyncResult =
	| { status: "added" }
	| { status: "present" }
	| { status: "collision"; detail: string }
	| { status: "skipped"; detail: string }

/**
 * The profile patch file the client maintains (`~/.dsh/profiles/<profile>/cordis.patch.yml`).
 */
export function profilePatchPath(home: string, profile: string): string {
	return join(home, "profiles", profile, "cordis.patch.yml")
}

/**
 * The [start, end) line span of OUR managed block: from the first marker
 * comment through our single top-level `- insert:` entry — the span ends at
 * the NEXT top-level patch row (`^- `) after our insert line, or EOF. Lines
 * outside the span are the user's (or other tools') — this module never
 * rewrites them.
 */
function managedSpan(lines: readonly string[]): [number, number] | undefined {
	const start = lines.findIndex((line) => line.startsWith(APPEND_SYSTEM_MARKER))
	if (start < 0) return undefined
	let end = lines.length
	let seenOwnInsert = false
	for (let i = start + 1; i < lines.length; i++) {
		if (/^- /.test(lines[i])) {
			// The first top-level row after the marker is our own `- insert:`.
			if (!seenOwnInsert) {
				seenOwnInsert = true
				continue
			}
			end = i
			break
		}
	}
	return [start, end]
}

/**
 * One boot-time provisioning pass (the lifecycle entry point): maintain the
 * managed preset row, then seed the append file only when the install is not
 * yet provisioned (no managed block) AND the file is missing — afterwards a
 * deleted file means OFF and stays deleted. Returns both outcomes for the
 * caller's structured logging; write failures propagate.
 */
export function provisionAppendSystem(home: string, profile: string): { patch: AppendPresetSyncResult; file: "seeded" | "kept" } {
	// Provisioning is judged on the PRE-sync patch state: the block this pass
	// just added must not count (a fresh install seeds the file in the same
	// breath), while a block that already existed means the user may have
	// deleted the file to switch OFF — never re-seed over that.
	let preText: string | undefined
	try {
		preText = readFileSync(profilePatchPath(home, profile), "utf8")
	} catch {
		preText = undefined // no patch file: nothing provisioned, seeding stays eligible
	}
	const patch = syncAppendSystemPreset(home, profile)
	if (preText !== undefined && managedSpan(preText.split("\n")) !== undefined) {
		return { patch, file: "kept" } // provisioned install: deleted file stays deleted (delete = off)
	}
	return { patch, file: ensureAppendSystemFile(appendSystemPath(home)) }
}

/**
 * Maintain the append-system preset row in the profile patch (conservative
 * line-level editing — the file is user-owned YAML, no parse-and-reserialize):
 *
 * - the ids appear OUTSIDE our block (a preset/row the user declared or a
 *   future host ships with the same id) => `collision`, zero writes;
 * - otherwise: block present => `present`, untouched (the block is content-
 *   independent in file-driven mode; there is nothing to resync); block
 *   absent => append at EOF (`added`);
 * - patch file or profile dir missing => `skipped` (the host owns that
 *   layout; enrichment must not create profile plumbing).
 *
 * The write is atomic (tmp + rename) and preserves the file mode (0600 for a
 * fresh file, matching the host's config-editor convention).
 */
export function syncAppendSystemPreset(home: string, profile: string): AppendPresetSyncResult {
	const path = profilePatchPath(home, profile)
	let before: string
	try {
		before = readFileSync(path, "utf8")
	} catch {
		return { status: "skipped", detail: `no profile patch at ${path}` }
	}
	const lines = before.split("\n")
	const span = managedSpan(lines)
	const outside = (needle: string): string | undefined => {
		for (let i = 0; i < lines.length; i++) {
			if (span !== undefined && i >= span[0] && i < span[1]) continue
			if (lines[i].includes(needle)) return `line ${i + 1}: ${lines[i].trim()}`
		}
		return undefined
	}
	for (const needle of [APPEND_SYSTEM_PRESET_ID, APPEND_SYSTEM_ROW_ID]) {
		const hit = outside(needle)
		if (hit !== undefined) {
			return { status: "collision", detail: `${needle} already declared (${hit})` }
		}
	}
	if (span !== undefined) return { status: "present" }
	// Append at EOF: the patch is a YAML sequence; a new top-level entry is
	// safe at the end (the last layer wins per id, and we collide-checked).
	const separator = before.length === 0 || before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n"
	const next = `${before}${separator}${appendSystemPresetBlock()}`
	writeAtomically(path, next, 0o600)
	return { status: "added" }
}
