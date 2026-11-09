# @dsh-opentui/tui-base

Vendored TUI base layer. This is **@opencode/tui@2.2.5** from
[anomalyco/opencode](https://github.com/anomalyco/opencode), commit
`893e8dc43f05e872d4cac603486ce8a7181170fa`, vendored per
[ADR-0006](../../docs/adr/0006-vendor-opencode-tui-base.md). MIT — see
`LICENSE` and the root `NOTICE`.

## Provenance & re-vendor (5 lines)

1. Source: `git@github.com:anomalyco/opencode.git`, package `packages/tui`,
   snapshot commit `893e8dc` (recorded again in the package version suffix
   `2.2.5-893e8dc`).
2. Copy `packages/tui/src` verbatim into `src/` (plus `LICENSE`).
3. Copy siblings per the pruning table below into `src/vendor/`.
4. Re-run `src/vendor/stubs.d.ts` regeneration against the new import set.
5. `pnpm install`, `pnpm --filter @dsh-opentui/tui-base typecheck`,
   `bun examples/hello.tsx` in tmux, commit as a snapshot bump.

## Dependency pruning (ADR-0006 decision 1)

Upstream `@opencode/tui` declares 10 `workspace:*` siblings. Vendored set:

| Upstream workspace dep      | Resolution here                                           |
| --------------------------- | --------------------------------------------------------- |
| `@opencode/theme`           | vendored: `src/vendor/theme/` (tsconfig paths, full src)   |
| `@opencode/util`            | vendored: `src/vendor/util/` (tsconfig paths, 16-file import closure of the 10 subpaths tui uses) |
| `@opencode/ui`              | vendored: audio assets only — tui imports exactly 5 mp3s, no components (`src/vendor/ui/assets/audio/`, typed by the ambient `*.mp3` declarations in `src/audio.d.ts`) |
| `@opencode/client` (113 sites)  | **stub seam**: `src/vendor/stubs.d.ts` (type-level `any`) |
| `@opencode/plugin` (71 sites)   | stub seam                                                 |
| `@opencode/schema` (22 sites)   | stub seam                                                 |
| `@opencode/simulation` (5 sites)| stub seam                                                 |
| `@opencode/core` (2 sites)      | stub seam                                                 |
| `@opencode/merman` (1 site)     | stub seam                                                 |
| `@opencode/latex` (1 site)      | stub seam                                                 |

Vendoring `client`/`plugin`/`schema` would cascade into `@opencode/ai`,
`@opencode/protocol` and `core`'s 30+ dep tree — that is the rebuild's
seam work, not a vendoring concern (ADR-0006 negative-consequence note).

`catalog:` pins resolved from upstream `package.json` workspaces catalog:
`@opentui/core@0.8.1`, `@opentui/keymap@0.8.1`, `@opentui/solid@0.8.1`,
`solid-js@1.9.17`, `effect@4.1.0`, `fuzzysort@3.1.0`,
`get-east-asian-width@1.6.0`, `remeda@2.26.0`, `string-width@7.2.0`;
literals kept: `@solid-primitives/event-bus@1.1.2`, `strip-ansi@7.1.2`;
added from vendored util's closure: `open@11.0.4`.

## Adaptations (non-source)

- `package.json`: renamed `@dsh-opentui/tui-base`, `workspace:*`/`catalog:`
  refs replaced by the explicit pins above; `exports`/`imports` maps
  preserved verbatim (the `#bun`/`#node` conditional imports keep both
  variants on disk — `*.bun.ts` / `*.node.ts`).
- `tsconfig.json`: upstream's compilerOptions, plus `paths` mapping the
  vendored siblings and the `#imports` entries. Extends `@tsconfig/bun`
  (as upstream), **not** the repo root `tsconfig.base.json` — upstream code
  is authored against the former.
- Un-resolvable-at-runtime seams (stubbed `@opencode/*` siblings, mp3 asset
  specifiers) are typed but not runtime-wired; the view rebuild resolves
  them. `examples/hello.tsx` exercises only the engine path (`@opentui/*`),
  which is fully wired.

## Smoke

```sh
bun examples/hello.tsx   # scrollbox stickyScroll session shape; auto-quits
```

## Typecheck status

`tsc --noEmit` (typescript 5.9, upstream compilerOptions + two scoped
accommodations: `noImplicitAny: false`, `verbatimModuleSyntax: false` — both
pure stub-interaction artifacts, no emit in a noEmit package). Vendored
sibling code (theme/util/schema) is clean under it. Upstream app code
carries a residual set (~60 errors) entirely downstream of the stubbed
client/plugin/simulation siblings: loss of real generic inference
(`unknown` from Effect chains, `{}` collapses in dialog-model, generic
calls on stub-typed functions) plus a strictNullChecks differential vs
upstream's `tsgo` toolchain. These live in files the view rebuild
replaces (ADR-0006 fill order) and vanish when the seams get real
implementations. Ambient-stub expressiveness limits that were probed and
documented: a `const` suppresses the namespace meaning of the same name;
namespace-as-value pass-through (effect Schema namespaces) is not
expressible — that is why schema is vendored for real.

### Error budget (batch 8, exact count: 58; batch 7 was 58)

Batch 8 delta: 0. The slash-command path (`routes/session/commands.ts`,
`routes/session/slash-palette.tsx`, the composer's palette hooks in
`routes/session/session-composer.tsx`, the `load()` promise return in
`routes/session/seam-rows.ts`, `examples/session.tsx`) adds 0.

Batch 7 delta: 0. The powerline/status-bar path
(`routes/session/powerline.tsx`, `routes/session/status-bar.tsx`,
`examples/session.tsx`) adds 0 — both components consume vendored theme
tokens (RGBA) with the kit-era hex constants as no-provider fallbacks, and
import `ComponentTheme` from `theme/component` (the source of truth; the
context module does not re-export it).

Batch 6 delta: 0. The theme/keybind path (`src/seams/theme.ts`,
`routes/session/composer-keybinds.ts`, the token swaps in
`routes/session/{transcript,session-composer}.tsx`, the optional hooks in
`context/theme.tsx`, `examples/session.tsx`) adds 0.

Batch 5 delta: 0. The overlay path (`routes/session/turn-overlay-controller.ts`,
`routes/session/turn-overlays.tsx`, `examples/session.tsx`) and the seam
verdict/ask additions (`src/seams/session.ts`) add 0. The 2
queued-prompt-dialog errors in `routes/session/index.tsx` remain: they sit
in the vendored route, which is not yet mounted on the seam (the rebuilt
composer is a separate component).

Batch 4 delta: 0. The composer path (`routes/session/session-composer.tsx`,
`routes/session/composer-state.ts`, `examples/session.tsx`) and the
transcript bottom-slot change add 0. The 2 queued-prompt-dialog errors in
`routes/session/index.tsx` remain: they sit in the vendored route, which is
not yet mounted on the seam (the rebuilt composer is a separate component).

Batch 3 delta: −3. `routes/session/rows.ts` 3 → 0 (typed `Set<string>` at
the stub boundary). `routes/session/index.tsx` stays at 4 (2 in the
queued-prompt dialog, composer batch; 2 in the provider context
`messageIndex`/`pendingDelivery`, which read `unknown` from the stubbed
data memos — they clear when index.tsx mounts the seam transcript). The
rebuilt transcript path (`routes/session/seam-rows.ts`,
`routes/session/transcript.tsx`, `examples/transcript.tsx`) adds 0.
Bucket 1 below is now 39 (rows 3 → 0).

Residual errors classified by root cause and disposition:

| Bucket                                            | Count | Files                                                                                                   | Disposition                                                                                  |
| ------------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| client-stub downstream (SessionSeam resolves)      | 39    | dialog-model(10), stream-v2.subagent(6), demo(5), session/index(4), usage(4), app(2), event(2), dialog-model-free(2), stream-v2.transport(1), stream-v2.image(1), permission.shared(1), diff-viewer(1) | Vanish when `src/seams/session.ts` gets its real adapter (typed events/rows/catalog replace the `any` stubs) |
| plugin-stub downstream                             | 8     | plugin/render(4), plugin/api(2), plugin/context(2)                                                       | Later seam (plugin); not touched by SessionSeam                                               |
| strictNullChecks differential vs upstream `tsgo`   | 11    | stream-v2.transport(5), prompt/index(2), app(1), runtime(1), dialog-shell-output(1), diff-viewer(1)      | Local guards during view rebuild; not seam work                                               |

Transcript-path blockers for batches 3–5 (must resolve in adapter batch, all in
bucket 1): `routes/session/index.tsx`, `routes/session/rows.ts`,
`mini/stream-v2.{transport,subagent,image}.ts`, `mini/permission.shared.ts` —
23 of the 42 client-bucket errors sit in those files.

Never-rebuilt files (candidates for tsconfig exclusion at rebuild time):
`mini/demo.ts` (5 errors — demo simulation client). The remaining storybook /
devtools files carry no errors.

## SessionSeam (batch 2a)

`src/seams/session.ts` declares the typed contract the vendored view needs
from a session backend (sessions list/search/transcript, turn streaming with
approve callback, provider/catalog/usage reads, typed event push, lifecycle),
plus `NullSessionSeam` (test stub; drives events via `emit()`). The header
comment carries the full vendored-surface → seam → `RemoteHostSession`
mapping table derived from auditing all 113 `@opencode/client` import sites.
Dependency rule: tui-base imports nothing from `@dsh-opentui/*`; the real
adapter (`RemoteHostSession` → `SessionSeam`) lives in packages/shell and is
injected at the composition root (later batch). Tests:
`test/session-seam.test.ts` (interface conformance, event subscribe/emit,
dependency-direction guard).

## Seam transcript (batch 3)

`src/routes/session/transcript.tsx` + `src/routes/session/seam-rows.ts`:
the transcript viewport extracted from `routes/session/index.tsx`
(scrollbox `stickyScroll` + `stickyStart="bottom"`, keyed `marginTop=1`
rows, bottom slot for the composer) fed by `SessionSeam` instead of
`useData`/`useClient`. Rows are a Solid store keyed by a stable `key`
(`reconcile` on hydrate, in-place patch per delta). Assistant rows render
`<markdown streaming={!final}>`, as the vendored `TextPart` does on
@opentui 0.8.1; `renderNode`/`syntaxStyle` are injectable props (the
vendored app passes `plugins.markdown()` / `useThemes().currentSyntax`).
Tear check: `bun examples/transcript.tsx` (fake seam, 60 sentences + tool
rows). Tests: `test/seam-rows.test.ts`. Note: `bun test` resolves
solid-js's server build, whose `reconcile` ignores `key`; tests assert key
stability, and object identity is covered by the runtime example.

## Seam composer (batch 4)

`src/routes/session/session-composer.tsx` (`SessionComposer`) +
`src/routes/session/composer-state.ts` (`ComposerController`,
`ComposerHistory`): the session input area on `SessionSeam`. It is a native
`<textarea>`. Height follows the wrapped line count, capped at 1 to
`maxHeight` lines (default 8). The box height is explicit. Keys follow the
vendored keybind config (`input.submit` = return, `input.newline` =
alt/shift/ctrl+return, ctrl+j). They are applied through the textarea's
`keyBindings` prop, so the component needs no vendored Keymap context.
Busy behavior matches the vendored prompt: Enter during a running turn is
sent as a steer (`seam.steer`) and is not blocked. The footer shows a
busy marker, and `onBusyChange` exposes the same state for the status
batch. History is shell-style, aligned with the pi editor
(`navigateHistory`) and the mini composer: the first ↑ stashes the draft
(whole editor state — text plus cursor), ↑ walks newest → oldest without
wrapping, and ↓ past the newest restores that draft. Kept in memory with up
to 50 entries; typed input is never overwritten. In the real client the
arrows run through a priority-1 `Keymap` layer bound to
`prompt.history.previous` / `prompt.history.next`, so a config override is
honored; without a `Keymap.Provider` the textarea `onKeyDown` fallback
hardcodes up/down. Paste uses the textarea's built-in handling. The
transcript takes the composer as `children` and accepts a shared
`projection`. Run the session page skeleton with `bun examples/session.tsx`.
Tests: `test/composer.test.ts`, `test/composer-history-ft.test.ts`.

## Turn overlays (batch 5)

`src/routes/session/turn-overlays.tsx` + `src/routes/session/turn-overlay-controller.ts`:
the approval + ask surfaces rebuilt on the VENDORED dialog components and
wired through `SessionSeam`. Component mapping: `ui/dialog-confirm` →
`ApprovalCard` (tool name + one-line args summary; enter = allow, esc/
cancel = reject), `ui/dialog-select` → `AskPicker` (question + options,
arrows + enter, `renderFilter={false}`; esc declines the whole batch as an
empty selection — the tui-pi declined envelope downstream). Both mount
through the vendored `DialogProvider` stack (`dialog.replace`), in the
vendored provider closure (ConfigProvider → Keymap → Toast → ThemeProvider →
Clipboard → DialogProvider, the app.tsx order).

The seam contract grew the exact verdict strings (`SeamApprovalVerdict`:
"allowed-once" / "rejected" — shell parity) and `registerAskProvider`
(`{id,prompt,options}` → `{questionId,selected}` picks; shell
host-session parity), with `NullSessionSeam.ask()` for fakes/tests.
`createSeamRows` takes `options.onApprove` so a page routes approvals
through the card (default stays allow-through).

Focus discipline (OpenTUI law): overlay focus must return to the composer
on close. Three layers do it — the vendored DialogProvider captures the
focused renderable on replace and refocuses when the stack drains; the
controller's `onIdle` hook fires the host's `reclaimFocus` (3 ms, after the
vendored 1 ms refocus), which re-asserts via the composer's new focused-flag
ref (`SessionComposerRef.focused()` reads the textarea's LIVE renderable
flag — the login-era bug was a stale flag); the controller settles each
overlay exactly once (per-overlay `onClose` only settles while its overlay
is the shown one, so stack pops can't orphan a pending turn — esc on the
legacy confirm card resolves "rejected" through it).

Two rebuild bugs found by the tmux run, both in the host effect: reading the
tracked dialog stack it mutates remounted the card every frame (keymap
layers churned, dispatch died — fixed by diffing an overlay descriptor with
the stack read `untrack`ed), and the unregistered stack `onClose` let esc
pop the card without resolving (turn hung). Sequential multi-question asks
advance picker by picker via `dialog.replace`. Run with
`bun examples/session.tsx`. Tests: `test/turn-overlays.test.ts` (verdicts,
FIFO queue, sequential picks, declined envelope, idle/refocus point).

## Theme + keybinds (batch 6)

Theme source: the vendored theme system (`context/theme.tsx` ThemeProvider
over `src/theme` + `src/vendor/theme`). Default theme: `opencode` (the
vendored default, dark mode). The rebuilt transcript and composer now read
tokens via `useThemeOptional()`, mapped as the vendored route maps them:
text = `text.base`, user prompt = `text.action.primary`, reasoning =
`text.muted` + `border.base`, tool done/running/failed =
`text.feedback.{success,warning,error}`, loading = `text.feedback.info`,
composer bg = `decrease(background.raised.base)` (vendored prompt). The
transcript's default `syntaxStyle` is `useThemes().currentSyntax()`. With
no ThemeProvider mounted, the pre-batch-6 hex constants still apply. The
dialogs (batch 5) already used `useTheme().surface("dialog")`.

Switch stub: `src/seams/theme.ts`. `createThemeSeam(useThemes())` returns
`setTheme(name)`. It returns false and does nothing unless `name` is one of
the 33 bundled names (32 v1 assets + `opencode`; `system` is generated,
not bundled). It also provides `current()` and `list()`. Example:
`S_THEME=catppuccin bun examples/session.tsx`. Tests:
`test/theme-seam.test.ts`.

Keybinds: the composer's textarea `keyBindings` are now derived from
`config/keybind.ts` (`input.submit`, `input.newline`) by
`routes/session/composer-keybinds.ts`. They are not a hand-written list.
Overrides pass through `SessionComposer`'s `keybinds` prop. Tests:
`test/composer-keybinds.test.ts`.

| Key (default)                                   | Surface                   | Source                                                | Configurable                         |
| ----------------------------------------------- | ------------------------- | ----------------------------------------------------- | ------------------------------------ |
| enter (`return`)                                | composer submit / steer   | `input.submit` → `composerKeyBindings`                | yes (`keybinds` prop)                |
| shift/ctrl/alt+enter, ctrl+j                    | composer newline          | `input.newline` → `composerKeyBindings`               | yes (`keybinds` prop)                |
| numpad enter (`kpenter`)                        | composer                  | mirrors every `return` binding                        | follows `return`                     |
| ↑ / ↓ (history recall)                          | composer                  | `prompt.history.previous` / `prompt.history.next` → priority-1 `Keymap` layer (real client); hardcoded up/down `onKeyDown` fallback without a provider | yes on the Keymap path (`prompt.history.*`); the bare fallback is hardcoded |
| esc / ctrl+c (close top dialog)                 | DialogProvider modal layer | `ui/dialog.tsx` `bind: "escape"` / `"ctrl+c"`         | no (hardcoded in the vendored app too) |
| enter / esc / ← → (approval card)               | `ui/dialog-confirm`       | `Keymap.createLayer` binds in the vendored component  | no (hardcoded in the vendored app too) |
| ↑↓ / enter / pgup/pgdn / home/end (ask picker)  | `ui/dialog-select`        | vendored component (`dialog.select.*` in config)      | through the vendored Keymap layer, per `dialog.select.*` |
| pgup / pagedown (transcript page, batch 10f)    | transcript scrollbox      | `session.page.up` / `session.page.down` (`pageup,ctrl+alt+b` / `pagedown,ctrl+alt+f`) → `TranscriptScrollKeys` global Keymap layer | yes (config `session.page.*`) |
| ctrl+alt+b / ctrl+alt+f (transcript page)       | transcript scrollbox      | same ids, second chord in the defaults                 | yes (config `session.page.*`)         |
| ctrl+c (exit example)                           | renderer                  | `render(..., { exitOnCtrlC: true })`                  | no                                   |

Batch 10f transcript scrollback: `routes/session/transcript-scroll.tsx`
registers the vendored route's global keymap layer over the Transcript's
new `scrollRef` prop (wired in `examples/v2-entry.tsx` + the bench
`examples/session.tsx`). Scrolling rides `scrollBy(±1, "viewport")` — the
composer keeps focus (the layer never focuses; bindings consume the keys
before the focused editor). The layer is gated on an empty dialog stack
(`enabled: () => dialog.stack.length === 0`), so scroll keys are dead
while an approval/ask//model overlay is open. Follow-on-append is the
scrollbox's NATIVE stickyScroll (verified against @opentui 0.8.1: appends
follow only while the viewport sits at the bottom edge — a scroll-up
keeps its position through new rows, scrolling back re-engages; pinned by
`test/transcript-scroll.test.ts`). Mouse wheel does nothing in-app: the
renderer boots with `useMouse: false` (same commit — engine `mountEngine`
+ both page `render(...)` calls) so the terminal keeps native drag-select
and Cmd+C; PgUp/PgDn replace wheel scrollback.

## Batch 9a budget note (dev entry)

`examples/v2-entry.tsx` (batch 9a, dies at the batch-10 cutover) is the
first REAL boot of the rebuilt view: `./dsh-opentui --v2` composes
Transcript + SessionComposer + turn overlays + slash palette +
StatusBar/PowerlineFooter over shell's `RemoteSessionSeam` adapter and a
real resident host. Budget rules it lives under:

- The file is `@ts-nocheck`: it sits in this package's tsconfig include
  (`examples`), and its shell-side imports are COMPUTED dynamic imports so
  the shell client graph never enters tui-base's tsc program — the
  budgeted `tsc --noEmit` error count stays at 58.
- Composition laws it had to learn the hard way (kept here so batch 10
  does not rediscover them): children ride GETTERS (compiled-JSX law —
  eager children are created in the parent's owner scope and miss every
  context the provider sets), components compose through `@opentui/solid`'s
  own `createComponent` (plain solid's skips the renderer's owner/context
  glue), and the shell boot helpers must come from the preload-free
  `shell/src/client/boot-shared.ts` (client-entry.tsx registers the solid
  transform plugin on import and drags the old @opentui-0.7.0 graph in,
  which breaks the 0.8.1 renderer context).
