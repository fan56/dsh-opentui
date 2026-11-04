/** Shared fake for the ShellHost last-prompt FT: a ShellSessionSurface
 * stand-in whose turn() parks on a manual deferred, so the test decides
 * exactly when the turn's `finally` block runs. */
import type { ShellSessionSurface } from "../src/client/shell-session.ts"
import type { TurnCallbacks } from "../src/agent/loop.ts"

export type FakePromptSession = ShellSessionSurface & {
  resolveTurn(): void
  turnCount(): number
}

export function makeFakePromptSession(): FakePromptSession {
  let turnCb: TurnCallbacks | null = null
  let resolvePending: (() => void) | null = null
  let turns = 0
  const session: ShellSessionSurface = {
    label: "fake/provider model",
    usage: { prompt: 0, completion: 0, cacheRead: 0, cacheWrite: 0 },
    remoteTailSink: null,
    turn(_userText: string, cb: TurnCallbacks) {
      turns++
      turnCb = cb
      return new Promise<void>((resolve) => {
        resolvePending = resolve
      })
    },
    steer() {},
    abort() {},
    newSession() {},
    resumeSession(): "ok" | "owned" {
      return "ok"
    },
    registerAskProvider() {},
    cacheHitRate(): number | null {
      return null
    },
    usageSummary(): string[] {
      return []
    },
    configLoad(): Record<string, unknown> {
      return {}
    },
    configSave(patch: Record<string, unknown>): Record<string, unknown> {
      return patch
    },
    switchModel() {},
    async listProviders() {
      return []
    },
    async listPresets() {
      return []
    },
    switchPreset() {},
    currentPresetId(): string | undefined {
      return undefined
    },
    executionMode(): "native" | "ptc" {
      return "native"
    },
    async listSessions() {
      return []
    },
    async storedTranscript() {
      return []
    },
    async searchSessions() {
      return []
    },
    historyTurns() {
      return []
    },
    async forkAtTurn() {
      return { items: [], turn: 0 }
    },
    async listHostCommands() {
      return []
    },
    async executeHostCommand() {
      return undefined
    },
    listPlugins() {
      return []
    },
    listSkills() {
      return []
    },
    async credentialStatus() {
      return { configured: false }
    },
    async login() {},
    async logout() {},
    async settingsDescribe() {
      return []
    },
    async reloadPlugins() {
      return undefined
    },
    childTranscript(): string[] {
      return []
    },
    steerChild(): boolean {
      return false
    },
    listAgents() {
      return []
    },
    agentSet() {},
    repairScan(): string[] {
      return []
    },
    async btwAsk() {
      return ""
    },
    async attachImage() {
      return ""
    },
    async startRemoteTail() {
      return "unsupported"
    },
    stopRemoteTail() {},
  }
  return Object.assign(session, {
    resolveTurn() {
      turnCb?.onTurnEnd?.({ prompt: 1, completion: 1 })
      turnCb = null
      resolvePending?.()
      resolvePending = null
    },
    turnCount: () => turns,
  })
}
