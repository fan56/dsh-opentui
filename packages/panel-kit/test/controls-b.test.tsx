/**
 * controls-b.test.tsx — lane C delivery core (ConfirmDialog / Dropdown /
 * InputRow).
 *
 * Focus areas pinned here:
 *   - confirm button focus / disabled semantics (incl. the destructive
 *     variant and the double-submit guard),
 *   - the dropdown state machine (open / select / Esc closes only the popup
 *     and reports the event unconsumed so the panel is not hurt),
 *   - input-row validation and stepping boundaries (min / max / step /
 *     illegal input),
 *   - readOnly rows rejecting edits.
 *
 * The lane-B `Button` is used as-is (its visuals are spec-pinned via
 * buttonVisual, so focused / disabled / danger wiring is asserted on the
 * painted frame). Render smokes use @opentui/solid testRender with a fixture
 * PanelTheme; all colors enter through theme tokens.
 */
import { describe, expect, test } from "bun:test"
import { createComponent, testRender } from "@opentui/solid"
import type { JSX } from "solid-js"
import { RGBA } from "@opentui/core"
import type { BaseRenderable, CapturedFrame, CapturedSpan } from "@opentui/core"
import type {
  DropdownOption,
  PanelKeyCommands,
  PanelKitContextValue,
  PanelTheme,
} from "../src/contracts"

// ---------------------------------------------------------------------------
// Imports (real lane-B Button: its visuals are spec-pinned via buttonVisual,
// so focused/disabled/danger wiring is asserted on the painted frame)
// ---------------------------------------------------------------------------

const { createConfirmModel, ConfirmDialog, panelKitContext } = await import("../src/controls/confirm")
const { createDropdownModel, Dropdown, DROPDOWN_MAX_ROWS } = await import("../src/controls/dropdown")
const { createInputRowModel, InputRow, parseNumberText } = await import("../src/controls/input-row")

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function frameText(frame: CapturedFrame): string {
  return frame.lines.flatMap((line: { spans: CapturedSpan[] }) => line.spans.map((span) => span.text)).join("\n")
}

function spanFor(frame: CapturedFrame, needle: string): CapturedSpan | undefined {
  for (const line of frame.lines as { spans: CapturedSpan[] }[]) {
    for (const span of line.spans) {
      if (span.text.includes(needle)) return span
    }
  }
  return undefined
}

function near(a: number, b: number): boolean {
  return Math.abs(a - b) < 0.01
}

function color(r: number, g: number, b: number): RGBA {
  // fromValues (not fromInts / hex): fixture colors stay outside the spec
  // §7.2 grep patterns aimed at kit source literals.
  return RGBA.fromValues(r, g, b, 1)
}

function fixtureTheme(): PanelTheme {
  return {
    background: {
      surface: color(0.08, 0.08, 0.1),
      raised: color(0.12, 0.12, 0.15),
      scrim: color(0, 0, 0),
    },
    text: {
      base: color(0.9, 0.9, 0.9),
      muted: color(0.6, 0.6, 0.6),
      faint: color(0.4, 0.4, 0.4),
      accent: color(0.3, 0.5, 1),
      disabled: color(0.35, 0.35, 0.35),
      danger: color(1, 0.3, 0.3),
      warning: color(1, 0.7, 0.2),
      success: color(0.3, 0.9, 0.4),
    },
    row: { activeBg: color(0.15, 0.25, 0.5), activeFg: color(1, 1, 1) },
    border: {
      base: { style: "single", color: color(0.3, 0.3, 0.3) },
      focused: { style: "heavy", color: color(0.3, 0.5, 1) },
      warning: { style: "heavy", color: color(1, 0.7, 0.2) },
    },
    attributes: { title: 0, group: 0, selected: 0, keyHint: 0, subtitle: 0 },
    identity: [color(0.3, 0.5, 1), color(0.6, 0.3, 1)],
  }
}

interface FakeKeys {
  state: { commands?: PanelKeyCommands; disposed: number }
  adapter: NonNullable<PanelKitContextValue["keys"]>
}

function fakeKeys(): FakeKeys {
  const state: FakeKeys["state"] = { disposed: 0 }
  return {
    state,
    adapter: {
      scope(commands: PanelKeyCommands) {
        state.commands = commands
        return () => {
          state.disposed += 1
          if (state.commands === commands) state.commands = undefined
        }
      },
    },
  }
}

function fixtureKit(keys?: FakeKeys): PanelKitContextValue {
  return {
    theme: fixtureTheme,
    motion: { decorationsEnabled: () => false, fps: () => undefined, jump: () => true },
    keys: keys?.adapter,
  }
}

/**
 * The @opentui/solid element type is BaseRenderable while solid-js's JSX.Element
 * is DOM-shaped; the two are bridged at the testRender boundary (same shape
 * tui-base's render tests use).
 */
function kitRoot(kit: PanelKitContextValue, node: () => BaseRenderable): JSX.Element {
  return createComponent(panelKitContext().Provider, {
    value: kit,
    get children() {
      return node() as unknown as JSX.Element
    },
  }) as unknown as JSX.Element
}

// ---------------------------------------------------------------------------
// ConfirmDialog — button focus / disabled
// ---------------------------------------------------------------------------

describe("ConfirmDialog state machine (button focus / disabled)", () => {
  test("non-destructive focuses Confirm first; destructive focuses Cancel with danger variant", () => {
    const noop = () => {}
    const normal = createConfirmModel({ title: "t", message: "m", onConfirm: noop, onCancel: noop })
    expect(normal.active()).toBe("confirm")
    expect(normal.buttons().confirm.focused).toBe(true)
    expect(normal.buttons().cancel.focused).toBe(false)
    expect(normal.buttons().confirm.variant).toBe("primary")

    const danger = createConfirmModel({
      title: "t",
      message: "m",
      destructive: true,
      onConfirm: noop,
      onCancel: noop,
    })
    expect(danger.active()).toBe("cancel")
    expect(danger.buttons().cancel.focused).toBe(true)
    expect(danger.buttons().confirm.focused).toBe(false)
    expect(danger.buttons().confirm.variant).toBe("danger")
    expect(danger.buttons().cancel.variant).toBe("ghost")
  })

  test("left/right move the active action; labels fall back to Confirm/Cancel", () => {
    const model = createConfirmModel({ title: "t", message: "m", onConfirm: () => {}, onCancel: () => {} })
    expect(model.buttons().confirm.label).toBe("Confirm")
    expect(model.buttons().cancel.label).toBe("Cancel")
    expect(model.command("left")).toBe(true)
    expect(model.active()).toBe("cancel")
    expect(model.buttons().cancel.focused).toBe(true)
    expect(model.command("right")).toBe(true)
    expect(model.active()).toBe("confirm")
  })

  test("enter activates the focused action; escape always cancels regardless of focus", () => {
    const calls = { confirm: 0, cancel: 0 }
    const model = createConfirmModel({
      title: "t",
      message: "m",
      onConfirm: () => (calls.confirm += 1),
      onCancel: () => (calls.cancel += 1),
    })
    expect(model.command("enter")).toBe(true)
    expect(calls).toEqual({ confirm: 1, cancel: 0 })

    const escapes = { confirm: 0, cancel: 0 }
    const escModel = createConfirmModel({
      title: "t",
      message: "m",
      destructive: true, // focus on Cancel — Esc must still go through onCancel once
      onConfirm: () => (escapes.confirm += 1),
      onCancel: () => (escapes.cancel += 1),
    })
    escModel.command("left") // move focus onto Confirm: Esc must not confirm
    expect(escModel.active()).toBe("confirm")
    expect(escModel.command("escape")).toBe(true)
    expect(escapes).toEqual({ confirm: 0, cancel: 1 })
  })

  test("after a choice both buttons disable and further keys are inert (no double submit)", () => {
    const calls = { confirm: 0, cancel: 0 }
    const model = createConfirmModel({
      title: "t",
      message: "m",
      onConfirm: () => (calls.confirm += 1),
      onCancel: () => (calls.cancel += 1),
    })
    model.command("enter")
    expect(model.settled()).toBe(true)
    expect(model.buttons().confirm.disabled).toBe(true)
    expect(model.buttons().cancel.disabled).toBe(true)
    expect(model.buttons().confirm.focused).toBe(false)
    expect(model.buttons().cancel.focused).toBe(false)
    // Inert: settled swallows keys (and still reports consumed so a pending
    // close cannot race panel-level Esc handling).
    expect(model.command("enter")).toBe(true)
    expect(model.command("escape")).toBe(true)
    expect(model.command("left")).toBe(true)
    expect(model.active()).toBe("confirm") // focus did not move
    expect(calls).toEqual({ confirm: 1, cancel: 0 })
    // The disabled buttons' onPress is equally guarded.
    model.buttons().cancel.onPress()
    expect(calls).toEqual({ confirm: 1, cancel: 0 })
  })
})

// ---------------------------------------------------------------------------
// Dropdown — state machine
// ---------------------------------------------------------------------------

const DROPDOWN_OPTIONS: DropdownOption<string>[] = [
  { id: "a", label: "Alpha", value: "a" },
  { id: "b", label: "Bravo", value: "b", disabled: true },
  { id: "c", label: "Charlie", value: "c" },
  { id: "d", label: "Delta", value: "d" },
]

describe("Dropdown state machine (open / select / Esc inner-first)", () => {
  test("starts closed; enter/space open the popup; trigger label falls back to placeholder", () => {
    const changes: string[] = []
    const model = createDropdownModel<string>({
      options: DROPDOWN_OPTIONS,
      onChange: (value) => changes.push(value),
    })
    expect(model.open()).toBe(false)
    expect(model.triggerLabel()).toBe("—")
    expect(model.triggerGlyph()).toBe("▾")
    expect(model.command("enter")).toBe(true)
    expect(model.open()).toBe(true)
    expect(model.triggerGlyph()).toBe("▸")
    model.command("escape")
    expect(model.open()).toBe(false)
    expect(model.command("space")).toBe(true) // Space is the second activation key
    expect(model.open()).toBe(true)
    model.command("escape")
    expect(changes).toEqual([]) // opening never selects
  })

  test("escape closes only the popup while open and is unconsumed when closed (panel unharmed)", () => {
    const changes: string[] = []
    const model = createDropdownModel<string>({
      options: DROPDOWN_OPTIONS,
      value: "c",
      onChange: (value) => changes.push(value),
    })
    expect(model.command("escape")).toBe(false) // closed: panel's back action proceeds
    expect(model.open()).toBe(false)
    model.command("enter")
    expect(model.open()).toBe(true)
    expect(model.command("escape")).toBe(true) // open: consumed by the popup only
    expect(model.open()).toBe(false)
    expect(changes).toEqual([]) // no selection fired, nothing else touched
  })

  test("up/down walk enabled options only and clamp at the ends", () => {
    const model = createDropdownModel<string>({ options: DROPDOWN_OPTIONS, onChange: () => {} })
    model.command("enter") // open, cursor on Alpha (index 0)
    expect(model.cursor()).toBe(0)
    expect(model.command("down")).toBe(true)
    expect(model.cursor()).toBe(2) // Bravo (index 1) is disabled and skipped
    expect(model.command("down")).toBe(true)
    expect(model.cursor()).toBe(3)
    expect(model.command("down")).toBe(true)
    expect(model.cursor()).toBe(3) // clamped at the last option
    expect(model.command("up")).toBe(true)
    expect(model.cursor()).toBe(2)
    expect(model.command("up")).toBe(true)
    expect(model.cursor()).toBe(0) // disabled skipped upwards too
    expect(model.command("up")).toBe(true)
    expect(model.cursor()).toBe(0) // clamped at the first option
    // Arrows while closed are not consumed (panel navigation proceeds).
    model.command("escape")
    expect(model.command("down")).toBe(false)
  })

  test("enter selects the cursor option, fires onChange(value, option) and closes", () => {
    const changes: Array<{ value: string; id: string }> = []
    const model = createDropdownModel<string>({
      options: DROPDOWN_OPTIONS,
      value: "a",
      onChange: (value, option) => changes.push({ value, id: option.id }),
    })
    model.command("enter") // open, cursor snaps to the current value "a"
    expect(model.cursor()).toBe(0)
    model.command("down") // to Charlie
    expect(model.command("enter")).toBe(true)
    expect(changes).toEqual([{ value: "c", id: "c" }])
    expect(model.open()).toBe(false)
    // Reopening resets the cursor onto the current value.
    model.command("enter")
    expect(model.cursor()).toBe(0)
  })

  test("the popup window scrolls past 8 rows keeping the cursor visible", () => {
    const many: DropdownOption<number>[] = Array.from({ length: 12 }, (_, index) => ({
      id: `id-${index}`,
      label: `Option ${index}`,
      value: index,
    }))
    const model = createDropdownModel<number>({ options: many, onChange: () => {} })
    model.command("enter")
    for (let i = 0; i < 10; i += 1) model.command("down")
    expect(model.cursor()).toBe(10)
    const window = model.window()
    expect(window.rows).toHaveLength(DROPDOWN_MAX_ROWS)
    expect(window.start).toBe(3)
    expect(window.rows.map((row) => row.id)).toContain("id-10") // cursor stays visible
  })
})

// ---------------------------------------------------------------------------
// InputRow — validation / stepping / readOnly
// ---------------------------------------------------------------------------

describe("InputRow editing / stepping / validation", () => {
  test("text edits fire onChange per keystroke; readOnly and disabled rows reject edits", () => {
    const changes: string[] = []
    const commits: Array<string | number> = []
    const model = createInputRowModel({
      label: "name",
      kind: "text",
      value: "hi",
      onChange: (next) => changes.push(next),
      onCommit: (next) => commits.push(next),
    })
    expect(model.edit("hi!")).toBe(true)
    expect(model.text()).toBe("hi!")
    expect(changes).toEqual(["hi!"])
    expect(commits).toEqual([]) // commit mode "enter": typing never commits

    const locked = createInputRowModel({ label: "ver", readOnly: true, value: "1.2.3" })
    expect(locked.canEdit()).toBe(false)
    expect(locked.edit("hacked")).toBe(false)
    expect(locked.text()).toBe("1.2.3")
    expect(locked.commit()).toBe(false)
    expect(locked.display()).toBe("1.2.3")

    const off = createInputRowModel({ label: "name", value: "x", disabled: true })
    expect(off.edit("y")).toBe(false)
    expect(off.text()).toBe("x")
  })

  test("number stepping honors step/min/max, settles with onCommit, one step per call", () => {
    const commits: Array<string | number> = []
    const model = createInputRowModel({
      label: "retention",
      kind: "number",
      value: 8,
      min: 0,
      max: 10,
      step: 5,
      onCommit: (next) => commits.push(next),
    })
    expect(model.step(1)).toBe(true)
    expect(model.text()).toBe("10") // 8 + 5 clamped to max
    expect(model.step(-1)).toBe(true)
    expect(model.text()).toBe("5")
    expect(model.step(-1)).toBe(true)
    expect(model.text()).toBe("0") // clamped to min
    expect(model.step(-1)).toBe(true)
    expect(model.text()).toBe("0") // stays at min
    // Stepper settle commits each settled step exactly once (no fast-repeat).
    expect(commits).toEqual([10, 5, 0, 0])

    // Default step is 1; readOnly rows reject stepping entirely.
    const ones = createInputRowModel({ label: "n", kind: "number", value: 1, onCommit: () => {} })
    ones.step(1)
    expect(ones.text()).toBe("2")
    const locked = createInputRowModel({ label: "n", kind: "number", value: 1, readOnly: true, onCommit: () => {} })
    expect(locked.step(1)).toBe(false)
    expect(locked.text()).toBe("1")
  })

  test("illegal number input flags 'Invalid number' and stepping recovers from min", () => {
    const commits: Array<string | number> = []
    const model = createInputRowModel({
      label: "retention",
      kind: "number",
      value: 0,
      min: 0,
      max: 10,
      onCommit: (next) => commits.push(next),
    })
    expect(model.edit("abc")).toBe(true) // raw buffer takes the keystrokes
    expect(model.text()).toBe("abc")
    expect(model.error()).toBe("Invalid number")
    expect(model.commit()).toBe(false) // unparsable numbers never commit
    expect(commits).toEqual([])
    expect(model.step(1)).toBe(true) // recovery: unparseable base falls back to min
    expect(model.text()).toBe("1")
    expect(model.error()).toBeUndefined()
    expect(commits).toEqual([1])
  })

  test("validate errors surface under the row and clear when the value turns valid", () => {
    const model = createInputRowModel({
      label: "name",
      kind: "text",
      value: "",
      validate: (value) => (String(value).length < 3 ? "too short" : undefined),
    })
    expect(model.error()).toBe("too short")
    model.edit("ab")
    expect(model.error()).toBe("too short")
    model.edit("abcd")
    expect(model.error()).toBeUndefined()
  })

  test("commit modes gate blur/change commits; Enter always commits a valid value", () => {
    const commits: Array<string | number> = []
    const blurMode = createInputRowModel({
      label: "name",
      kind: "text",
      value: "",
      commit: "blur",
      onChange: () => {},
      onCommit: (next) => commits.push(next),
    })
    blurMode.focus()
    blurMode.edit("draft")
    expect(commits).toEqual([]) // change does not commit in blur mode
    blurMode.blur()
    expect(commits).toEqual(["draft"])

    const enterMode = createInputRowModel({
      label: "name",
      kind: "text",
      value: "",
      onCommit: (next) => commits.push(next),
    })
    enterMode.focus()
    enterMode.edit("pending")
    enterMode.blur()
    expect(commits).toEqual(["draft"]) // blur/typing never commit in enter mode
    enterMode.focus()
    expect(enterMode.commit()).toBe(true) // Enter always commits
    expect(commits).toEqual(["draft", "pending"])

    const changeMode = createInputRowModel({
      label: "name",
      kind: "text",
      value: "",
      commit: "change",
      onChange: () => {},
      onCommit: (next) => commits.push(next),
    })
    changeMode.edit("live")
    expect(commits).toEqual(["draft", "pending", "live"])
  })

  test("parseNumberText is strict about empties and junk", () => {
    expect(parseNumberText("42")).toBe(42)
    expect(parseNumberText("3.5")).toBe(3.5)
    expect(parseNumberText("")).toBeUndefined()
    expect(parseNumberText("   ")).toBeUndefined()
    expect(parseNumberText("abc")).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Render smokes (testRender): wiring + theme tokens on the painted frame
// ---------------------------------------------------------------------------

describe("controls render with theme tokens (testRender smoke)", () => {
  test("ConfirmDialog paints its message, wires focused/danger/disabled into Button, routes Esc", async () => {
    const calls = { confirm: 0, cancel: 0 }
    const keys = fakeKeys()
    const kit = fixtureKit(keys)
    const theme = fixtureTheme()
    const setup = await testRender(
      () =>
        kitRoot(kit, () =>
          createComponent(ConfirmDialog, {
            title: "Discard draft",
            message: "Delete the draft and lose all edits?",
            destructive: true,
            onConfirm: () => (calls.confirm += 1),
            onCancel: () => (calls.cancel += 1),
          }),
        ),
      { width: 60, height: 12, useMouse: false },
    )
    try {
      await setup.renderOnce()
      let frame = setup.captureSpans()
      expect(frameText(frame)).toContain("Delete the draft and lose all edits?")
      const cancelSpan = spanFor(frame, "Cancel")
      const confirmSpan = spanFor(frame, "Confirm")
      expect(cancelSpan).toBeDefined()
      expect(confirmSpan).toBeDefined()
      // Destructive: Cancel takes the initial focus → row highlight tokens.
      expect(near(cancelSpan!.bg.r, theme.row.activeBg.r)).toBe(true)
      expect(near(cancelSpan!.bg.g, theme.row.activeBg.g)).toBe(true)
      expect(near(cancelSpan!.bg.b, theme.row.activeBg.b)).toBe(true)
      // The confirm action carries the danger variant → danger text token.
      expect(near(confirmSpan!.fg.r, theme.text.danger.r)).toBe(true)
      expect(near(confirmSpan!.fg.g, theme.text.danger.g)).toBe(true)
      expect(near(confirmSpan!.fg.b, theme.text.danger.b)).toBe(true)
      // Esc through the registered scope cancels exactly once.
      keys.state.commands?.["escape"]?.()
      await setup.renderOnce()
      expect(calls).toEqual({ confirm: 0, cancel: 1 })
      // Settled: both buttons disable and paint the disabled text token.
      frame = setup.captureSpans()
      expect(near(spanFor(frame, "Cancel")!.fg.r, theme.text.disabled.r)).toBe(true)
      expect(near(spanFor(frame, "Confirm")!.fg.r, theme.text.disabled.r)).toBe(true)
    } finally {
      await setup.dispose()
    }
  })

  test("Dropdown trigger shows the value and toggles the popup through the key scope", async () => {
    const changes: string[] = []
    const keys = fakeKeys()
    const kit = fixtureKit(keys)
    const setup = await testRender(
      () =>
        kitRoot(kit, () =>
          createComponent(Dropdown, {
            label: "motion",
            options: DROPDOWN_OPTIONS,
            value: "c",
            onChange: (value: string) => changes.push(value),
          }),
        ),
      { width: 60, height: 12, useMouse: false },
    )
    try {
      await setup.renderOnce()
      let frame = frameText(setup.captureSpans())
      expect(frame).toContain("Charlie")
      expect(frame).toContain("▾")
      expect(frame).not.toContain("Alpha") // popup closed
      keys.state.commands?.["enter"]?.() // open
      await setup.renderOnce()
      frame = frameText(setup.captureSpans())
      expect(frame).toContain("Alpha")
      expect(frame).toContain("▸")
      keys.state.commands?.["escape"]?.() // popup-only close
      await setup.renderOnce()
      frame = frameText(setup.captureSpans())
      expect(frame).not.toContain("Alpha")
      expect(frame).toContain("▾")
      expect(changes).toEqual([])
    } finally {
      await setup.dispose()
    }
  })

  test("InputRow paints validation errors in theme.text.danger and readOnly rows as static text", async () => {
    const keys = fakeKeys()
    const kit = fixtureKit(keys)
    const theme = fixtureTheme()
    const setup = await testRender(
      () =>
        kitRoot(kit, () =>
          createComponent(InputRow, {
            label: "retention",
            kind: "number",
            value: "abc",
          }),
        ),
      { width: 60, height: 12, useMouse: false },
    )
    try {
      await setup.renderOnce()
      const frame = setup.captureSpans()
      const errorSpan = spanFor(frame, "Invalid number")
      expect(errorSpan).toBeDefined()
      // Red hint rides the theme danger token (no literal colors in the kit).
      expect(near(errorSpan!.fg.r, theme.text.danger.r)).toBe(true)
      expect(near(errorSpan!.fg.g, theme.text.danger.g)).toBe(true)
      expect(near(errorSpan!.fg.b, theme.text.danger.b)).toBe(true)
    } finally {
      await setup.dispose()
    }
  })
})
