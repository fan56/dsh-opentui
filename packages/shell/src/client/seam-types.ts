/**
 * Transcript row types shared across the client seam (batch C2): moved
 * VERBATIM out of the deleted `@dsh-opentui/kit` (shell-parts.tsx) — the
 * only kit artifacts the surviving client graph still referenced were
 * these three types. The v2 view (tui-base) renders structurally
 * compatible rows; these live here so shell's tsc program never pulls
 * tui-base sources (the resolution law from the batch-9a/10a entries).
 */

export type TranscriptItem =
  | { kind: "user"; text: string }
  | { kind: "assistant"; text: string; final?: boolean }
  | { kind: "thinking"; tail: string; chars: number }
  | { kind: "tool"; name: string; args: string; ok: boolean; brief: string; imagePath?: string }
  | { kind: "ask"; entries: AskEntry[] }
  | { kind: "error"; text: string }
  | { kind: "system"; text: string }

/** One Q&A row of an `ask_user_question` transcript block (the tool
 * call carries the questions/options, the tool result the selection).
 * Additive kind — persisted items without it keep rendering. */
export interface AskEntry {
  /** The question text. */
  question: string
  /** The option labels offered (rendered dimmed). */
  options: string[]
  /** The labels the user picked (empty when declined). */
  selected: string[]
  /** Free-text answer carried by the result (the declined marker lands here). */
  custom?: string
  /** True when the question got no user selection (declined / timed out). */
  declined: boolean
}

/** The transcript-row subset durable replays (resume/fork) may hand back.
 * Batch V1: settled `tool` rows join — the view's tool block replays the
 * call's name/args brief/result instead of degrading to a bare name. */
export type StoredTranscriptRow = Extract<TranscriptItem, { kind: "user" | "assistant" | "ask" | "tool" }>
