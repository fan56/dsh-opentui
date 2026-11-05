/**
 * The engine wrapper: owns the OpenTUI renderer lifecycle and keeps foreign
 * stdout writes (host loggers, libraries) from corrupting the frame stream.
 *
 * OpenTUI does not intercept process.stdout by default (verified in M0):
 * raw writes pass straight through to the terminal. The renderer is created
 * with externalOutputMode "passthrough" — the same posture opencode uses —
 * and the Runtime additionally swaps console.* and process.stdout.write
 * while the TUI is mounted so host noise lands in the built-in terminal
 * console instead of on the frame stream.
 */
import { createCliRenderer, type CliRenderer } from "@opentui/core"

export interface EngineOptions {
  /** Called after the renderer is ready; receives it for scene mounting. */
  onReady?: (renderer: CliRenderer) => void
  /** Called on renderer teardown (user quit, terminal closed). */
  onExit?: (reason: string) => void
  /** Pass false for tests: stdout is NOT captured, renderer still runs. */
  captureStdout?: boolean
}

export interface StdoutCapture {
  restore(): void
  /** Lines captured since mount, for assertions in tests. */
  lines(): string[]
}

export async function mountEngine(options: EngineOptions = {}): Promise<{ renderer: CliRenderer; capture: StdoutCapture }> {
  const renderer = await createCliRenderer({
    externalOutputMode: "passthrough",
    exitOnCtrlC: false,
    autoFocus: false,
    // Terminal-native drag-select + copy (Ghostty Cmd+C): mouse reporting
    // OFF. The TUI never claims the mouse; in-app wheel scroll is therefore
    // unavailable (scrollback moves via PgUp/PgDn keybinds instead).
    useMouse: false,
  })

  // Capture AFTER the renderer exists: the renderer holds its own stdout
  // reference, so console.* swapping is safe but touching process.stdout
  // here would starve the render loop (learned in M1: blank frames).
  const capture = captureConsoleWhileMounted(options.captureStdout !== false)

  renderer.on("exit", (reason: unknown) => {
    capture.restore()
    options.onExit?.(String(reason ?? "exit"))
  })

  options.onReady?.(renderer)
  return { renderer, capture }
}

/** Tear the engine down: stop capture, destroy renderer, await final flush. */
export async function unmountEngine(renderer: CliRenderer, capture: StdoutCapture): Promise<void> {
  capture.restore()
  renderer.destroy?.()
  await renderer.closed.catch(() => {})
}

function captureConsoleWhileMounted(enabled: boolean): StdoutCapture {
  const captured: string[] = []
  if (!enabled) return { restore() {}, lines: () => captured }

  const origConsoleLog = console.log
  const origConsoleError = console.error
  const origConsoleWarn = console.warn
  const origConsoleInfo = console.info

  const sink = (prefix: string) => (...args: unknown[]) => {
    captured.push(prefix + args.map(String).join(" "))
  }

  console.log = sink("[log]")

  return {
    restore() {
      console.log = origConsoleLog
      console.error = origConsoleError
      console.warn = origConsoleWarn
      console.info = origConsoleInfo
    },
    lines: () => [...captured],
  }
}
