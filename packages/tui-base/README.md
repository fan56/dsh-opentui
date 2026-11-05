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
