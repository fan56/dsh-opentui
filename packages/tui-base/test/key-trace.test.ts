import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  createTraceSink,
  keyTrace,
  resolveTraceFromEnv,
  type ComposerSetSource,
  type KeyTraceSink,
} from "../src/util/key-trace"

const SOURCES: readonly ComposerSetSource[] = [
  "draft-restored",
  "failure-refill",
  "history",
  "submit-clear",
  "paste",
  "reset",
  "other",
]

const src = (relative: string) => readFileSync(join(import.meta.dir, "..", relative), "utf8")

const dirs: string[] = []
function tempPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "b2-key-trace-"))
  dirs.push(dir)
  return join(dir, "trace.jsonl")
}
function lines(path: string): Array<Record<string, unknown>> {
  return readFileSync(path, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line))
}

afterEach(() => {
  while (dirs.length) {
    const dir = dirs.pop()!
    if (dir.startsWith(join(tmpdir(), "b2-key-trace-"))) rmSync(dir, { recursive: true, force: true })
  }
})

describe("B2 opt-in key/input trace", () => {
  test("E1: env unset → no live sink, no file, no registered interceptor", () => {
    expect(keyTrace).toBeUndefined()
    expect(resolveTraceFromEnv({})).toBeUndefined()
    expect(resolveTraceFromEnv({ DSH_OPENTUI_KEY_TRACE: "" })).toBeUndefined()

    const dir = mkdtempSync(join(tmpdir(), "b2-key-trace-"))
    dirs.push(dir)
    // A disabled sink never exists, so no call can create a file.
    resolveTraceFromEnv({})?.key({ key: "a", ctrl: false, alt: false, shift: false, super: false })
    expect(readdirSync(dir)).toHaveLength(0)

    const keymap = src("src/context/keymap.tsx")
    expect(keymap).toMatch(/if \(keyTrace\) \{[\s\S]{0,400}?keymap\.intercept\("key"/)
  })

  test("E2: key line carries exact key identity and modifiers", () => {
    const path = tempPath()
    const sink = createTraceSink(path)
    sink.key({ key: "a", ctrl: true, alt: false, shift: true, super: false })
    const [line] = lines(path)
    expect(typeof line.t).toBe("number")
    expect(Number.isInteger(line.t)).toBe(true)
    expect(line).toEqual({
      t: line.t,
      src: "key",
      key: "a",
      ctrl: true,
      alt: false,
      shift: true,
      super: false,
    })
    expect(Object.hasOwn(line, "len")).toBe(false)
    expect(Object.hasOwn(line, "head")).toBe(false)
  })

  test("E3: contentChange line and 32-char head cap", () => {
    const path = tempPath()
    const sink = createTraceSink(path)
    sink.contentChange(40, "1234567890".repeat(4))
    const [line] = lines(path)
    expect(line.src).toBe("contentChange")
    expect(line.len).toBe(40)
    expect(line.head).toBe("1234567890".repeat(4).slice(0, 32))
    expect((line.head as string).length).toBe(32)
  })

  test("E4: every composerSet source writes a valid line and every set site is labelled", () => {
    const path = tempPath()
    const sink = createTraceSink(path)
    for (const from of SOURCES) sink.composerSet(from, 0)
    const written = lines(path)
    expect(written).toHaveLength(SOURCES.length)
    expect(written.map((line) => line.src)).toEqual(SOURCES.map(() => "composerSet"))
    expect(new Set(written.map((line) => line.from))).toEqual(new Set(SOURCES))
    expect(written.every((line) => line.len === 0)).toBe(true)

    const prompt = src("src/component/prompt/index.tsx")
    for (const from of SOURCES) expect(prompt).toContain(`"${from}"`)
    expect(prompt).toContain("keyTrace?.composerSet")
    expect(prompt).toContain("keyTrace?.contentChange")
    // Every programmatic assignment is immediately followed by a trace label.
    const rows = prompt.split("\n")
    const setRows = rows.flatMap((row, i) => (/^\s*input\.(setText|insertText|clear)\(/.test(row) ? [i] : []))
    expect(setRows.length).toBeGreaterThanOrEqual(14)
    for (const i of setRows) expect(rows[i + 1]).toContain("traceSet(")
  })

  test("E5: unwritable path is silent — no throw on any call", () => {
    const sink: KeyTraceSink = createTraceSink(join(tmpdir(), "b2-no-such-dir-xyz", "trace.jsonl"))
    expect(() => sink.key({ key: "q", ctrl: false, alt: false, shift: false, super: false })).not.toThrow()
    expect(() => sink.contentChange(1, "q")).not.toThrow()
    expect(() => sink.composerSet("other", 0)).not.toThrow()
  })

  test("E6: lazy open on first write, then append without overwrite", () => {
    const path = tempPath()
    const sink = createTraceSink(path)
    expect(existsSync(path)).toBe(false)
    sink.key({ key: "1", ctrl: false, alt: false, shift: false, super: false })
    expect(existsSync(path)).toBe(true)
    sink.contentChange(1, "2")
    sink.composerSet("other", 0)
    const written = lines(path)
    expect(written).toHaveLength(3)
    expect(written.map((line) => line.src)).toEqual(["key", "contentChange", "composerSet"])
  })
})
