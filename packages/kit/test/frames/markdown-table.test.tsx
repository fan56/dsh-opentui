/**
 * FT: the rich following-mode transcript renders REAL markdown — table
 * borders, item spacers — and anchors to the bottom (the regressions the
 * user caught: plain-text line window cut tables in half and glued items
 * together with no blank line).
 */
import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { TranscriptWindow } from "../../src/shell-parts.tsx"
import { defaultTheme } from "../../src/theme.ts"

const TABLE_MD = [
  "| 语言 | 年份 |",
  "| --- | --- |",
  "| Python | 1991 |",
  "| Go | 2009 |",
  "",
  "总结一句话。",
].join("\n")

test("following mode: markdown table renders with borders + item spacers", async () => {
  const setup = await testRender(
    () => (
      <box style={{ flexDirection: "column", width: 60, height: 20 }}>
        <TranscriptWindow
          items={[
            { kind: "user", text: "列个表格" },
            { kind: "assistant", text: TABLE_MD, final: true },
          ]}
          theme={defaultTheme}
          t={(k) => k}
          spinnerFrame=""
          viewportRows={18}
          offset={0}
        />
      </box>
    ),
    { width: 60, height: 20, kittyKeyboard: true, exitOnCtrlC: false },
  )
  // The <markdown> intrinsic paints through the async tree-sitter highlight
  // pipeline (its no-syntaxStyle fallback included), so a fixed sleep races
  // it on slow runners — ubuntu CI caught the trailing paragraph missing at
  // 150ms while arm64/mac had it at ~30ms. Poll real frames on a TIMER
  // (not the renderer scheduler: its idle signal fires before the highlight
  // fallback's final repaint, so waitForFrame exits early) until the last
  // block paints, bounded by a deadline; captureCharFrame can throw while
  // the renderer holds the buffer lease mid-paint — treat that as "not yet".
  const deadline = Date.now() + 5000
  let frame = ""
  for (;;) {
    await new Promise((r) => setTimeout(r, 50))
    try {
      frame = setup.captureCharFrame()
    } catch {
      continue
    }
    if (frame.includes("总结一句话") || Date.now() > deadline) break
  }
  await setup.dispose()
  const lines = frame.split("\n")
  // real table structure, not raw pipes
  expect(frame).toContain("┌")
  expect(frame).toContain("│Python")
  expect(frame).toContain("└")
  expect(frame).not.toMatch(/\| --- \|/)
  // user row present with its mark
  expect(frame).toContain("❯ 列个表格")
  // summary paragraph after the table
  expect(frame).toContain("总结一句话")
  // bottom anchor: the LAST painted row is within 2 rows of the box bottom
  const paintedIdx = lines.map((l, i) => ({ l, i })).filter(({ l }) => l.trim().length > 0)
  const last = paintedIdx[paintedIdx.length - 1]!
  expect(lines.length - last.i).toBeLessThanOrEqual(6)
})
