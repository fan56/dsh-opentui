/**
 * Opt-in key/input trace for input-state forensics (B2).
 *
 * Enable with `DSH_OPENTUI_KEY_TRACE=/path/to/trace.jsonl`. When the variable
 * is unset, `keyTrace` is `undefined` and every instrumentation point is a
 * single optional-call check — no file is opened, no work is done.
 *
 * The sink is deliberately tiny and self-contained: it never touches the UI,
 * never throws (a forensic aid must not crash the app), and opens the target
 * file lazily on the first actual write in append mode.
 */
import { appendFileSync } from "node:fs"

const ENV_NAME = "DSH_OPENTUI_KEY_TRACE"
const HEAD_CHARS = 32

/** Programmatic composer assignments we distinguish in the forensic log. */
export type ComposerSetSource =
  | "draft-restored"
  | "failure-refill"
  | "history"
  | "submit-clear"
  | "paste"
  | "reset"
  | "other"

export interface KeyTraceKeyEvent {
  key: string
  ctrl: boolean
  alt: boolean
  shift: boolean
  super: boolean
}

export interface KeyTraceSink {
  /** Every physical key that reaches the app (unified keymap funnel). */
  key(event: KeyTraceKeyEvent): void
  /** Composer text change reported by the textarea. */
  contentChange(len: number, head: string): void
  /** Composer programmatically assigned, with the source label. */
  composerSet(from: ComposerSetSource, len: number): void
}

/**
 * Build a sink for the given path. The file is NOT opened here: the first
 * write opens it in append mode. Write failures are swallowed (and cached so
 * a dead path does not retry on every keystroke).
 */
export function createTraceSink(path: string): KeyTraceSink {
  let failed = false
  const write = (record: Record<string, unknown>) => {
    if (failed) return
    try {
      appendFileSync(path, JSON.stringify({ t: Date.now(), ...record }) + "\n")
    } catch {
      failed = true
    }
  }
  return {
    key(event) {
      write({
        src: "key",
        key: event.key,
        ctrl: Boolean(event.ctrl),
        alt: Boolean(event.alt),
        shift: Boolean(event.shift),
        super: Boolean(event.super),
      })
    },
    contentChange(len, head) {
      write({ src: "contentChange", len, head: head.slice(0, HEAD_CHARS) })
    },
    composerSet(from, len) {
      write({ src: "composerSet", from, len })
    },
  }
}

/** Pure env resolution, exported so the opt-in gate is unit-testable. */
export function resolveTraceFromEnv(env: Record<string, string | undefined>): KeyTraceSink | undefined {
  const configured = env[ENV_NAME]
  return configured ? createTraceSink(configured) : undefined
}

/**
 * The live sink. Resolved once at import from the process environment.
 * `undefined` when the opt-in variable is unset — the disabled path.
 */
export const keyTrace: KeyTraceSink | undefined = resolveTraceFromEnv(process.env)
