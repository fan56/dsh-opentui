# T18 implementation contract — `/settings` migrated to a panel-kit modal

- Status: **DRAFT implementation contract** (read-only investigation; no source changed)
- Date: 2026-11-12
- Scope source: `wayfinder-opentui-ui/tickets/T18-settings-modal-migration.md`
- Frozen spec: `wayfinder-opentui-ui/assets/panel-kit-spec.md` (v1 + §12 T17-INT1 + §13 T17-INT2)
- Survey: `wayfinder-opentui-ui/research/settings-panel-survey.md`
- Repo: `dsh-opentui` (`packages/tui-base`, `packages/panel-kit`)
- Evidence convention: every claim cites `file:line`. `$WEB` = `/opt/homebrew/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai` (installed web client `0.2.2-rc.1`, per survey).

---

## §1 Current state and evidence

### 1.1 Command registration and entry

| Fact | Evidence |
|---|---|
| `/settings` is a static slash command; it does not render anything itself, it calls `ctx.openSettings()` | `packages/tui-base/src/routes/session/commands.ts:775-782` |
| The entry wires `openSettings: () => openSettingsPanel()` | `packages/tui-base/examples/v2-entry.tsx:652` |
| The panel is mounted as the **6th sibling inside the root column**, immediately before `<Transcript>` | `packages/tui-base/examples/v2-entry.tsx:777` (panel) vs `:787` (transcript) |
| `openSettingsPanel(itemId?)` only sets a module signal `setBridgeOpen(...)`; a `createEffect` flips `open` and reloads local + host state | `settings-panel.tsx:884-886`, effect at `:1045-1064` |
| Second entry: the agents panel jumps to one settings row | `settings-panel.tsx:884` + survey B.1 (`agents-panel.tsx:695`) |

### 1.2 What is rendered today (the "weird window")

```tsx
// settings-panel.tsx:1371-1380
<box flexShrink={0} width="100%" height={totalLines() + 1}
     flexDirection="column" border={["left"]} ...>
```

- Inline block, not a modal: only a left border, raised background, no scrim, no z-index, no centering (`settings-panel.tsx:1371-1380`).
- `height = rendered rows + 1`, uncapped; `flexShrink={0}`; the transcript's flex space is what gets eaten (`settings-panel.tsx:954`, `:1373`; survey B.3 arithmetic: ~22-23 rows at 120x34, transcript left ~4).
- Rendering model is a flat list of pre-formatted text lines (`settingsLines`, `settings-panel.tsx:726-800`), not controls.
- Zone model: `["local","host","other"]`, each zone windowed to `MAX_ZONE_ROWS = 4` (`settings-panel.tsx:70`, `:77-91`).
- Three input levels: `list` / `options` / `input` (`settings-panel.tsx:915`, `openEditor` at `:1097`).

### 1.3 State sources and write channels (current, must be preserved)

**Read side**

| Source | Code | Notes |
|---|---|---|
| merged / profile / workspace config | `reloadLocal()`, `settings-panel.tsx:1008-1023` via `seam.configLoad()`, `configRaw()`, `workspaceConfig()` | seam types `seams/session.ts:427-443` |
| host settings document | `reloadHost()`, `:1025-1047`, `seam.settings.describe()` | `SeamSettingsFace`, `seams/session.ts:368-383` |
| permission catalog | same function, `face.permissionCatalog?.()` | `SeamPermissionCatalog`, `seams/session.ts:147-152` |
| host push updates | `face.onChanged(...)`, `settings-panel.tsx:1058-1063` | only while open |

**Write side (the hard constraints already encoded)**

| Path | Code | Semantics |
|---|---|---|
| local prefs | `props.seam.configSave?.(plan.patch)`, `settings-panel.tsx:1207` | `config.json` patch; then `applyLive(...)` at `:1228-1252` (`setMotionTier`, `setFooterHints`, `setHintsLocale`, theme face with `persist:false`) |
| host settings | `commitHostWrite(...)`, `settings-panel.tsx:1150-1200`, impl at `:600-660` | `settings.mutate` **path ops only**; write → `describe` → conflict re-read + retry **once** → `describe`; `refreshFailed` is surfaced |
| permission presets | options come from `permissionCatalog`; write is `settings.mutate("permission",[{op:"set",path:["defaultPreset"],...}])` | `buildHostItems`, `settings-panel.tsx:297-376`; whitelist `:132-141` |
| read-only namespaces | `buildOtherItems`, `:378-392` | one row per ns, `rev N`, never writable |

**Local rows (17) and host rows (4)** are enumerated in `LOCAL_SETTING_IDS` (`settings-panel.tsx:143-154`) and `HOST_SETTINGS_WHITELIST` (`:132-141`); survey B.2 has the value/default table. Footer hint ids/locales come from `hints-line.tsx:61` and `:74`.

**Save semantics today**

- Every row is **instant-apply**. There is no draft buffer, no Save/Cancel pair (`applyItem` writes immediately, `settings-panel.tsx:1132`).
- Validation is pure and already correct: `planLocalWrite` (`:521-570`, empty local number = unset), `planHostWrite` (`:575-600`, path ops only), `parseIntegerInput` (`:603-615`).
- Esc hierarchy: editor/picker → back to list; non-empty filter → clear; else close (`settingsEscape`, `settings-panel.tsx:864-869`; current keymap layer `:1276-1315`).
- Close runs teardown then refocuses after 3 ms (`close()`, `:1029-1043`).

### 1.4 panel-kit present state (verified, not assumed)

- Baseline test run in this investigation: `cd packages/panel-kit && bun test` → **99 pass / 0 fail / 468 expect / 7 files** (matches spec §13).
- Implemented and exported: `Panel` shell, `PanelStack`/`usePanels`, fade driver, theme projection helpers, `List`, `Button`, `Check`, `ConfirmDialog`, `Dropdown`, `InputRow`, host key adapter (`src/index.ts:16-117`).
- Shell behavior that matters for T18: one-shot **fade** only, no slide (`contracts.ts:83`, `panel.tsx:107-127`, spec §13); Esc is the only back action, no scrim hit-testing (`contracts.ts:287-290`); `beforeClose` guard (`contracts.ts:284-285`, `panel.tsx:131-151`); per-layer scrim and zIndex (`panel.tsx:234-255`); inner-first Esc via one router per layer (`panel.tsx:156-198`); focus blur/restore only, no initial focus (`stack.tsx:139-141`, `:73-90`).
- `PanelStack.confirm()` opens a `ConfirmDialog` layer and resolves a promise (`stack.tsx:174-205`).
- Static guards already enforce: no hardcoded colors outside `fallback.ts`, no timers, no tui-base imports (`test/shell.test.tsx:221-231`).

---

## §2 Gap list

### 2.1 panel-kit: already there vs must be added

| Need for T18 | Already in panel-kit | Must add |
|---|---|---|
| Modal shell (scrim, centering, z-index, fade, Esc, focus restore) | ✅ `Panel` + `PanelStack` | — |
| Left nav with sections | ✅ `List mode="single"` + `groups` (`list.tsx:358-451`) | Navigation "no filter" mode: `List` currently treats every printable key and Backspace as a query (`list.tsx:403-414`) and Esc clears the query before bubbling (`:406-409`). For a section nav this can silently hide sections. Add `filterable?: boolean` (default true) or force `query=""` controlled + ignore keys. |
| Body scrolling | ❌ none | `Panel.Body scroll` is declared in `contracts.ts:381-387` but **not implemented or exported**; `List` paints every row (`list.tsx:432-451`); no `scrollbox` usage anywhere in the package. T18's 12 General rows / 16 opentui rows will overflow at 80x24. |
| Slot components `Panel.Title/Body/Actions` | ❌ declared only (`contracts.ts:371-404`) | Implementation + export. `grep "PanelBody"` finds only the contract; `src/index.ts` exports only `Panel`. Without these, `Panel.Actions` (spec §8.1) cannot be composed. |
| Settings row layout (label left, control right) | ❌ rows are individual controls; `Dropdown`/`InputRow`/`Check` each paint their own label | Optional `Row` wrapper **or** accept per-control rows. Spec §3.11 says no other control is required, so prefer composition in the consumer. |
| Enum control | ✅ `Dropdown` (`dropdown.tsx:18-228`) | — |
| Boolean | ✅ interactive `Check` (`check.tsx:93`) | — |
| Number / text | ✅ `InputRow` incl. `readOnly`, `validate`, min/max (`input-row.tsx:20-233`) | — |
| Read-only value row | ✅ `InputRow readOnly` | — |
| Command jump (`/model`, `/plugins`, `/preset`, `/login`) | ✅ `Button variant="ghost"` (`button.tsx:80`) | Consumer must close the panel before dispatching the slash command. |
| Destructive confirm (discard draft) | ✅ `panels.confirm({destructive:true})` | Not needed in v1: no drafts (§3.4). |
| Initial keyboard focus inside a panel | ❌ | `Panel` never focuses the first control; `List`/`Button`/`Check` only respond through their own focusable renderable (`list.tsx:424`, `button.tsx:80`, `check.tsx:93`). Add a focus-first hook (`onReady` + renderer focus, or a `focusOrder` helper). Without it arrows/Enter do nothing in a real client. |
| Dropdown popup anchoring inside a scrolled body | ⚠️ explicit known simplification (`dropdown.tsx:11-15`) | Only required if body scrolling ships; otherwise cap rows and keep the popup below the trigger. |
| Controls that register on the layer router | ✅ `Dropdown`, `InputRow`, `ConfirmDialog` via `useControlKeys` (`dropdown.tsx:148`, `input-row.tsx:148`; `theme.ts:64`) | — |

### 2.2 Host-side integration gaps (outside panel-kit, required by T18)

| Gap | Evidence |
|---|---|
| **tui-base has zero panel-kit imports.** No `PanelStack`, `PanelKitProvider`, theme projection, motion adapter, or keymap adapter exists in the app. | `grep -rn "panel-kit\|PanelTheme\|PanelStack" packages/tui-base/src packages/tui-base/examples packages/shell/src` → no hits |
| package dependency missing | `packages/tui-base/package.json` dependencies contain no `@dsh-opentui/panel-kit`; panel-kit is `private: true` (`packages/panel-kit/package.json:5`) |
| tsconfig path alias missing | `packages/tui-base/tsconfig.json` `paths` has no panel-kit entry |
| theme projection missing | `PanelTheme` contract `contracts.ts:102-158` must be projected from `ResolvedThemeTokens` (`src/vendor/theme/src/tui/types.ts:25-73`) plus focus/current-row semantics (`src/skin/semantic.ts:56-72`, `:88-95`) |
| motion adapter missing | `PanelMotionAdapter` (`contracts.ts:169-183`) maps 1:1 onto `motionDecorationsEnabled()` / `motionFrameRate()` (`src/skin/motion.ts:156-180`) |
| keymap adapter shape mismatch | kit expects `{ mode.push, createLayer }` (`kit.tsx:56-61`); tui's `Keymap` has `mode.push` (`src/context/keymap.tsx:169-182`) but `createLayer` is a module-level function (`:207`), not an object method → one wrapper object is needed. The layer shape (`bindings:[{key,cmd}]`) is compatible (`keymap.tsx:236-245`). |
| version string has no runtime surface | only `packages/shell/package.json:3` `"version": "0.9.9"`; `scripts/build-client.mjs` runs `Bun.build` with no `define` and no version injection |
| build must bundle the workspace package | `scripts/build-client.mjs:63-83` bundles `client-entry.tsx`; adding a workspace dep is fine for Bun.build, but this must be re-verified in the build step |

---

## §3 Field mapping

Terminology: **instant** = write on change, no Save. All General rows are instant in web (`survey A.8`), so v1 has no draft sections and therefore no Save/Cancel band.

### 3.1 Navigation (6 entries)

| # | Nav entry | Source |
|---|---|---|
| 1 | General (通用) | web `settings.section` id `general`, order 0 (survey A.2) |
| 2 | opentui (TUI 专有) | new group, survey D.2 |
| 3 | Models | web order 10, v1 = command jump `/model` |
| 4 | Plugins | web order 15, v1 = command jump `/plugins` |
| 5 | Agent presets | web order 20, v1 = command jump `/preset` |
| 6 | Account | web order -10, v1 = command jump `/login` |

Spec §8.1 already fixes this list ("6 entries — exact list from T18"). Ordering recommendation: General, opentui, then web order (-10 Account first? web orders Account before General). Keep web nav order for the web-derived four: Account(-10), General(0), Models(10), Plugins(15), Agent presets(20), and place opentui immediately after General. **Needs user eye at the prototype gate**; recommend the six-item order `General, opentui, Models, Plugins, Agent presets, Account` because General is the landing section.

### 3.2 General — 12 web rows, 1:1

| # | web row (order) | Web semantics / channel (verified) | opentui row | Control | Read channel | Write channel | Notes |
|---|---|---|---|---|---|---|---|
| 1 | permission (-20) | options from `permissionPresets/catalog`; `settings.mutate("permission",[{op:"set",path:["defaultPreset"],value}])` | 权限默认预设 | `Dropdown` | `seam.settings.describe()` + `permissionCatalog()` (`settings-panel.tsx:297-376`) | `commitHostWrite` → `settings.mutate` | Existing logic is already 1:1; reuse `buildHostItems` as-is. No catalog ⇒ read-only note (preserve). |
| 2 | language (0) | ns `locale`, field `preference`; web writes `settings.mutate("locale", {preference})` (`$WEB/dsh-client-locale/lib/client.js:918`, `:1571`) | 语言 | `Dropdown` | host `locale` row | `settings.mutate("locale",[{op:"set",path:["preference"],value}])` | **Unverified**: whether the opentui profile host serves the `locale` namespace/schema. TUI currently consumes only `hintsLocale` (`hints-line.tsx:74`), so the value has no visible effect until full localization (map fog). Options: read the host schema enum; fallback to `HINT_LOCALES`. |
| 3 | appearance (10) | ns `ui-theme`, field `preference` ∈ `light/dark/system` (`$WEB/dsh-client-ui-theme/lib/client.js:993-995`, `:1086`) | 外观 | `Dropdown` (3 options) | local `themeMode` (`auto/dark/light`, `settings-panel.tsx:207-216`) | `configSave({themeMode})` + `themes.mode().set(..., {persist:false})` | Semantics map: `system→auto`, `dark→dark`, `light→light`. Web writes the host settings doc; opentui's theme mode is a **local** config key (`applyLive`, `:1241-1247`). Semantics 1:1, storage local. |
| 4 | font-size (11) | ns `ui-theme` `fontSize`/`codeFontSize`/`terminalFontSize` (`$WEB/dsh-client-ui-theme/lib/client.js:997`) | 字号 | `InputRow readOnly` | — | — | **N/A** (terminal owns typography, spec §5.1). Static note, no control. |
| 5 | transcript-view (12) | ns `ui-chat`: `transcriptView` ∈ compact/standard/detailed/verbose (default detailed), `collapseTiming` ∈ completion/next-input (default completion), `foldedReplies` ∈ all/final (default all) (`$WEB/dsh-client-ui-chat/lib/client.js:14795-14831`) | 工作步骤 | one `Dropdown` row → sub-layer with 3 `Dropdown`s | new local config keys | `configSave({transcriptView:{...}})` | Keeping **one** top-level row preserves the 1:1 row count; the sub-layer holds the 3 fields. Consumer does not exist yet (survey D.1) — see §5 open item. Alternative: 3 top-level rows (General becomes 14 rows). |
| 6 | developer-tools (15) | `ui-settings.enabled`, default true (survey A.9; `$WEB/dsh-client-ui-settings-general/lib/client.js:1358`) | 开发工具 | `Check` **or** `InputRow readOnly` | — | — | TUI has no developer-tools view. Decision required: N/A note (recommended, no invented behavior) or map to a real TUI surface (diff viewer / tool trace). |
| 7 | shortcuts (16) | web reference modal; editing lives in browser-local `dsh.keybindings.v1` (survey A.8) | 快捷键 | `InputRow readOnly` (hint text) or `Button ghost` → read-only sub-panel | keymap defaults (`src/context/keymap.tsx`) | none | v1 read-only, per T18. Customization is fog. |
| 8 | link-opening (17) | ns `ui-chat`, field `linkOpening` ∈ sidebar/new-tab, hidden when no browser tab (`$WEB/dsh-client-ui-chat/lib/client.js:15347`, `:14827`) | 链接打开方式 | `InputRow readOnly` | — | — | **N/A**: TUI has no embedded browser (survey D.1). Note only. |
| 9 | composer-enter (20) | ns `ui-conversation`, field `busyEnter` ∈ queue/steer, default **queue** (`$WEB/dsh-client-ui-conversation/lib/client.js:16328-16336`) | 忙碌时 Enter | `Dropdown` | new local key | `configSave({busyEnter})` | Consumer must change: today `submit()` always steers while busy (`composer-state.ts:252-263`) and `submitWhileBusy()` asks through the popup (`:276-300`). Wiring `busyEnter` removes/overrides the chooser. Decide default and whether "ask" stays a third option. |
| 10 | performance-usage (30) | ns `ui-chat`, field `performanceUsage` ∈ compact/detailed, default detailed (`$WEB/dsh-client-ui-chat/lib/client.js:14826-14831`) | 性能与用量 | `Dropdown` | new local key | `configSave({performanceUsage})` | No TUI consumer today. Either define a footer/status detail consumer or render N/A. |
| 11 | session-log (90) | ns `session-log-deepseek`, field `enabled`, default true | Session Log 上传 | `Check` | host describe | `commitHostWrite` | Existing host row, already 1:1 (`settings-panel.tsx:139`). |
| 12 | current-version (100) | read-only build version | 当前版本 | `InputRow readOnly` | new version source | — | No runtime version surface today (`packages/shell/package.json:3` only). Needs build-time or env injection. |

Count check: 12 rows. Rows 4 and 8 are informational (no dead control), as T18 requires. Rows 6, 10 are the two rows where "1:1" collides with a missing TUI surface (§5).

### 3.3 opentui-only group (D.2, all preserved)

Recommended placement: 16 rows. `theme` (theme name) is listed here because the General appearance row consumes `themeMode` only.

| Row | Options / range | Control | Read / write | Live effect |
|---|---|---|---|---|
| theme | theme list from `themeFace.list()` | `Dropdown` | `configLoad()` merged → `configSave({theme})` | `themes.set(name,{persist:false})` (`settings-panel.tsx:1240`) |
| workspaceThemeMode | auto/dark/light | `Dropdown` | workspace config read → `configSave({workspaceThemeMode})` | `themes.mode().set(...,{persist:false})` (`:1241-1247`) |
| motion | auto/full/reduced/off | `Dropdown` | merged config → `configSave({motion})` | `setMotionTier` (`:1231-1234`) |
| footerHints ×8 | on/off | `Check` ×8 | merged `footerHints` (`hints-line.tsx:61`) → `configSave({footerHints:{...}})` | `setFooterHints` (`:1235-1238`) |
| hintsLocale | en/zh-CN/ja/ko (`hints-line.tsx:74`) | `Dropdown` | merged → `configSave({hintsLocale})` | `setHintsLocale` (`:1239`) |
| cacheHitMode | lastMessage/session | `Dropdown` | merged → `configSave({cacheHitMode})` | footer CH reads merged config (`seams/config.ts:9-34`) |
| retentionDays | integer ≥0, empty = unset | `InputRow kind="number"` | merged → `configSave` | local retention consumer |
| maxRounds | integer ≥0 | `InputRow kind="number"` | merged → `configSave` | subagent cap |
| maxRoundsGrace | integer ≥0 | `InputRow kind="number"` | merged → `configSave` | wrap-up window |

All write plans already exist (`planLocalWrite`, `settings-panel.tsx:521-570`), including the `footerHints` full-map rewrite and `empty = unset` for local numbers.

### 3.4 Host rows and other namespaces

| Group | Rows | Control | Channel |
|---|---|---|---|
| Host (4) | `subagent.maxActiveSubagents`, `subagent.maxDepth`, `permission.defaultPreset`, `session-log-deepseek.enabled` | `InputRow number` ×2, `Dropdown`, `Check` | `commitHostWrite` (`settings-panel.tsx:600-660`); keep path-op-only rule and conflict retry |
| Other namespaces | one row per non-whitelisted ns, `rev N` | `InputRow readOnly` or disabled `List` | read-only; note `只读 · 本 TUI 不消费` |

`schemaDeclaresPath` / baseline-absent handling (`settings-panel.tsx:297-376`, tests at `test/settings-panel.test.ts:90-321`) must be preserved verbatim in the new section builders.

### 3.5 Big sections v1 = command jump rows

| Section | v1 body |
|---|---|
| Models | `Button ghost` "Open /model" + one line explaining the full provider/API-key page is deferred |
| Plugins | `Button ghost` "Open /plugins" |
| Agent presets | `Button ghost` "Open /preset" |
| Account | `Button ghost` "Open /login" |

Dispatch rule: close the panel first (`handle.close()`), then run the command. Do not dispatch while the modal key scope is active.

### 3.6 Save, cancel, rollback semantics

- **General / opentui / host rows:** instant apply. There is no Save button, no dirty state, so `beforeClose` is not required in v1. Cancelling = Esc; already-applied rows stay applied (web parity).
- **Drafts:** none in v1 (the web draft+Save cards live under the plugin manager page, not under these six sections — survey A.5). If a later section adds drafts, use `Panel.Actions` + `beforeClose` + `panels.confirm({destructive:true})`.
- **Local failure:** `configSave` throws → do not apply live, show inline error, keep the panel open (`settings-panel.tsx:1204-1215`). `configSave` ok but live apply throws → currently `console.error` only (`:1250-1252`); in the new UI surface this as a warning row ("persisted but live apply failed") instead of claiming success.
- **Host failure:** preserve the existing contract verbatim — conflict retry once, a failed re-read is never retried blind, a successful write with failed refresh is reported as "written but not refreshed" (`settings-panel.tsx:600-660`, `:1160-1200`). Render the message inside the panel body, next to the row, not in transcript.
- **Partial failure with multiple pending writes:** v1 is instant-apply and serialized by the modal (one write at a time); keep the existing `busy` guard (`settings-panel.tsx:1132-1140`).

---

## §4 Implementation steps (each ≤30 min, independently verifiable)

> Prerequisite note: step 2 requires `pnpm install` in the implementation task (forbidden in this investigation). All commands assume repo root `~/repo/dsh-opentui`.

### S0 — Add the missing panel-kit layout primitives (30 min)

- Files: `packages/panel-kit/src/panel.tsx` (or new `src/slots.tsx`), `packages/panel-kit/src/index.ts`, `packages/panel-kit/test/slots.test.tsx`.
- Work: implement/export `PanelTitle`, `PanelBody` (including `scroll` via `scrollbox` or an explicit "unsupported" error), `PanelActions`; add `ListProps.filterable?: boolean` for nav lists. If scrollbox is too risky, make `PanelBody scroll` clamp to a fixed row window and document pagination instead — decide in S0 and record it.
- Verify:
  - `cd packages/panel-kit && bun test` → expect 99 + new tests pass.
  - `cd packages/panel-kit && bunx tsc --noEmit` → 0 errors.
- Accept: no timers/hardcoded colors introduced (guards at `test/shell.test.tsx:221-231`).

### S1 — Host adapter module in tui-base (30 min)

- Files: `packages/tui-base/src/panel-kit/host.tsx` (new), `packages/tui-base/package.json`, `packages/tui-base/tsconfig.json`.
- Work: `PanelTheme` projection from `ResolvedThemeTokens` (`src/vendor/theme/src/tui/types.ts:25-73`, `src/skin/semantic.ts:56-95`); motion adapter over `motionDecorationsEnabled`/`motionFrameRate` (`src/skin/motion.ts:156-180`); keymap adapter wrapper `{ mode: keymap.mode, createLayer }` (`src/context/keymap.tsx:169-207`); export `PanelKitHost`.
- Verify:
  - `cd packages/tui-base && bunx tsc --noEmit`
  - `cd packages/panel-kit && bun test` (unchanged baseline)
- Accept: projection is pure, no hardcoded hex, contrast pairs reach ≥4.5:1 under dsh-blue (spec §7.3).

### S2 — Mount the stack and provider (20 min)

- Files: `packages/tui-base/examples/v2-entry.tsx`.
- Work: wrap the root children in `<PanelKitProvider theme motion keymap>` + `<PanelStack>`; keep the old `SettingsPanel` mounted for now (dual mount is temporary and must not be committed).
- Verify: `bun run typecheck`; `bun run test:unit`; build smoke `node scripts/build-client.mjs` (if it runs in the environment).
- Accept: no panel exists at boot; `/settings` still opens the old panel.

### S3 — Pure section model (30 min)

- Files: `packages/tui-base/src/routes/session/settings-sections.ts` (new), `packages/tui-base/test/settings-sections.test.ts` (new).
- Work: nav model (6 entries), section→row builders reusing `buildLocalItems`/`buildHostItems`/`buildOtherItems` and write planners unchanged; row descriptor `{ id, section, label, kind, value, options, control, write, note }`.
- Verify: `cd packages/tui-base && bun test test/settings-sections.test.ts`; `bun run test:unit`.
- Accept: pure, no renderer; General builder yields exactly 12 rows, opentui yields 16, host 4, other N.

### S4 — Panel shell + left nav + General body (30 min)

- Files: `packages/tui-base/src/routes/session/settings-modal.tsx` (new).
- Work: `size:"xlarge"`, left `List` nav (fixed 20-24 cells), right content; General rows via `Dropdown`/`Check`/`InputRow`; N/A rows as `InputRow readOnly`; transcript-view sub-layer.
- Verify: `bun run typecheck`; launch the client in tmux at 120x34, `/settings`, capture `.ans`; assert 12 rows and 6 nav entries.
- Accept: no row is clipped at 120x34; Esc closes in one press from the root list.

### S5 — opentui section (20 min)

- Files: same modal file + `settings-sections.ts`.
- Work: 16 rows, `footerHints` grouped with `List` group label; local writes wired to `configSave` + the live appliers (`settings-panel.tsx:1228-1252`).
- Verify: write `motion=full`, `footerHints.send=off`, `retentionDays=7`; confirm `config.json` patch and live footer change; capture.

### S6 — Host section + other namespaces + command jumps (25 min)

- Files: same modal file.
- Work: 4 host rows through `commitHostWrite`; read-only ns list; four `Button ghost` jumps that close the panel then dispatch `/model`, `/plugins`, `/preset`, `/login`.
- Verify: permission dropdown reflects catalog options; force a conflict (two clients) and confirm the retry message; capture.

### S7 — Error/status surfacing and busy guard (20 min)

- Files: same modal file.
- Work: inline error row (host message verbatim; local persisted-vs-live divergence warning); one write at a time; disable the active control while busy.
- Verify: unit tests for the error mapping; manual failed `describe` (mock seam) shows inline text, panel stays open.

### S8 — Esc, focus, compact degradation (25 min)

- Files: modal file, `src/panel-kit/host.tsx`.
- Work: focus the nav on open; focus the first row when switching sections; Esc from sub-layer → section → close (no filter level); width <64 → single column (nav collapses to a header line or a `List` above content).
- Verify: at 80x24, the panel fits `cols-2 × rows-4` with ≥3 body rows (spec §5.4); Esc never requires two presses; capture.

### S9 — Remove the inline panel and update open/close wiring (20 min)

- Files: `packages/tui-base/examples/v2-entry.tsx`, `packages/tui-base/src/routes/session/settings-panel.tsx`, `packages/tui-base/src/routes/session/index.tsx`, `packages/tui-base/src/routes/session/commands.ts` (only if the open hook moves).
- Work: unmount the old `SettingsPanel`; keep `openSettingsPanel`/`settingsPanelOpen` names as thin wrappers over the stack handle so `/settings`, the sidebar Esc gate (`index.tsx:278`) and the agents jump keep working; delete the old keymap layer to avoid double Esc handling.
- Verify: `bun run test:unit`; `/settings` still opens; transcript does not shrink (capture before/after row counts).

### S10 — Test rewrite and gates (30 min)

- Files: `packages/tui-base/test/settings-panel.test.ts`, new `test/settings-modal-ft.test.tsx`, `verify/agents-mount-repro.mjs`.
- Work: keep pure builder/planner/conflict tests; delete zone-title / `MAX_ZONE_ROWS` / line-layout tests; update `agents-mount-repro.mjs:442-500` (three zone titles → nav entries + General rows + motion row + Esc close).
- Verify:
  - `bun run test:unit`
  - `bun run test:ft`
  - `node verify/agents-mount-repro.mjs`
  - `node verify/ui-matrix.mjs` (note: ui-matrix has **no settings scene today**, see §6)

### S11 — Real-device review gate (20 min)

- Work: capture 120x34 and 80x24 frames open, General, opentui, host, jump rows, and the close; paste frame tails verbatim to the user.
- Verify: user sign-off, then commit with the repo default identity (fan56).

---

## §5 Risks and open items (user decisions required)

1. **Transition conflict (blocking).** T18 ticket text says "从顶部滑入到面板中央、上浮退出" (slide in/out). The frozen spec removed slide: `§4.5 Slide — deferred`, `§13 Transition amendment — slide → fade`, implementation has no slide constants (`contracts.ts:39-46`, `panel.tsx` has no geometry writes). Options: (a) keep fade per spec/T17 decision, amend T18 wording; (b) reinstate slide, which requires a per-frame residue audit (§4.5) and reopens the paint-bug risk. **Needs explicit user call.**
2. **Scrolling.** Spec §8.1 says "content scroll"; panel-kit has no scroll primitive today (§2.1). Choose: implement `PanelBody scroll` + dropdown anchoring (more work, unverified anchoring) **or** paginate sections to fit (`PgUp/PgDn` windows, like the current `MAX_ZONE_ROWS` but larger). Pagination is lower risk; scrolling is the better product. **Needs user call.**
3. **Transcript-view 3 fields.** Values and consumers do not exist in the TUI (`survey D.1`). Adding `transcriptView`/`collapseTiming`/`foldedReplies` means real behavior changes in the transcript. Approve semantics (and default `detailed`/`completion`/`all`) or mark the row N/A in v1. Same class of decision for `performanceUsage` and `developer-tools`.
4. **Language row write target.** Web writes host ns `locale` field `preference` (`$WEB/dsh-client-locale/lib/client.js:918`, `:1571`). The opentui host's served namespaces are unknown (unverified). If `locale` is not served/as writable, choose: local config key (no cross-client effect) or read-only N/A. Also decide the option list: web's 8 languages vs TUI's 4 hint locales (`hints-line.tsx:74`).
5. **`busyEnter` behavior change.** Today busy Enter either steers directly (`composer-state.ts:252-263`) or asks through a popup (`:276-300`). Web's default is `queue` (`$WEB/dsh-client-ui-conversation/lib/client.js:16334`). Adopting it silently changes current TUI behavior; decide whether the existing chooser remains as an "ask" option.
6. **Version source.** No runtime version string exists. Options: `Bun.build({define})` injection in `scripts/build-client.mjs`, env var set by `client-entry.tsx`, or omit the row. Recommend build-time define; do not import `packages/shell/package.json` from tui-base (dependency inversion).
7. **Appearance storage.** Web writes `ui-theme.preference` to host settings; opentui's theme mode is local config (`settings-panel.tsx:207-216`, `applyLive:1241-1247`). Confirm "semantics 1:1, storage local" is acceptable (recommended) rather than inventing a host `ui-theme` row the TUI does not consume.
8. **Nav order and panel size.** Spec §8.1 says `xlarge` (116); §10 item 7 notes the user may prefer `large` (88). Also confirm the six-entry order. UI gate decides.
9. **Duplicate row count risk.** If transcript-view is split into 3 top-level rows, General is 14 rows, not 12. The recommended design keeps one top-level row + sub-layer to preserve "12 rows 1:1"; confirm.
10. **`destroy`/focus edge.** panel-kit has no initial-focus mechanism (§2.1). If S8's focus work is deferred, the real client may show a panel that ignores arrows/Enter. Not a user decision, but a ship blocker.
11. **panel-kit README is stale** (says "four-side slide", `packages/panel-kit/README.md:3-4`). Update it in the implementation task or separately; does not affect code.

---

## §6 Test strategy

### 6.1 Baselines (measured now)

| Suite | Command | Baseline |
|---|---|---|
| panel-kit | `cd packages/panel-kit && bun test` | **99 pass / 0 fail / 468 expect / 7 files** |
| panel-kit types | `cd packages/panel-kit && bunx tsc --noEmit` | 0 errors (spec §13; re-run in S0) |
| settings panel unit | `cd packages/tui-base && bun test test/settings-panel.test.ts` | 672-line file, pure tests only (no renderer) |
| repo tiers | `bun run test:unit`, `bun run test:ft`, `bun run test:ui`, `bun run test:e2e` | `scripts/test-tier.mjs` classification: unit unless `-ft.test.tsx` / `testRender(` / `verify:` marker (`scripts/test-tier.mjs:38-52`) |

### 6.2 panel-kit additions (S0)

- `slots.test.tsx`: `PanelActions` renders primary/secondary and stays outside a scrolled body; `PanelBody scroll` clamps; `List filterable=false` ignores printable keys but keeps arrows/Enter.
- Keep the existing static guards (`test/shell.test.tsx:221-231`) green: no literal colors, no timers, no tui-base import.
- If scrollbox is used: add a test that the panel frame height never changes while scrolling (no layout animation).

### 6.3 tui-base additions

- **Pure unit** (`settings-sections.test.ts`): nav has 6 entries; General exactly 12 rows in web order; opentui exactly 16; host 4; N/A rows are `readOnly` and carry a note; write plans are the existing planners (no new write shapes).
- **Preserved from the old suite** (`test/settings-panel.test.ts`): whitelist shape, baseline-absent `n/a`, schema enum/bounds, `planLocalWrite`, `planHostWrite`, conflict retry, refresh-failed, read-only document, no-settings-face degradation. These are the semantic contract and must not regress.
- **Removed**: zone-title assertions (`:568-607`), `MAX_ZONE_ROWS` windowing, `settingsLines` layout, `settingsEscape` filter level (`:559-566`).
- **ft (real renderer)**: new `test/settings-modal-ft.test.tsx` using `@opentui/core/testing` (the same marker the tier runner uses, `scripts/test-tier.mjs:44`):
  - opens via `panels.open(...)`; asserts the 6 nav labels and the General rows in the captured frame;
  - Esc from root closes in one press; Esc from a sub-layer returns to the section;
  - `beforeClose` not invoked (no drafts) — assert no Save button exists;
  - 80x24: panel width ≤ `cols-2`, height ≤ `rows-4`, ≥3 body rows.
- **App-level (real client)**:
  - `verify/agents-mount-repro.mjs:442-500` must be rewritten: `/settings opens the six-section panel`, General has 12 rows, opentui motion row writable, `本 TUI 不消费` note still present, Esc closes; keep the existing write-back checks (motion full/auto) at `:475-500`.
  - `verify/ui-matrix.mjs` **has no settings scene today** (header scenes 1-8, `verify/ui-matrix.mjs:1-40`; `grep -i settings` only matches the fixture file list at `:273`). T18's "ui-matrix 全几何" therefore requires either adding a settings scene or scoping the gate to agents-mount + panel-kit ft. Recommend adding one scene (`9 settings modal`) at 120x34 and 80x24, asserting frame border, nav column width, General row count, no overflow.
  - `e2e`: no settings scenario exists (`grep -l settings e2e/scenarios` hits only unrelated login/cache-hit/stop/attention scripts). No e2e change required unless a host-write leg is added.

### 6.4 Gate order for the implementation task

1. `cd packages/panel-kit && bunx tsc --noEmit && bun test`
2. `cd packages/tui-base && bunx tsc --noEmit`
3. `bun run test:unit`
4. `bun run test:ft`
5. `node verify/agents-mount-repro.mjs`
6. `node verify/ui-matrix.mjs` (only if the settings scene is added)
7. tmux real captures (120x34, 80x24) → user frame review → commit (fan56)

---

## Appendix A — Exact web write shapes (for 1:1 review)

| Row | Namespace | Field / path | Values | Default |
|---|---|---|---|---|
| permission | `permission` | `defaultPreset` | catalog options | `catalog.defaultPreset` or inferred |
| language | `locale` | `preference` | registered locale packs (zh/en/ja/es/fr/de/ru/pt in web) | browser list |
| appearance | `ui-theme` | `preference` | light / dark / system | system |
| font-size | `ui-theme` | `fontSize` / `codeFontSize` / `terminalFontSize` | 10-22 / 10-16 / 10-20 px | 14 / 11 / 13 |
| transcript view | `ui-chat` | `transcriptView` | compact / standard / detailed / verbose | detailed |
| collapse timing | `ui-chat` | `collapseTiming` | completion / next-input | completion |
| folded replies | `ui-chat` | `foldedReplies` | all / final | all |
| developer tools | `ui-settings` | `enabled` | boolean | true |
| link opening | `ui-chat` | `linkOpening` | sidebar / new-tab | sidebar |
| busy Enter | `ui-conversation` | `busyEnter` | queue / steer | queue |
| performance usage | `ui-chat` | `performanceUsage` | compact / detailed | detailed |
| session log | `session-log-deepseek` | `enabled` | boolean | true |

Evidence: survey A.9 plus the specific `$WEB` lines cited in §3.2 (`dsh-client-locale/lib/client.js:918`, `dsh-client-ui-theme/lib/client.js:993-995,1086`, `dsh-client-ui-chat/lib/client.js:14795-14831,15347`, `dsh-client-ui-conversation/lib/client.js:16328-16336`).

## Appendix B — What must NOT change

- Host writes remain **path ops only**; never `settings/replace` (`settings-panel.tsx:14-30`).
- Every host write is followed by a fresh `describe`; conflict retried once; second conflict surfaced (`:600-660`).
- `describe().writable === false` disables every write control and explains why (`settingsWritable`, `:692-708`).
- Baseline-absent keys render `n/a`, never a guessed default (`:297-376`, tests `:90-139`).
- Permission enum comes from `permissionPresets/catalog` when available; otherwise read-only effective value (`:297-376`).
- Empty local number = unset; empty text/host number = refused (`:521-615`).
- panel-kit motion red lines: no per-row stagger, no width/height/margin animation, no border-color animation (`spec §4.4`; guards in `packages/panel-kit/test/shell.test.tsx:228-231`).
