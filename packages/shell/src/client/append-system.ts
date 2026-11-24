/**
 * Append-system (ported from dsh-tui-pi's APPEND_SYSTEM.md, P2 gap closure).
 *
 * tui-pi semantics: `$DSH_HOME/APPEND_SYSTEM.md` is appended to the system
 * prompt of every TUI-created main agent (subagents excluded). The INPROC
 * bridge delivers that text itself (`packages/bridge/src/append-text.ts`),
 * reading the same file with its own mtime cache.
 *
 * T7 (06 §1.1 / R6): the legacy client patch writer and its managed-marker
 * preset block are RETIRED — the profile patch is host-owned, and the client
 * never writes it. Only the file read/seed logic below remains (unchanged).
 * The preset id constants stay for legacy-resume detection in the bridge and
 * for the tests that assert the old id never leaks onto the wire.
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
  unregistered subagents. There are two by-name entrances: the native
  \`subagent\` / \`subagent_fork\` tools, and the \`use_agent\` roster of
  locally-defined agents under \`$DSH_HOME/agents/\` (with \`ask_agent\` for
  follow-ups). Use the roster entry whose name matches the role you need.

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
              # The by-name custom-agent entrances (use_agent / ask_agent) are
              # registered globally by the @aiwayds/dsh-subagent-registry
              # companion, not by a preset row — declaring them here would
              # double-mount the plugin. Its delegation-guidance listener also
              # rewrites the host delegation section to point at the roster, so
              # do not duplicate that prose here. This group only carries the
              # native subagent/workflow tools.
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
 * once. An existing file — even an empty one — is user-owned: zero writes.
 * Atomic; throws on write failure (the caller degrades to booting without the
 * feature, never fails the boot).
 * T7: the patch-marker provisioning gate is retired; the FILE read/seed logic
 * below is unchanged (the bridge reads `$DSH_HOME/APPEND_SYSTEM.md` itself).
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
