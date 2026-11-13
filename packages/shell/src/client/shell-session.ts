/**
 * The session surface the rendering layer consumes — the client-mode
 * ShellHostDeps seam (ADR-0005 bucket (c)).
 *
 * ShellHost + its features touch exactly these members of the session
 * object they are handed. Client mode feeds `RemoteHostSession`
 * (client-entry.tsx). This file keeps that cast honest:
 * `_RemoteHostSessionConforms` fails tsc when RemoteHostSession drifts
 * away from the surface ShellHost actually uses, instead of letting the
 * drift surface as a boot crash.
 *
 * Signatures are written against the consumer's needs.
 */
import type { StoredTranscriptRow } from "./seam-types.ts"
import type { TurnCallbacks } from "../agent/loop.ts"
import type { RemoteHostSession } from "./remote-host-session.ts"
import type { BrokenSessionLog, RepairSessionLogResult } from "./remote-local-fs.ts"

export interface ShellSessionSurface {
	/** Powerline route segment + label signal seed; "reconnecting…" swap. */
	label: string
	/** Cumulative usage (assignment semantics); the status-bar 🧠 context
	 * size is prompt + cacheRead + cacheWrite (wave-2 wire finding). */
	usage: { prompt: number; completion: number; cacheRead: number; cacheWrite: number }
	/** Remote tail sink (ShellHost assigns it; /tail replays rows). */
	remoteTailSink: ((rows: { kind: string; text: string; final: boolean }[]) => void) | null

	turn(userText: string, cb: TurnCallbacks, signal?: AbortSignal): Promise<void>
	steer(userText: string): void
	abort(): void
	newSession(): void
	resumeSession(id: string): "ok" | "owned"
	registerAskProvider(onAsk: (q: { id: string; prompt: string; options: string[] }[]) => Promise<{ questionId: string; selected: string }[]>): void

	cacheHitRate(mode?: "session" | "lastMessage"): number | null
	usageSummary(): string[]

	// config + keybindings (wave-3 seam: profile base ⊕ workspace overlay ⊕ env)
	configLoad(): Record<string, unknown>
	configSave(patch: Record<string, unknown>): Record<string, unknown>
	keybindingsLoad?(): Record<string, string>

	// model
	switchModel(provider: string, model: string, reasoningEffort?: string): void
	listProviders(): Promise<{ provider: string; models: string[] }[]>

	// presets
	listPresets(): Promise<{ id: string; name: string }[]>
	switchPreset(presetId: string): void
	currentPresetId(): string | undefined
	executionMode(): "native" | "ptc"

	// sessions / history
	listSessions(limit?: number): Promise<{ id: string; title: string; updatedAt?: string }[]>
	/** Replayed rows include the ask_user_question Q&A rows ("ask") —
	 * the durable tool pair replays on resume/fork. */
	storedTranscript(id: string, skip?: number): Promise<StoredTranscriptRow[]>
	searchSessions(query: string): Promise<{ id: string; snippet: string }[]>
	historyTurns(): { turn: number; seqEnd: number; preview: string }[]
	forkAtTurn(seqEnd: number): Promise<{ items: StoredTranscriptRow[]; turn: number }>

	// host commands / plugins / skills / settings
	listHostCommands(): Promise<{ name: string; description: string }[]>
	executeHostCommand(line: string): Promise<{ text?: string } | undefined>
	listPlugins(): { name: string; version: string }[]
	/** Cached /skills rows (sync; refreshSkills varies per mode and stays off this seam). */
	listSkills(): { name: string; description: string; invocation: string }[]
	credentialStatus(ref: string): Promise<{ configured: boolean }>
	login(ref: string, apiKey: string): Promise<void>
	logout(ref: string): Promise<void>
	settingsDescribe(): Promise<{ ns: string; revision?: number; value?: unknown }[]>
	/** Settings seam for the login feature's route registration (optional — absent = read-only). */
	settingsSeam?: { describe(): Promise<any>; mutate(ns: string, ops: unknown[], revision?: number): Promise<void> }
	reloadPlugins(): Promise<string | undefined>

	// dock / panels
	childTranscript(id: string): string[]
	steerChild(id: string, text: string): boolean
	listAgents(): { name: string; displayName?: string; description?: string; model?: string; thinking?: string; deep: number; body: string; file: string; pin?: string; broken?: string }[]
	agentSet(name: string, field: "model" | "thinking" | "deep", value: string | null): { target: { kind: "profile"; name: string } | { kind: "frontmatter" }; error?: string }
	agentBody(name: string): string
	modelEfforts(providerID: string, modelID: string): Promise<{ id: string; name: string; description?: string }[]>
	repairScan(): string[]
	/** C13 /resume repair flow, probe half: broken session logs with paths
	 * (client-local, /repair topology). Optional — a surface without it
	 * keeps the /resume picker repair-free. */
	repairScanBroken?(): BrokenSessionLog[]
	/** C13 /resume repair flow, apply half: guarded plain-jsonl tail repair
	 * (original moved to `.corrupt-bak` first). Optional — the explicit
	 * user confirmation lives in the /resume caller, never here. */
	repairSessionLog?(path: string): RepairSessionLogResult
	btwAsk(question: string, snapshot: string[], onDelta?: (full: string) => void): Promise<string>
	attachImage(path: string): Promise<string>

	// remote tail
	startRemoteTail(sessionId: string): Promise<string | undefined>
	stopRemoteTail(): void
}

/** Compile-time conformance guard (see file header): fails tsc on drift. */
type _RemoteHostSessionConforms = RemoteHostSession extends ShellSessionSurface ? true : false
const _remoteHostSessionConforms: _RemoteHostSessionConforms = true
export type { _RemoteHostSessionConforms }

