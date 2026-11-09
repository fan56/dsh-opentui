/**
 * Workspace profile composition for agent definitions (tui-pi
 * agent-runtime.ts / model-profiles.ts parity).
 *
 * An agent's DISPLAYED model/thinking is the frontmatter baseline composed
 * with the overrides of the profile the workspace is pinned to:
 *
 *   effective = frontmatter baseline  (+)  profiles[pinned].agents[name]
 *
 * The pin is the nearest `.dsh-profile` walking up from the workspace root
 * (first non-empty, non-`#` line = profile name). A pin naming a profile
 * that no longer exists is treated as unbound. `model-profiles.json`'s
 * `current` key is NOT part of this path - that key drives the opentui
 * agent loop's default route (`agent/config.ts`), a different semantic.
 *
 * Edits: model/thinking land in the pinned profile's `agents[name]` entry
 * (atomic tmp+rename inside the same JSON document, every other key left
 * untouched) when the pin resolves; otherwise they land in the agent's
 * frontmatter. `deep` always lands in the frontmatter.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import {
	listAgentFiles,
	updateAgentFrontmatter,
	type RemoteAgentRow,
} from "./remote-local-fs.ts"

export const MODEL_PROFILES_VERSION = 1
export const PROFILE_PIN_FILE = ".dsh-profile"

/** The reasoning-effort ids the host accepts (registry THINKING_LEVELS). */
export const AGENT_THINKING_LEVELS = ["off", "low", "medium", "high", "xhigh", "max"] as const

/** Profiles seeded into a fresh/invalid store (tui-pi default names). */
export const DEFAULT_PROFILE_NAMES = ["work", "personal", "other"] as const

export interface ProfileAgentEntry {
	model?: string
	thinking?: string
}

export interface ModelProfileDocEntry {
	name: string
	agents: Record<string, ProfileAgentEntry>
}

export interface ModelProfilesDoc {
	version?: number
	current?: string
	profiles: ModelProfileDocEntry[]
}

/** One agent row plus the composed values and the resolved pin. */
export interface ComposedAgentRow extends RemoteAgentRow {
	/** Composed model (baseline (+) pinned override); absent = inherit. */
	model?: string
	/** Composed thinking; absent = inherit. */
	thinking?: string
	/** The pinned profile name when the pin resolved to an existing profile. */
	pin?: string
}

export type AgentEditTarget = { kind: "profile"; name: string } | { kind: "frontmatter" }

export interface AgentEditPayload {
	model?: string | null
	thinking?: string | null
}

export interface AgentEditResult {
	target: AgentEditTarget
	error?: string
}

/** `$DSH_HOME/model-profiles.json` (explicit home override for tests). */
export function modelProfilesPath(home: string): string {
	return join(home, "model-profiles.json")
}

function narrowEntry(value: unknown): ProfileAgentEntry | undefined {
	if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined
	const { model, thinking } = value as Record<string, unknown>
	const entry: ProfileAgentEntry = {}
	if (typeof model === "string" && model !== "") entry.model = model
	if (typeof thinking === "string" && thinking !== "") entry.thinking = thinking
	return entry
}

function narrowProfile(value: unknown): ModelProfileDocEntry | undefined {
	if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined
	const { name, agents } = value as Record<string, unknown>
	if (typeof name !== "string" || name.trim() === "") return undefined
	const profile: ModelProfileDocEntry = { name: name.trim(), agents: {} }
	if (agents !== null && typeof agents === "object" && !Array.isArray(agents)) {
		for (const [key, raw] of Object.entries(agents as Record<string, unknown>)) {
			const agentName = key.trim()
			if (agentName === "") continue
			const entry = narrowEntry(raw)
			if (entry !== undefined) profile.agents[agentName] = entry
		}
	}
	return profile
}

/** The self-healing fallback tui-pi uses: work / personal / other, empty. */
export function seedModelProfilesDoc(): ModelProfilesDoc {
	return {
		version: MODEL_PROFILES_VERSION,
		profiles: DEFAULT_PROFILE_NAMES.map((name) => ({ name, agents: {} })),
	}
}

/**
 * Read + narrow the store. A missing, unparsable, wrong-version or
 * empty-profile file degrades to the seeded defaults (tui-pi
 * loadModelProfiles parity) - `current` is only carried through when it
 * names a surviving profile. Tolerant of extra keys; duplicates keep the
 * first.
 */
export function readModelProfilesDoc(home: string): ModelProfilesDoc {
	let raw: unknown
	try {
		raw = JSON.parse(readFileSync(modelProfilesPath(home), "utf8"))
	} catch {
		return seedModelProfilesDoc()
	}
	if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return seedModelProfilesDoc()
	const doc = raw as Record<string, unknown>
	if (doc.version !== MODEL_PROFILES_VERSION) return seedModelProfilesDoc()
	const profiles: ModelProfileDocEntry[] = []
	const seen = new Set<string>()
	if (Array.isArray(doc.profiles)) {
		for (const value of doc.profiles) {
			const profile = narrowProfile(value)
			if (profile === undefined) continue
			const key = profile.name.toLowerCase()
			if (seen.has(key)) continue
			seen.add(key)
			profiles.push(profile)
		}
	}
	if (profiles.length === 0) return seedModelProfilesDoc()
	return {
		version: MODEL_PROFILES_VERSION,
		...(typeof doc.current === "string" && profiles.some((profile) => profile.name === doc.current)
			? { current: doc.current }
			: {}),
		profiles,
	}
}

function parsePinText(text: string): string | undefined {
	for (const rawLine of text.split(/\r?\n/)) {
		const line = rawLine.trim()
		if (line === "" || line.startsWith("#")) continue
		return line
	}
	return undefined
}

/** Nearest `.dsh-profile` walking up from `startDir` (bounded by depth). */
export function readNearestProfilePin(startDir: string): string | undefined {
	let current = resolve(startDir)
	while (true) {
		const candidate = join(current, PROFILE_PIN_FILE)
		try {
			if (existsSync(candidate)) {
				const name = parsePinText(readFileSync(candidate, "utf8"))
				if (name !== undefined) return name
			}
		} catch {
			/* unreadable pin = absent */
		}
		const parent = dirname(current)
		if (parent === current) break
		current = parent
	}
	return undefined
}

/** Case-insensitive profile lookup (tui-pi findProfile). */
export function findProfile(doc: ModelProfilesDoc, name: string): ModelProfileDocEntry | undefined {
	const needle = name.trim().toLowerCase()
	return doc.profiles.find((profile) => profile.name.toLowerCase() === needle)
}

/** The pin resolved to an EXISTING profile, else undefined. */
export function resolvePinnedProfile(doc: ModelProfilesDoc | undefined, startDir: string): ModelProfileDocEntry | undefined {
	if (doc === undefined) return undefined
	const pin = readNearestProfilePin(startDir)
	return pin === undefined ? undefined : findProfile(doc, pin)
}

/** Where model/think edits land in this workspace (decided once, reused). */
export function agentEditTarget(home: string, startDir: string): AgentEditTarget {
	const profile = resolvePinnedProfile(readModelProfilesDoc(home), startDir)
	return profile === undefined ? { kind: "frontmatter" } : { kind: "profile", name: profile.name }
}

/** Pure composition: baseline (+) pinned profile override per field. */
export function composeAgentValues(
	agentName: string,
	base: { model?: string | null; thinking?: string | null },
	doc: ModelProfilesDoc | undefined,
	startDir: string,
): { model?: string; thinking?: string; pin?: string } {
	const profile = resolvePinnedProfile(doc, startDir)
	const effective: { model?: string; thinking?: string; pin?: string } = {}
	if (typeof base.model === "string" && base.model !== "") effective.model = base.model
	if (typeof base.thinking === "string" && (AGENT_THINKING_LEVELS as readonly string[]).includes(base.thinking)) {
		effective.thinking = base.thinking
	}
	if (profile === undefined) return effective
	effective.pin = profile.name
	const entry = profile.agents[agentName]
	if (entry === undefined) return effective
	if (entry.model !== undefined && entry.model !== "") effective.model = entry.model
	if (entry.thinking !== undefined && (AGENT_THINKING_LEVELS as readonly string[]).includes(entry.thinking)) {
		effective.thinking = entry.thinking
	}
	return effective
}

/** List agent files with their composed model/thinking values. */
export function listComposedAgents(home: string, startDir: string): ComposedAgentRow[] {
	const doc = readModelProfilesDoc(home)
	const profile = resolvePinnedProfile(doc, startDir)
	return listAgentFiles(home).map((row) => {
		if (row.broken !== undefined) return { ...row }
		const effective = composeAgentValues(
			row.name,
			{ model: row.model ?? null, thinking: row.thinking ?? null },
			doc,
			startDir,
		)
		return {
			...row,
			...(effective.model !== undefined ? { model: effective.model } : {}),
			...(effective.thinking !== undefined ? { thinking: effective.thinking } : {}),
			...(profile !== undefined ? { pin: profile.name } : {}),
		}
	})
}

/**
 * Persist model/thinking overrides into one profile's `agents[name]` entry
 * (atomic tmp sibling + rename) with every other document key preserved.
 */
export function saveProfileAgentOverrides(
	home: string,
	profileName: string,
	agentName: string,
	edit: AgentEditPayload,
): string | undefined {
	const path = modelProfilesPath(home)
	let raw: Record<string, unknown> = {
		version: MODEL_PROFILES_VERSION,
		profiles: DEFAULT_PROFILE_NAMES.map((name) => ({ name, agents: {} })),
	}
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8"))
		if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
			const candidate = parsed as Record<string, unknown>
			if (candidate.version === MODEL_PROFILES_VERSION && Array.isArray(candidate.profiles)) raw = candidate
		}
	} catch {
		/* missing/corrupt: write the seeded document below */
	}
	const profiles = raw.profiles as unknown[]
	const index = profiles.findIndex((value) => {
		if (value === null || typeof value !== "object" || Array.isArray(value)) return false
		const name = (value as Record<string, unknown>).name
		return typeof name === "string" && name.trim().toLowerCase() === profileName.trim().toLowerCase()
	})
	if (index < 0) return `profile "${profileName}" not found`
	const profile = profiles[index] as Record<string, unknown>
	const existing = profile.agents
	const agents: Record<string, unknown> =
		existing !== null && typeof existing === "object" && !Array.isArray(existing)
			? { ...(existing as Record<string, unknown>) }
			: {}
	const currentRaw = agents[agentName]
	const entry: Record<string, unknown> =
		currentRaw !== null && typeof currentRaw === "object" && !Array.isArray(currentRaw)
			? { ...(currentRaw as Record<string, unknown>) }
			: {}
	if (edit.model !== undefined) {
		if (edit.model === null) delete entry.model
		else entry.model = edit.model
	}
	if (edit.thinking !== undefined) {
		if (edit.thinking === null) delete entry.thinking
		else entry.thinking = edit.thinking
	}
	agents[agentName] = entry
	profile.agents = agents
	profiles[index] = profile
	const body = JSON.stringify(raw)
	const dir = dirname(path)
	const tmp = join(dir, `.model-profiles.json.tmp-${process.pid}`)
	try {
		mkdirSync(dir, { recursive: true })
		writeFileSync(tmp, body)
		renameSync(tmp, path)
		return undefined
	} catch (e) {
		try {
			rmSync(tmp, { force: true })
		} catch {
			/* best-effort cleanup */
		}
		return String(e instanceof Error ? e.message : e)
	}
}

/**
 * Commit one agent model/thinking edit through the workspace-scoped path -
 * the SINGLE write site (target decision and write share one doc read):
 * pinned profile entry when it resolves, frontmatter otherwise.
 */
export function commitAgentModelEdit(
	home: string,
	startDir: string,
	agentFile: string,
	agentName: string,
	edit: AgentEditPayload,
): AgentEditResult {
	const profile = resolvePinnedProfile(readModelProfilesDoc(home), startDir)
	if (profile !== undefined) {
		const error = saveProfileAgentOverrides(home, profile.name, agentName, edit)
		return { target: { kind: "profile", name: profile.name }, ...(error !== undefined ? { error } : {}) }
	}
	const error = updateAgentFrontmatter(agentFile, {
		model: edit.model ?? null,
		thinking: edit.thinking ?? null,
	})
	return { target: { kind: "frontmatter" }, ...(error !== undefined ? { error } : {}) }
}
