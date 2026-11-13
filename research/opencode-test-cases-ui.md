# opencode TUI / Rendering / Input Test Case Survey

Source inspected (read-only): `~/Downloads/opencode-survey` (snapshot of github.com/sst/opencode, no `.git`, HEAD content as of 2026-11-13). All numbers below were measured with grep/find on that snapshot.

## Scope & file inventory

Language distribution: the repo is **TypeScript-only for tests**. `find -name '*_test.go'` over the whole tree returns **0 files**. The TUI is TS/SolidJS on top of `@opentui/core` + `@opentui/solid` (the same OpenTUI stack dsh-opentui uses), tested with **bun:test**.

Relevant terminal-UI packages and their test volume (test files = `*.test.ts`/`*.test.tsx`, excluding node_modules):

| Package | Terminal UI? | Test files | Notes |
|---|---|---|---|
| `packages/tui` | yes — the main TUI app | **197 files** | 1,374 `test()`/`test.each()` declarations, 58 `describe()` blocks |
| `packages/cli` | partial (hosts TUI launch) | 58 | CLI args/config tests; no rendering tests (`grep -rl @opentui cli/test` → 2 boundary tests only) |
| `packages/ui`, `packages/session-ui` | no (web/Solid, not terminal) | 44 / 57 | out of scope for terminal UI |
| `packages/core`, `ai`, `server`, ... | no | — | non-UI scope (covered by the other agent) |

`packages/tui/test` layout (test files per directory):

| Directory | Files | Focus |
|---|---|---|
| `test/*.test.tsx` (top level) | 55 | app-level session behavior, streaming, lifecycle |
| `test/cli/tui/` | 38 | the "classic" TUI route: dialogs, keymaps, grouping, diff viewer |
| `test/mini/` | 26 | the "mini" runtime (single-run mode): footer, scrollback, stream transport |
| `test/component/` | 16 | leaf components: tabs, spinner, shimmer, dialogs |
| `test/prompt/` | 15 | prompt editor internals: parse, history, attachment, codec |
| `test/util/` | 21 | pure helpers: selection, marquee, error, presentation |
| `test/ui/` | 8 | layout primitives: pane resize, dialog layout, link, select controller |
| `test/context/` | 8 | providers: theme, tabs, storage, local selection |
| `test/feature-plugins/` | 5 | plugin-contributed UI surfaces |
| `test/theme/`, `test/simulation/` | 4 / 1 | theme v2 resolution; simulation semantics |
| non-test helpers (`fixture/`, etc.) | 19 | shared harnesses described below |

Key harness files (the "environment" layer every case builds on):

- `test/fixture/app.ts` — `createAppFixture()`: full app boot against a **mocked HTTP server** (`Bun.serve` on port 0) with a scripted `fetch` handler, temp home/data/state dirs via Effect `Global.layerWith`, and the real renderer from `createTestRenderer()`. Returned object spreads the renderer test setup and adds `events`, `config()`, `ready`, and `Symbol.asyncDispose` cleanup.
- `test/fixture/tui-runtime.ts` — `createTuiResolvedConfig()`: builds the resolved config object with partial overrides (keybinds, tabs, animations).
- `test/fixture/frame.ts` — `waitForHighlightedFrame()`: frame predicate that also awaits in-flight tree-sitter highlighting before declaring the pass failed.
- `test/fixture/fixture.ts` — `tmpdir()` with `Symbol.asyncDispose`, `emptyThemeSource`, plugin-copy helper.
- `test/fixture/tui-client.ts` — `createFetch`/`json`/`createEventStream`: canned REST responses + SSE-style event injection for the TUI↔server client.

The renderer harness itself comes from `@opentui/core/testing` (`createTestRenderer`, `TestRenderer`, `MockTreeSitterClient`) and `@opentui/solid` (`testRender`). So OpenTUI ships its own testing facade and opencode builds fixtures on top of it — directly reusable knowledge for dsh-opentui.

## Case catalog by category

### 1. Full-frame component rendering / snapshot

- **Scenario**: A composite component (inline tool rows) renders known fixture content at a fixed width; checks wrapping, truncation, icon alignment, failure copy, trailing status badges.
- **Environment**: `testRender(<component/>, { width: 72, height: N })` with hand-written fixture arrays (realistic tool labels including regex strings, errors, pending states). Two consecutive `renderOnce()` calls to flush.
- **Action**: Render, optionally toggle a prop (`errorExpanded`) and re-render.
- **Assertion**: `captureCharFrame()` string, line-split and `trimEnd()`-normalized; assertions use `toContain` / `not.toContain` on specific phrases rather than whole-frame equality. Pure logic parts (tool name → display name mapping) asserted as plain values.
- **Location**: `packages/tui/test/cli/tui/inline-tool-wrap-snapshot.test.tsx`

```ts
async function renderFrame(component: () => JSX.Element, options: { width: number; height: number }) {
  testSetup?.renderer.destroy()
  testSetup = await testRender(component, options)
  await testSetup.renderOnce()
  await testSetup.renderOnce()
  return testSetup.captureCharFrame()
    .split("\n").map((line) => line.trimEnd()).join("\n").trimEnd()
}

test("replaces pending copy when a tool fails before completion", async () => {
  const frame = await renderFrame(() => <FailedPendingToolFixture />, { width: 72, height: 3 })
  expect(frame).toContain("Patch failed")
  expect(frame).not.toContain("Preparing patch")
```

### 2. Layout math under width constraints (pure-function layout)

- **Scenario**: Sidebar/tab width clamping and "fits vertically" thresholds at exact pixel boundaries.
- **Environment**: None — direct import of `src/ui/layout` constants and pure functions.
- **Action**: Call with boundary values around each threshold (just-fit and just-over: 105 vs 106, 123 vs 124).
- **Assertion**: Exact numeric equality for every boundary, including degenerate inputs (0) and values above the max.
- **Location**: `packages/tui/test/ui/layout.test.ts`

```ts
test("vertical tabs match the session sidebar and preserve readable content width", () => {
  expect(SESSION_SIDEBAR_WIDTH).toBe(42)
  expect(sessionTabsFitVertically(106)).toBe(true)
  expect(sessionTabsFitVertically(105)).toBe(false)
})
test("vertical tab width preserves minimum rail and content widths", () => {
  expect(clampSessionTabsWidth(0, 120)).toBe(SESSION_TABS_COMPACT_WIDTH)
  expect(clampSessionTabsWidth(100, 120)).toBe(SESSION_SIDEBAR_MAX_WIDTH)
  expect(clampSessionTabsWidth(100, 100)).toBe(56)
  expect(clampSessionTabsWidth(42, 54)).toBe(10)
```

### 3. Renderer resize and reflow (interactive)

- **Scenario**: After the terminal is resized (or a disclosure toggled, a stream appended, a tab switch), the scroll anchor stays on the same message.
- **Environment**: Full `createAppFixture` with 40 canned history messages over the mock server, `width`/`height` given at fixture level.
- **Action**: `app.resize(100 → 48, 24)` then `await app.waitForVisualIdle({ quietFrames: 3 })`; parallel modes exercise the same invariant via tab switch / disclosure click / streaming append.
- **Assertion**: A captured anchor (message id resolved from renderables) is `toEqual` the pre-action value; line index of a marker found in `captureCharFrame()` unchanged.
- **Location**: `packages/tui/test/session-history-interactions.test.tsx`

```ts
if (mode === "resize") {
  app.resize(width === 100 ? 48 : 100, 24)
  await app.waitForVisualIdle({ quietFrames: 3 })
}
...
if (mode === "resize") expect(anchor()).toEqual(held)
```

### 4. Text measuring / wide chars / control characters (CJK, emoji ZWJ, ESC, \0)

- **Scenario**: The prompt's trigger-index helpers (@ mention, / slash) agree with what a real textarea shows, for strings whose JS string index and editor cell offset diverge.
- **Environment**: `createTestRenderer({ width: 40, height: 4 })`, then a real `TextareaRenderable` mounted into the root; `setup.renderer.widthMethod` passed everywhere.
- **Action**: `area.setText(sample)` per sample; convert between string index and editor offset via `measureEditText` / `promptOffsetIndex`.
- **Assertion**: For every sample the shown char at the computed offset equals the trigger, and index/offset conversions round-trip (`index: true, before: true` in a table). Negative cases: triggers inside tokens ("foo@bar.com", "中文@", "🙂@", URLs) must NOT match.
- **Location**: `packages/tui/test/prompt/display.test.ts`

```ts
// Each sample takes a different number of editor cells than JavaScript string widths report.
const samples = ["\f", "\0", "\x1b", "\x7f", "\x85", "\t", "中文", "e\u0301", "👨‍👩‍👧‍👦", "\n", "\r\n"]
test.each([["@", mentionTriggerIndex], ["/", slashTriggerIndex]] as const)(
  "places the %s trigger where the editor shows it", (trigger, find) => {
    const texts = [`\t${trigger}file`,
      ...samples.flatMap((sample) => [`${sample} ${trigger}x ${sample}`, `${sample}\n${trigger}x\r\n${sample}`])]
    ...
    expect(results).toEqual(texts.map((text) => ({ text, shown: trigger, index: true, before: true })))
```

### 5. Input box editing (paste, chips, undo)

- **Scenario**: Pasted text keeps control characters but drops escape sequences; paste collapses to a `[Pasted ~N lines]` chip; undo (ctrl+u / super+z) restores whole chip or a fragment; submit sends the restored text to the server.
- **Environment**: `createAppFixture` with a `fetch` handler that resolves a `prompted` promise with the submitted body; explicit `takeDraft(undefined)` to clear the process-wide draft stash.
- **Action**: `setup.mockInput.typeText("x")`, `mockInput.pasteBracketedText("a\fb\u001b[31mc\u0000d")`, `pressBackspace()`, `pressKey("w", { ctrl: true })`, `pressKey("u", { ctrl: true })`, `pressKey("z", { super: true })`, `pressEnter()` — each followed by `setup.waitFor(() => text() === ...)` on the editor's `plainText`.
- **Assertion**: Editor `plainText` exact-string equality at each step; final assertion is the server-received payload text (`await prompted.promise`).
- **Location**: `packages/tui/test/prompt-paste.test.tsx`

```ts
await setup.mockInput.pasteBracketedText("a\fb\u001b[31mc\u0000d")
await setup.waitForFrame((frame) => frame.includes("xa^Lbc^@d"))
expect(setup.renderer.currentFocusedEditor?.plainText).toBe("xa\fbc\0d")
```

### 6. Keybindings / keymap layers / aliases

- **Scenario**: Legacy key names compile to canonical ones; keymaps format to display strings; keymap scope decides which focused peer receives Enter/navigation; plugin-provided keymap layers register commands.
- **Environment**: Harness component wrapped in `ConfigProvider` (with `createTuiResolvedConfig({ keybinds: ... })`) + `Keymap.Provider`; or full app fixture for scope tests. Fixture component registers a layer via `Keymap.createLayer` and captures `shortcuts.get(...)`.
- **Action**: Either pure config resolution, or `mockInput.pressKey("F6")` / `pressKey("2", { ctrl: true })` against the mounted app.
- **Assertion**: State closure values (`read()` returning the mapped shortcut strings), `toEqual` on small objects; for scope tests, which textarea received keys / whether a reply or cancellation was recorded.
- **Location**: `packages/tui/test/keymap.test.tsx`, `packages/tui/test/keybind.test.ts`, `packages/tui/test/cli/tui/input-scope.test.tsx`

```ts
const app = await testRender(() => (
  <ConfigProvider config={createTuiResolvedConfig({
    keybinds: { "session.page.up": "pgup", "session.page.down": "pgdown" } })}>
    <Keymap.Provider><Harness /></Keymap.Provider>
  </ConfigProvider>
))
expect(read()).toEqual({ up: "pgup", down: "pgdn" })
```

### 7. Focus management

- **Scenario**: Mouse wheel over an embedded terminal pane must not steal focus from the transcript; a form textarea restores draft focus after scope/modal changes.
- **Environment**: `createTestRenderer({ width: [80,120,180], height: 36, kittyKeyboard: true })` + real app run via Effect layers, fixture PTY payload with canned 100-line output.
- **Action**: `test.skipIf(process.platform === "win32").each([80, 120, 180])` — scroll wheel events, tab switches.
- **Assertion**: Which renderable is focused after the interaction; visual anchor preserved.
- **Location**: `packages/tui/test/session-wheel-focus.test.tsx`

```ts
test.skipIf(process.platform === "win32")
  .each([80, 120, 180])("session wheel scrolling preserves pane focus at width %s", async (width) => {
  const setup = await createTestRenderer({ width, height: 36, kittyKeyboard: true })
```

### 8. Dialogs and selectors (largest dialog: `dialog-select`, 30+ cases)

- **Scenario**: Filter lifecycle (typing, emptying), cursor index stability while options empty/reorder, focus targets arriving below the viewport, ctrl+c clearing filter before closing, empty state, footer action availability with no selection, truncation within one row.
- **Environment**: `testRender` with provider stack (`ConfigProvider`, `DialogProvider`, `ToastProvider`, ...), option fixtures; some cases use `TestTuiContexts` wrapper.
- **Action**: `mockInput` key sequences (type filter chars, arrows, escape, ctrl+c); programmatic option-list changes inside `batch()`.
- **Assertion**: Captured frame `toContain` phrases; controller state (selected id, cursor index) via closures; negative cases with `test.each([false, 0, "", null, "current", undefined])` for falsy `current` values; counter-assertion that rows do NOT register renderer resize listeners (listener-count check).
- **Location**: `packages/tui/test/cli/tui/dialog-select.test.tsx`

```ts
test("keeps the cursor index while options are temporarily empty", async () => { ... })
test.each([false, 0, "", null, "current", undefined])("focuses current %p when it changes", async (current) => { ... })
test("dialog rows do not add renderer resize listeners", async () => { ... })
```

### 9. Theme and colors

- **Scenario**: Theme document resolution (hue ordering, aliases, mode completeness, syntax style generation, reject-incomplete), ANSI-16 palette derivation from semantic colors, terminal pane palette written via OSC 4 sequences, theme switching not resetting stream state.
- **Environment**: Mostly pure: `resolveThemeDocument(getOpenCodeTheme(), mode)`. For palette: parse the emitted `\]4;N;#hex` OSC string. For interactive swap: scrollback fixture with two themes.
- **Action**: Call resolver per mode; for swap, fire a theme-change event mid-stream.
- **Assertion**: Exact expected color arrays (`expected` computed alongside), reject-cases expect throw; mode-dependent values via `test.each(["light","dark"])`.
- **Location**: `packages/tui/test/theme/v2/resolve.test.ts`, `packages/tui/test/component/terminal-pane-theme.test.ts`, `packages/tui/test/mini/scrollback.surface.test.ts`

```ts
test.each(["light", "dark"] as const)("builds the %s ANSI palette from semantic colors", (mode) => {
  const theme = resolveThemeDocument(getOpenCodeTheme(), mode)
  ...
  const output = terminalPalette(theme, mode, theme.background.raised.base).toString()
  const palette = [...output.matchAll(/\]4;(\d+);(#[0-9a-f]+)/g)]
```

### 10. Markdown / diff / syntax highlighting

- **Scenario**: (a) Final fence text applied in a Solid `batch` regardless of completion/content signal order; (b) diff viewer route behavior at multiple widths, error and empty states, scope chooser, late/ambiguous responses; (c) highlighting waits.
- **Environment**: (a) `testRender` with `createSignal` content + `MarkdownRenderable` inspection via `renderer.root.getChildren()`; (b) full app fixture with canned diff JSON; (c) `MockTreeSitterClient` and the `waitForHighlightedFrame` helper that awaits `CodeRenderable.highlightingDone`.
- **Action**: `batch(() => { setStreaming(false); setContent(...) })` in both orders; key presses for viewer toggles; `test.each([50, 80, 160])` widths.
- **Assertion**: Renderable-tree type/instance and content (`block.content`), children length; frame text for viewer; navigation-state equality.
- **Location**: `packages/tui/test/markdown-streaming.test.tsx`, `packages/tui/test/cli/tui/diff-viewer.test.tsx` (48 cases), `packages/tui/test/fixture/frame.ts`

```ts
const block = markdown?.getChildren()[0]
expect(block).toBeInstanceOf(CodeRenderable)
expect(block.content).toBe("initial final")
expect(markdown?.getChildren()).toHaveLength(1)
```

### 11. Streaming incremental rendering / scrollback commits

- **Scenario**: Streamed markdown holds unfinished code fences until final commit; each committed chunk produces exactly one external-output snapshot; trailing newline ownership; theme swap mid-stream preserves parser state; monochrome mode.
- **Environment**: `RunScrollbackStream` in a `createTestRenderer` with `externalOutputMode: "capture-stdout"`; commits are pulled from the renderer's internal `externalOutputQueue` via `Reflect.get(renderer, "externalOutputQueue").claim()` (explicit guard thrown if the queue is missing). Decoded via `commit.snapshot.getRealCharBytes(true)`, rows sliced at fixed width 80 and trimmed.
- **Action**: `out.scrollback.append(assistant(text))` then `out.scrollback.complete()`; `claim()` between phases.
- **Assertion**: Commit count (`toHaveLength(1)`), substring presence/absence per phase (`not.toContain("console.log")` before completion), `trailingNewline` flag, row-exact slices.
- **Location**: `packages/tui/test/mini/scrollback.surface.test.ts`

```ts
const progress = claim(out.renderer)
expect(progress).toHaveLength(1)
expect(render(progress)).toContain("Markdown Sample")
expect(render(progress)).not.toContain("console.log(message)")
await out.scrollback.complete()
const final = claim(out.renderer)
expect(final[0]!.trailingNewline).toBe(false)
```

### 12. Mouse interaction

- **Scenario**: Drag-releasing a text selection over tab controls must not activate the tab; middle-click closes without selecting; close-control position stable across overflow window changes; pane-resize drag commits clamped sizes.
- **Environment**: `testRender` at small fixed size (`width: 60, height: 3`) with a controller object implementing `SessionTabsController` backed by Solid signals; pane-resize test fakes the renderer with a plain object recording clipboard/clear calls and constructs `MouseEvent` instances directly.
- **Action**: `app.mockMouse.pressDown(5, 1)`, `.release(40, 0)`, `.click(40, 0)`, `.scroll(...)`, `.drag(...)`, `.doubleClick(...)`; direct `new MouseEvent(null, { type, x, y, button, modifiers })` dispatch for unit-level tests.
- **Assertion**: Signal values after each gesture (`expect(active()).toBe("first")` — i.e., NOT changed after a drag-release), commit arrays (`commits.push(size)`), `setSystemTime` for double-click timing.
- **Location**: `packages/tui/test/component/session-tabs-mouse.test.tsx`, `packages/tui/test/ui/pane-resize.test.ts`

```ts
await app.mockMouse.pressDown(5, 1)
await app.mockMouse.release(40, 0)
expect(active()).toBe("first")   // drag-release must NOT activate
await app.mockMouse.click(40, 0)
expect(active()).toBe("second")  // plain click does
```

### 13. Scrolling / navigation

- **Scenario**: `session.submit_scroll` setting decides whether submitting while scrolled up keeps or jumps position; message navigation (next/prev user message) respects viewport slack, boundaries, and logical boundaries temporarily outside the viewport.
- **Environment**: App fixture with 40 padded history messages (`History message 0039` used as a findable marker); navigation tests are pure-function tests over row arrays with viewport-height parameters.
- **Action**: Find the `ScrollBoxRenderable` by walking `root` for an instance with `getRenderable("message-39")`; send a prompt via the UI; arrow/page key sequences.
- **Assertion**: Scroll position / selected-message index equality; `test.each([{setting: undefined, kept: false}, {setting: "keep", kept: true}])` pairs setting to expected behavior.
- **Location**: `packages/tui/test/session-submit-scroll.test.tsx`, `packages/tui/test/cli/tui/message-navigation.test.ts`

```ts
await app.waitForFrame((frame) => frame.includes("History message 0039") && frame.includes("Demo Model"))
const find = (root: Renderable): ScrollBoxRenderable | undefined =>
  root instanceof ScrollBoxRenderable && root.getRenderable("message-39") ? root : undefined
```

### 14. Time-driven animation / delayed UI

- **Scenario**: Marquee scroll starts after hover delay and stops after one cycle; delayed presence shows a status only after it persists for the delay; double-click timing.
- **Environment**: `jest.useFakeTimers()` inside bun:test (bun supports jest's timer API) + Solid `createRoot` scopes; `bun's setSystemTime` for date-sensitive logic.
- **Action**: `jest.advanceTimersByTime(600 / 999 / 1_400)`; mutate signals between advances.
- **Assertion**: Offset/visibility exact values after each tick; reset-to-zero after leave/dispose.
- **Location**: `packages/tui/test/component/session-tabs-marquee.test.ts`, `packages/tui/test/util/delayed-presence.test.ts`, `packages/tui/test/ui/pane-resize.test.ts` (`setSystemTime`)

```ts
jest.useFakeTimers()
scope.marquee.enter("first", "opencode", 6)
expect(scope.marquee.offset()).toBe(0)
jest.advanceTimersByTime(600)
expect(scope.marquee.offset()).toBe(1)
```

### 15. Virtualization / mount budget

- **Scenario**: Row-weight accounting for collapsed vs expanded groups; windowed rendering renders only rows within the budget around the viewport.
- **Environment**: Pure: synthetic `SessionRow` arrays, `groupEntries` from the real grouping tree. Interactive variant: `session-mount-budget.test.tsx` with the app fixture.
- **Action**: `rowWeight` per row; `rowsBefore/rowsAfter` over budgets (40/60) with lengths `[0, 1, 39, 40, 41, 150]` and indices at 0/mid/end.
- **Assertion**: Weight arrays `toEqual([1,1,1,1,1])`; window boundaries `Math.max(0, ...)`/`Math.min(length, ...)` exact values.
- **Location**: `packages/tui/test/cli/tui/mount-budget.test.ts`

```ts
const weights = rows.map((row) => rowWeight(row, collapsed))
expect(weights).toEqual([1, 1, 1, 1, 1])
for (const length of [0, 1, 39, 40, 41, 150]) {
  expect(rowsBefore(ones, length, 40)).toBe(Math.max(0, length - 40))
```

### 16. Config-driven UI behavior

- **Scenario**: Config keys (`session.submit_scroll`, `tabs.mode`, `keybinds`, `animations`) change observable UI behavior; preference writes persist through the fixture's config update callback.
- **Environment**: `createAppFixture({ config: {...} })` — the fixture clones config and applies `update()` mutations like a config file would.
- **Action**: Boot with each setting value; drive the triggering interaction.
- **Assertion**: Behavior delta per setting (see scroll case above); `test.each` pairs value → expected flag.
- **Location**: `packages/tui/test/session-submit-scroll.test.tsx`, `packages/tui/test/config.test.tsx`, `packages/tui/test/config-v2.test.tsx`

### 17. Error / empty / degraded states

- **Scenario**: Diff load failure shows an error instead of an empty diff; empty turn diff uses empty state; failed scopes never render the previous scope's files; shell-stopped session state; no-match dialog state.
- **Environment**: Fixture `fetch` handlers return error JSON or nothing; late responses via unresolved promises resolved at chosen times.
- **Action**: Trigger the failing path, then resolve late promises after the user moved on.
- **Assertion**: Frame contains error copy and NOT stale content (`expect(frame).not.toContain("Preparing patch")` pattern; "late diff responses cannot replace the selected scope").
- **Location**: `packages/tui/test/cli/tui/diff-viewer.test.tsx` (lines 106, 269, 699, 728, 754), `packages/tui/test/cli/tui/inline-tool-wrap-snapshot.test.tsx`

### 18. Clipboard / selection copy

- **Scenario**: Copy writes selected text to clipboard without clearing highlight; copy-on-select behavior gated by selection behavior ("cell"); selection keys routing.
- **Environment**: Hand-rolled fake renderer objects returning a fixed `getSelection()` shape and recording `write`/`clearSelection` calls; no real renderer needed.
- **Action**: Call `copy()` / `copyOnSelectRelease()` with variations.
- **Assertion**: Recorded writes array contents and clear-call counter.
- **Location**: `packages/tui/test/util/selection.test.ts`, `packages/tui/test/util/selection-copy-on-select.test.tsx`, `packages/tui/test/clipboard.test.ts`

```ts
const clipboard: ClipboardService = { read: async () => undefined,
  write: async (value) => { writes.push(value) } }
// renderer.getSelection returns { getSelectedText: () => "beta", behavior: "cell", ... }
```

### 19. App lifecycle / teardown

- **Scenario**: Renderer destroy mid-stream does not crash; disposal order (renderer → task → server → tmpdir) via `Symbol.asyncDispose`; cross-test global state (draft stash) is reset explicitly.
- **Environment**: Every test uses `await using app = await createAppFixture(...)` or try/finally `renderer.destroy()`; `afterEach` loops over an `active: TestRenderer[]` array awaiting `renderer.closed`.
- **Action**: Destroy during pending stream/render; run to completion normally.
- **Assertion**: Process completes without throw; subsequent state assertions skipped by design (teardown correctness itself is the case).
- **Location**: `packages/tui/test/app-lifecycle.test.tsx`, `packages/tui/test/mini/scrollback.surface.test.ts` (afterEach), `packages/tui/test/fixture/app.ts`

## Basic case checklist

Basic cases any terminal UI should have, and opencode's status:

| Basic case | Present? | Where / how judged |
|---|---|---|
| Empty state (no options / empty list) | Yes | `dialog-select.test.tsx` "renders one gap before an empty state"; diff viewer "empty or failing turn diff uses the viewer's empty and error states" — frame `toContain` |
| Ultra-narrow width | Yes | `test.each` at width 24 (`footer.responsive.test.tsx` sizes `[112,30],[24,8],[40,12]`), 50/56 columns in diff-viewer; pure clamps in `ui/layout.test.ts` with input 0 |
| Very wide width | Yes | `test.each([80, 160])` / `[50, 80, 100, 160]` recurring across diff-viewer, footer, wheel-focus |
| Very long single line / wrapping | Yes | `inline-tool-wrap-snapshot.test.tsx` (long grep-pattern labels at width 72), footer width tests |
| CJK / emoji wide chars | Yes | `prompt/display.test.ts` samples `"中文"`, `"🙂@"`, `"👨‍👩‍👧‍👦"`, `"e\u0301"` against editor cell offsets; `footer.view.tsx` fixture includes `"src/文件.ts"` |
| Control characters in input | Yes | `prompt-paste.test.tsx`: `\f`, `\0`, `\x1b[31m` pasted; expected `^L`/`^@` visible forms and stripped escapes |
| Resize then reflow | Yes | `app.resize(48, 24)` + `waitForVisualIdle({ quietFrames: 3 })` in `session-history-interactions.test.tsx`; scroll anchor equality |
| Scroll anchor stability during streaming | Yes | same file, mode `"streaming"`: `scroll.scrollHeight` growth check + anchor equality |
| Rapid consecutive key presses | Partially — sequences are sent but no dedicated stress case; back-to-back `mockInput` calls in paste/undo tests are the closest |
| Fast consecutive input events | Yes (mouse) | `pane-resize.test.ts` dispatches rapid drag events; marquee timer tests |
| Theme switch preserves state | Yes | `scrollback.surface.test.ts` "theme swaps preserve streamed markdown parser state"; `prompt-cursor.test.tsx` cursor style survives theme change |
| Cursor position / cursor style | Yes | `prompt-cursor.test.tsx` (`cursorStyle`, `cursorColor` object assertions), display.test offset round-trips |
| Focus management | Yes | `session-wheel-focus.test.tsx`, `input-scope.test.tsx` (which peer receives Enter) |
| Mouse click / scroll / drag / middle-click | Yes | `mockMouse.click/scroll/drag/pressDown/release/doubleClick` — 133 call sites total |
| Bracketed paste | Yes | `mockInput.pasteBracketedText` — 17 call sites |
| Graceful destroy mid-work | Yes | app-lifecycle and afterEach `renderer.closed` awaits |
| Time-driven animation with fake clock | Yes | `jest.useFakeTimers` + `advanceTimersByTime` in marquee/delayed-presence; `setSystemTime` in pane-resize |

Not found (checked, absent): dedicated "rapid 100-key burst" stress tests; rendering-performance benchmark cases (only static budget accounting in `mount-budget.test.ts`); true PTY-driven end-to-end tests (all rendering goes through the fake terminal of `createTestRenderer`).

## Assertion techniques summary

Observed assertion granularities, roughly in order of frequency:

1. **Frame substring assertions** (`captureCharFrame()` → `toContain`/`not.toContain`) — the dominant style; full-frame snapshot equality is almost never used. Frames are normalized with `.split("\n").map(trimEnd).join("\n").trimEnd()`.
2. **Span-level capture** (`captureSpans()` → filter by `TextAttributes.INVERSE` or `span.bg.toInts()` equality) for color/attribute-specific checks (footer selected-item test).
3. **Renderable-tree inspection** (`renderer.root.getChildren()`, `instanceof CodeRenderable`, `.content`, `.getChildren().length`) for markdown/code structure.
4. **Internal byte-level capture** of external-output commits (`getRealCharBytes(true)`, `trailingNewline` flag, row slicing at fixed width) for streaming scrollback.
5. **State closures** — signals or captured variables (`read()`, `active()`, `commits[]`, `writes[]`) asserted with `toEqual`; call-count counters for clipboard clears and listener registrations.
6. **Server-side observation** — the mocked `fetch` handler resolves a promise with the request body; final assertions are about what the UI *sent* (`expect(await prompted.promise).toBe(...)`).
7. **Async synchronization primitives** before asserting: `waitForFrame(predicate)`, `waitFor(innerText predicate)`, `waitForVisualIdle({ quietFrames: 3 })`, double `renderOnce()`, and `waitForHighlightedFrame` (awaits tree-sitter `highlightingDone` inside the predicate).
8. **Boundary-value discipline** — `test.each` over just-fit/just-over pairs (105/106, 123/124), multiple widths `[50, 80, 160]`, falsy-value sweeps `[false, 0, "", null, "current", undefined]`, and array lengths `[0, 1, 39, 40, 41, 150]`.
9. **Negative assertions** are explicit: stale content must NOT appear ("late diff responses cannot replace the selected scope", `not.toContain("Preparing patch")`).
10. **Resource hygiene** enforced structurally: `await using` (explicit resource management) on fixtures, `try/finally` + `renderer.destroy()` + `await renderer.closed`, `afterEach` arrays.

## Gaps noticed in opencode's own coverage

- No true-terminal integration tests: everything runs in the fake renderer; OSC/SGR emission is only checked in the ANSI-palette test by regex on the output string.
- No automated perf/latency budgets (frame time, mount count) — the "budget" tests are about virtualization row accounting, not timing. (`mount-budget.test.ts` measures rows, not milliseconds.)
- No dedicated rapid-keyburst or input-flood stress cases.
- Frame assertions rely on `toContain` phrases, which can pass while unrelated layout is broken; only a few tests (footer selection spans, scrollback row slices) check positions.
- Accessibility/color-contrast checks are absent (colors asserted only where they carry state, e.g. selected-item background).
- Cross-platform key differences are only handled by `skipIf(process.platform === "win32")` on a few cases, not systematic.
