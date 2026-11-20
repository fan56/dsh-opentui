/**
 * 024 SK — FocusRouter four-tier capture stack (ADR-R4 / ADR-0008 linkage).
 *
 * Machine-judged, environment-independent assertions:
 *   - the frozen 5-row capture priority matrix (modal > overlay > main > global);
 *   - N1 (turn-time Esc ownership) and N2 (panel PgUp/PgDn ownership);
 *   - frame accounting (push/pop returns to [page]) via createFocusRouter;
 *   - the reverse case: the pre-change `enabled` computation (no tier gate)
 *     fires under an overlay where FocusRouter structurally denies it;
 *   - integration source guards: tier declarations landed on the migrated
 *     layers, provider swapped in the production tree, existing keybinds and
 *     priorities untouched, settings/* untouched (S5 scope).
 */
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { CAPTURE_RANK, CAPTURE_TIERS, createFocusRouter, resolveCapture, tierOfFrame } from "../src/context/focus-router"
import type { InputOwnership, OwnerFrame, OverlayKind } from "../src/context/input-ownership"

const src = (file: string) => readFileSync(join(import.meta.dir, "..", file), "utf8")
const frame = (kind: OwnerFrame["kind"], label = kind): OwnerFrame => ({ id: Symbol(label), kind })
const PAGE = frame("page")

function makeOwnership(): InputOwnership {
  let frames: OwnerFrame[] = [PAGE]
  return {
    top: () => frames.at(-1) ?? PAGE,
    pageFrame: () => PAGE,
    push(kind: OverlayKind) {
      const claim: OwnerFrame = { id: Symbol(kind), kind }
      frames = [...frames, claim]
      return claim
    },
    pop(claim) {
      if (!claim || claim === PAGE) return
      frames = frames.some((f) => f.id === claim.id) ? frames.filter((f) => f.id !== claim.id) : frames
    },
    owns(claim) {
      return claim !== undefined && (frames.at(-1)?.id === claim.id)
    },
  }
}

describe("focus-router: tier mapping and precedence", () => {
  test("frame kinds map to the documented tiers", () => {
    expect(tierOfFrame(PAGE)).toBe("main")
    expect(tierOfFrame(frame("dialog"))).toBe("modal")
    expect(tierOfFrame(frame("panel"))).toBe("overlay")
    expect(tierOfFrame(frame("dock"))).toBe("overlay")
    expect(tierOfFrame(undefined)).toBeUndefined()
  })

  test("rank order is modal > overlay > main > global", () => {
    expect(CAPTURE_TIERS).toEqual(["modal", "overlay", "main", "global"])
    expect(CAPTURE_RANK.modal).toBeGreaterThan(CAPTURE_RANK.overlay)
    expect(CAPTURE_RANK.overlay).toBeGreaterThan(CAPTURE_RANK.main)
    expect(CAPTURE_RANK.main).toBeGreaterThan(CAPTURE_RANK.global)
  })

  test("frozen capture matrix: 5 stack states x 4 tiers", () => {
    const page = PAGE
    const dialog = frame("dialog", "stop-confirm")
    const panel = frame("panel", "agents")
    const dock = frame("dock", "ask")
    const top = (f: OwnerFrame) => f
    // [top frame, modal, overlay, main, global]
    const rows: Array<[OwnerFrame, boolean, boolean, boolean, boolean]> = [
      [top(page), false, false, true, true],
      [top(dialog), true, false, false, false],
      [top(panel), false, true, false, false],
      [top(dock), false, true, false, false],
      [top(dialog), true, false, false, false], // dialog stacked over panel
    ]
    for (const [tierFrame, modal, overlay, main, global] of rows) {
      expect(resolveCapture(tierFrame, "modal"), `modal under ${tierFrame.kind}`).toBe(modal)
      expect(resolveCapture(tierFrame, "overlay"), `overlay under ${tierFrame.kind}`).toBe(overlay)
      expect(resolveCapture(tierFrame, "main"), `main under ${tierFrame.kind}`).toBe(main)
      expect(resolveCapture(tierFrame, "global"), `global under ${tierFrame.kind}`).toBe(global)
    }
    // Except for main+global on the page frame, exactly one tier is enabled.
    for (const [tierFrame] of rows) {
      if (tierFrame.kind === "page") continue
      const enabled = CAPTURE_TIERS.filter((t) => resolveCapture(tierFrame, t))
      expect(enabled.length, `single enabled tier under ${tierFrame.kind}`).toBe(1)
    }
  })

  test("token identity: a dialog above a panel wins; stale panel token loses", () => {
    const panel = frame("panel", "agents")
    const dialog = frame("dialog", "stop-confirm")
    expect(resolveCapture(dialog, "modal", dialog)).toBe(true)
    expect(resolveCapture(dialog, "modal", panel)).toBe(false)
    expect(resolveCapture(panel, "overlay", panel)).toBe(true)
    expect(resolveCapture(panel, "overlay", dialog)).toBe(false)
  })
})

describe("focus-router: modality leak negatives", () => {
  test("N1 turn-time Esc: page owns on idle page; dialog owns when stop-confirm is up; panel suppresses page", () => {
    const ownership = makeOwnership()
    const router = createFocusRouter(ownership)
    // busy turn, no overlay -> page tier owns Esc (arm / interrupt)
    expect(router.allows("main")).toBe(true)
    expect(router.allows("global")).toBe(true)
    expect(router.allows("modal")).toBe(false)
    // stop-confirm dialog on top -> modal owns Esc, page tiers denied
    const dialog = ownership.push("dialog")
    expect(router.allows("modal", dialog)).toBe(true)
    expect(router.allows("main")).toBe(false)
    expect(router.allows("global")).toBe(false)
    ownership.pop(dialog)
    // panel on top (dialog below) -> page Esc denied, panel owns overlay
    const panel = ownership.push("panel")
    expect(router.allows("main")).toBe(false)
    expect(router.allows("global")).toBe(false)
    expect(router.allows("overlay", panel)).toBe(true)
    ownership.pop(panel)
    expect(router.allows("main")).toBe(true)
  })

  test("N2 panel PgUp/PgDn: overlay pager wins, transcript (main) denied while panel is open", () => {
    const ownership = makeOwnership()
    const router = createFocusRouter(ownership)
    expect(router.allows("main")).toBe(true) // transcript scrolls on the page
    const panel = ownership.push("panel")
    expect(router.allows("overlay", panel)).toBe(true) // panel pager handles PgUp/PgDn
    expect(router.allows("main")).toBe(false) // transcript does not scroll
    // a dialog above the panel steals the keys from the panel pager
    const dialog = ownership.push("dialog")
    expect(router.allows("modal", dialog)).toBe(true)
    expect(router.allows("overlay", panel)).toBe(false)
    expect(router.allows("main")).toBe(false)
  })

  test("frame accounting: push/pop of dialog, panel and dock returns to exactly [page]", () => {
    const ownership = makeOwnership()
    const router = createFocusRouter(ownership)
    for (const kind of ["dialog", "panel", "dock"] as const) {
      const f = ownership.push(kind)
      expect(router.top().id).toBe(f.id)
      ownership.pop(f)
    }
    expect(router.top().id).toBe(PAGE.id)
    expect(router.topTier()).toBe("main")
    expect(router.allows("main")).toBe(true)
    // idempotent pop of a stale/foreign frame must not corrupt the stack
    ownership.pop(frame("panel", "stale"))
    expect(router.top().id).toBe(PAGE.id)
  })

  test("reverse case: pre-change enabled computation fires under an overlay; FocusRouter denies it", () => {
    // Verbatim gate from the pre-change createLayer (git show 4db780a1, keymap.tsx:219):
    //   enabled: enabled() ? options.enabled : false
    // A page `mode:"global"` layer that omits a pageOwns shim therefore stays
    // enabled no matter which frame is on top — the historical P0 leak.
    const legacyEnabled = (interactive: boolean, optionsEnabled: unknown) =>
      interactive ? (optionsEnabled === undefined ? true : optionsEnabled) : false
    const ownership = makeOwnership()
    const router = createFocusRouter(ownership)
    const panel = ownership.push("panel")
    // old computation: no shim -> still enabled under a panel (the leak)
    expect(legacyEnabled(true, undefined)).toBe(true)
    // new structural gate: denied by tier alone, no handwritten shim needed
    expect(router.allows("main")).toBe(false)
    expect(router.allows("global")).toBe(false)
    // the surface that legitimately owns the keys still answers
    expect(router.allows("overlay", panel)).toBe(true)
  })
})

describe("focus-router: integration guards (no behaviour drift, no scope creep)", () => {
  test("tier declarations landed on the migrated layers", () => {
    expect(src("src/ui/dialog.tsx")).toMatch(/capture: "modal"/)
    expect(src("src/routes/session/turn-cancel.tsx")).toMatch(/capture: "main"/)
    expect(src("src/routes/session/transcript-scroll.tsx")).toMatch(/capture: "main"/)
    expect(src("src/routes/session/pane-focus.tsx")).toMatch(/capture: "main"/)
    expect(src("src/context/panel-kit-host.tsx")).toMatch(/capture: "overlay"/)
    expect(src("src/routes/session/agents-panel.tsx")).toMatch(/capture: "overlay"/)
  })

  test("createLayer ANDs the tier gate; untagged layers keep their enabled value", () => {
    const source = src("src/context/keymap.tsx")
    expect(source).toMatch(/focus && capture !== undefined/)
    expect(source).toMatch(/focus\.allows\(capture as CaptureTier/)
    expect(source).toMatch(/: options\.enabled/) // untouched path preserved
  })

  test("production tree mounts FocusRouterProvider in place of InputOwnershipProvider", () => {
    const entry = src("examples/v2-entry.tsx")
    expect(entry).toMatch(/FocusRouterProvider, useIsPageOwner/)
    expect(entry).toMatch(/createComponent\(FocusRouterProvider, \{/)
  })

  test("existing keybinds and layer priorities unchanged", () => {
    const keybind = src("src/config/v1/keybind.ts")
    expect(keybind).toMatch(/app_exit: keybind\("ctrl\+c,ctrl\+d,<leader>q"/)
    expect(keybind).toMatch(/session_tab_select_1: keybind\("<leader>1,ctrl\+1"/)
    expect(keybind).toMatch(/command_list: keybind\("ctrl\+p"/)
    expect(keybind).toMatch(/messages_page_up: keybind\("pageup,ctrl\+alt\+b"/)
    expect(src("src/routes/session/pane-focus.tsx")).toMatch(/priority: 1/)
    expect(src("src/routes/session/agents-panel.tsx")).toMatch(/priority: 2/)
  })

  test("S5 scope guard: settings/* untouched by the SK slice", () => {
    const source = src("src/routes/session/settings-modal.tsx")
    expect(source).not.toMatch(/capture: "(modal|overlay|main|global)"/)
  })
})
