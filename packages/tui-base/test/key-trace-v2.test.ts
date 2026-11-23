/**
 * B2 followup — the composer-side trace hooks must live on the SHIPPED v2
 * route (examples/v2-entry.tsx → routes/session/session-composer.tsx), not
 * only on the v1 Prompt the release bundle never mounts.
 *
 * V1 enum compatibility, V2 contentChange funnel, V3 per-assignment source
 * labels, V4 disabled-env zero behaviour. Source assertions mirror the
 * preregistered expected in .proof/b2b-trace-v2/00-preregistered-expected.md.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createTraceSink, keyTrace, resolveTraceFromEnv } from "../src/util/key-trace"

const src = (relative: string) => readFileSync(join(import.meta.dir, "..", relative), "utf8")
const COMPOSER = "src/routes/session/session-composer.tsx"
const TRACE = "src/util/key-trace.ts"
const V1_PROMPT = "src/component/prompt/index.tsx"

const SOURCES = [
  "draft-restored",
  "failure-refill",
  "history",
  "submit-clear",
  "steer-queue",
  "ctrl-c-clear",
  "paste",
  "reset",
  "other",
] as const

const dirs: string[] = []
function tempPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "b2b-v2-trace-"))
  dirs.push(dir)
  return join(dir, "trace.jsonl")
}
afterEach(() => {
  while (dirs.length) {
    const dir = dirs.pop()!
    if (dir.startsWith(join(tmpdir(), "b2b-v2-trace-"))) rmSync(dir, { recursive: true, force: true })
  }
})

describe("V1: source vocabulary keeps v1 and adds steer-queue + ctrl-c-clear", () => {
  test("all nine sources present in the enum, sink writes steer-queue", () => {
    const traceSrc = src(TRACE)
    for (const from of SOURCES) expect(traceSrc).toContain(`"${from}"`)
    expect(traceSrc).toMatch(/B2 followup[\s\S]{0,200}steer-queue/)
    // A2: the shipped v2 clear-on-ctrl+c path has its own explicit source.
    expect(traceSrc).toContain('"ctrl-c-clear"')
    expect(src("examples/v2-entry.tsx")).toContain('keyTrace?.composerSet("ctrl-c-clear", 0)')

    const path = tempPath()
    const sink = createTraceSink(path)
    sink.composerSet("steer-queue", 7)
    const line = JSON.parse(readFileSync(path, "utf8").trim())
    expect(line.src).toBe("composerSet")
    expect(line.from).toBe("steer-queue")
    expect(line.len).toBe(7)
  })
})

describe("V2: SessionComposer textarea onContentChange → contentChange", () => {
  test("trace call sits inside the shipped composer's onContentChange", () => {
    const composer = src(COMPOSER)
    expect(composer).toContain('import { keyTrace, type ComposerSetSource } from "../../util/key-trace"')
    const block = composer.match(/onContentChange=\{\(\) => \{[\s\S]*?\}\}/)
    expect(block).not.toBeNull()
    expect(block![0]).toContain("const value = textarea.plainText")
    expect(block![0]).toContain("keyTrace?.contentChange(value.length, value)")
  })

  test("contentChange line is exact and head-capped", () => {
    const path = tempPath()
    const sink = createTraceSink(path)
    sink.contentChange(40, "0123456789".repeat(4))
    const line = JSON.parse(readFileSync(path, "utf8").trim())
    expect(line.src).toBe("contentChange")
    expect(line.len).toBe(40)
    expect(line.head).toBe("0123456789".repeat(4).slice(0, 32))
  })
})

describe("V3: every programmatic assignment carries its frozen source", () => {
  test("all 7 setText sites have an adjacent traceSet label", () => {
    const rows = src(COMPOSER).split("\n")
    const setRows = rows.flatMap((row, i) => (/\.setText\(/.test(row) ? [i] : []))
    expect(setRows).toHaveLength(7)
    for (const i of setRows) {
      const next = rows.slice(i + 1, i + 3).find((row) => row.trim().length > 0) ?? ""
      expect(next.trim()).toMatch(/^traceSet\(/)
    }
  })

  test("source labels match the preregistered mapping", () => {
    const composer = src(COMPOSER)
    // ↑ / ↓ history recall (2)
    expect(composer).toContain('traceSet("history", step.text)')
    expect(composer.match(/traceSet\("history", step\.text\)/g)).toHaveLength(2)
    // idle submit clear (1)
    expect(composer).toContain('traceSet("submit-clear", "")')
    // busy chooser: steer/queue gets its own source, sent falls back
    expect(composer).toContain('traceSet(result === "sent" ? "submit-clear" : "steer-queue", "")')
    // slash apply rewrite + command clear + tab completion (3)
    expect(composer).toContain('traceSet("other", text)')
    expect(composer).toContain('traceSet("other", "")')
    expect(composer).toContain('traceSet("other", result.text)')
    expect(composer.match(/traceSet\("other",/g)).toHaveLength(3)
  })

  test("v1 Prompt instrumentation is preserved untouched", () => {
    const prompt = src(V1_PROMPT)
    expect(prompt).toContain("keyTrace?.composerSet")
    expect(prompt).toContain("keyTrace?.contentChange")
  })
})

describe("V4: disabled env = zero behaviour change", () => {
  test("no live sink, no file, and only optional-call trace sites", () => {
    expect(keyTrace).toBeUndefined()
    expect(resolveTraceFromEnv({})).toBeUndefined()
    const dir = mkdtempSync(join(tmpdir(), "b2b-v2-trace-"))
    dirs.push(dir)
    resolveTraceFromEnv({})?.contentChange(1, "x")
    expect(readdirSync(dir)).toHaveLength(0)

    const composer = src(COMPOSER)
    expect(composer).not.toMatch(/keyTrace\.(?!\?)/) // no bare dereference
    expect(composer.match(/keyTrace\?\./g)).toHaveLength(2) // helper + contentChange call
  })
})
