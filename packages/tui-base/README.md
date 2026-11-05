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

### Error budget (batch 3, exact count: 58; batch 2a was 61)

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
rows, fixed bottom input box) fed by `SessionSeam` instead of
`useData`/`useClient`. Rows are a Solid store keyed by a stable `key`
(`reconcile` on hydrate, in-place patch per delta). Assistant rows render
`<markdown streaming={!final}>`, as the vendored `TextPart` does on
@opentui 0.8.1; `renderNode`/`syntaxStyle` are injectable props (the
vendored app passes `plugins.markdown()` / `useThemes().currentSyntax`).
Tear check: `bun examples/transcript.tsx` (fake seam, 60 sentences + tool
rows). Tests: `test/seam-rows.test.ts`. Note: `bun test` resolves
solid-js's server build, whose `reconcile` ignores `key`; tests assert key
stability, and object identity is covered by the runtime example.
