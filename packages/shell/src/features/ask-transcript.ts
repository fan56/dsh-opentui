/**
 * Feature: the `ask_user_question` transcript record (pure logic, no JSX).
 *
 * The model's question arrives as a durable `tool/call` event (arguments
 * JSON: `{questions: [{id, question, header?, options?: [{label,
 * description?}], multi_select?}]}` — the dsh-user-questions tool
 * schema) and the user's answer as the paired `tool/result` event whose
 * text block carries `{answers: [{id, selected[], custom?}]}` (the same
 * batch the ask overlay returns, declined included as
 * `{selected: [], custom: "declined"}`). Rendering both halves as one
 * Q&A transcript block keeps the exchange readable in the message flow
 * AND replayable from the journal on resume/fork — the overlay is
 * ephemeral, the journal is not.
 *
 * Why the answer can need a fallback: the live transcript pipeline caps
 * the result brief at 300 chars (host-session.ts + remote-follow.ts
 * parity), which can truncate a multi-question batch. The ask overlay
 * therefore stashes its own picks (ShellHost wiring) and
 * buildAskTranscriptItem prefers the parsed result, falling back to the
 * stash. With NEITHER available the block is skipped entirely — no
 * fabricated answers on the transcript (a hard-failed result renders
 * declined, the honest outcome of an errored ask).
 */
import type { AskEntry, TranscriptItem } from "../client/seam-types.ts"

/** The dsh user-questions tool name (tool/call + tool/result events). */
export const ASK_TOOL_NAME = "ask_user_question"

/** One answer row of the result batch (`AskUserQuestionAnswerItem`). */
export interface AskAnswer {
  id: string
  selected: string[]
  custom?: string
}

/** The overlay's pick row (host-session registerAskProvider shape). */
export interface AskPick {
  questionId: string
  selected: string
}

/** A parsed tool/call question row with its wire id kept for the merge. */
export interface ParsedAskQuestion {
  id: string
  entry: AskEntry
}

/**
 * Parse the tool/call arguments into question rows (answers unfilled).
 * Accepts the wire schema (`question`, `header`, option objects with
 * `label`) and tolerates the simplified overlay shape (`prompt`, plain
 * string options). Returns undefined when nothing readable remains —
 * the caller then renders nothing rather than a broken block.
 */
export function parseAskCallArgs(args: string): ParsedAskQuestion[] | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(args)
  } catch {
    return undefined
  }
  if (typeof parsed !== "object" || parsed === null) return undefined
  const questions = (parsed as Record<string, unknown>).questions
  if (!Array.isArray(questions) || questions.length === 0) return undefined
  const out: ParsedAskQuestion[] = []
  for (const q of questions) {
    if (typeof q !== "object" || q === null) continue
    const item = q as Record<string, unknown>
    const id = typeof item.id === "string" ? item.id : ""
    const question = typeof item.question === "string" && item.question
      ? item.question
      : typeof item.prompt === "string" && item.prompt
        ? item.prompt
        : undefined
    if (question === undefined) continue
    const header = typeof item.header === "string" && item.header ? item.header : undefined
    const rawOptions = Array.isArray(item.options) ? item.options : []
    const options = rawOptions
      .map((o) => (typeof o === "string" ? o : typeof (o as Record<string, unknown>)?.label === "string" ? ((o as Record<string, unknown>).label as string) : ""))
      .filter((o) => o !== "")
    out.push({
      id,
      entry: {
        question: header !== undefined && header !== question ? `${header}: ${question}` : question,
        options,
        selected: [],
        declined: false,
      },
    })
  }
  return out.length > 0 ? out : undefined
}

/** Text blocks of a message/content array (block type `text`). */
function textBlocks(content: unknown): string[] {
  if (!Array.isArray(content)) return []
  return content
    .filter((b) => typeof b === "object" && b !== null && (b as Record<string, unknown>).type === "text")
    .map((b) => (b as Record<string, unknown>).text)
    .filter((t): t is string => typeof t === "string")
}

/** Row-mapping half of parseAskAnswers: strict enough to reject truncated
 * batches (a sliced JSON never parses, a partial row fails the checks). */
function answersOfBatch(value: unknown): AskAnswer[] | undefined {
  if (typeof value !== "object" || value === null) return undefined
  const answers = (value as Record<string, unknown>).answers
  if (!Array.isArray(answers)) return undefined
  const out: AskAnswer[] = []
  for (const a of answers) {
    if (typeof a !== "object" || a === null) return undefined
    const row = a as Record<string, unknown>
    if (typeof row.id !== "string" || !Array.isArray(row.selected)) return undefined
    const selected = row.selected.filter((s): s is string => typeof s === "string")
    const custom = typeof row.custom === "string" ? row.custom : undefined
    out.push(custom !== undefined ? { id: row.id, selected, custom } : { id: row.id, selected })
  }
  return out
}

/**
 * Parse the answer batch out of any of the shapes the pipeline produces:
 * the result text JSON `{answers: [...]}` directly, a JSON STRING of it
 * (truncated strings fail the parse and return undefined), the
 * `tool/result` event's `message` (content text blocks), a bare
 * `content` array, or the whole event data. undefined = no usable batch.
 */
export function parseAskAnswers(value: unknown): AskAnswer[] | undefined {
  if (typeof value === "string") {
    try {
      return parseAskAnswers(JSON.parse(value))
    } catch {
      return undefined
    }
  }
  if (typeof value !== "object" || value === null) return undefined
  const rec = value as Record<string, unknown>
  const direct = answersOfBatch(rec)
  if (direct !== undefined) return direct
  const message = typeof rec.message === "object" && rec.message !== null ? (rec.message as Record<string, unknown>) : undefined
  const content = message?.content ?? rec.content
  for (const text of textBlocks(content)) {
    const batch = parseAskAnswers(text)
    if (batch !== undefined) return batch
  }
  if (message !== undefined) return parseAskAnswers(message)
  return undefined
}

/**
 * Merge the parsed question rows with the answer sources into the
 * transcript item. Answer resolution per question: the parsed result
 * batch first (authoritative — it is what the tool returned), then the
 * overlay's stashed pick; a settled batch missing a row, or a
 * hard-failed result, marks the question declined. With NO answer
 * evidence at all (no batch, no stash, result ok) the item is skipped
 * (undefined) so the transcript never invents an outcome — callers
 * only reach that when the brief was truncated AND the stash window
 * was empty (externally answered ask).
 */
export function buildAskTranscriptItem(
  questions: ParsedAskQuestion[],
  answers: AskAnswer[] | undefined,
  picks: AskPick[] | undefined,
  ok: boolean,
): TranscriptItem | undefined {
  const settled = answers !== undefined
  const entries: AskEntry[] = questions.map(({ id, entry }) => {
    const ans = settled ? answers!.find((a) => a.id === id) : undefined
    const pick = picks?.find((p) => p.questionId === id)
    if (ans !== undefined) {
      return {
        ...entry,
        selected: ans.selected,
        ...(ans.custom !== undefined ? { custom: ans.custom } : {}),
        declined: ans.selected.length === 0 && (ans.custom === undefined || ans.custom === "declined"),
      }
    }
    if (pick !== undefined) return { ...entry, selected: [pick.selected], declined: false }
    // settled batch without this question's row, no stash pick, or a
    // failed result: the call closed with no answer for it
    return { ...entry, selected: [], declined: true }
  })
  // Evidence rule: render when the result batch parsed, the overlay stash
  // exists (it describes THIS ask — cleared at call start), or the result
  // hard-failed; skip when nothing observed the outcome.
  const evidence = settled || picks !== undefined || !ok
  if (!evidence) return undefined
  return { kind: "ask", entries }
}
