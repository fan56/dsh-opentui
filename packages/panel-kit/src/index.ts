/**
 * Public surface for @dsh-opentui/panel-kit.
 *
 * contracts.ts is the single source of truth (types + spec-pinned constants);
 * every implementation module is appended below with an explicit named export
 * list. Names that existed twice across lanes keep ONE canonical export:
 *   - PanelKitContext / panelKitContext / usePanelKit / usePanelTheme /
 *     useControlKeys live in theme.ts (T17-INT1 B3/B5); confirm.tsx re-exports
 *     them for module-level back-compat but they are exported here once.
 *   - PanelShellHandle is defined in contracts.ts (panel.tsx re-exports it);
 *     only the contracts export is listed.
 */
export * from "./contracts"

// -- Theme fallback ---------------------------------------------------------
export { FALLBACK_THEME } from "./fallback"

// -- Panel shell ------------------------------------------------------------
export { Panel, resolvePanelHeightLimit, resolvePanelMetrics, resolvePanelWidth } from "./panel"
export type { PanelShellProps } from "./panel"

// -- Motion (phase machine + shared-clock fade driver) ----------------------
export {
  clamp01,
  createFadeDriver,
  motionDegraded,
  motionRate,
  nextPanelPhase,
  phaseAnimates,
} from "./motion"
export type { FadeDriver, FadeDriverOptions, PanelPhase, PanelPhaseEvent } from "./motion"

// -- Theme injection (the one context) + projections ------------------------
export {
  PanelKeyRoutingContext,
  PanelKitContext,
  STATIC_MOTION,
  fadeColor,
  fadeTheme,
  panelKitContext,
  resolveFrameToken,
  resolveIdentity,
  resolveScrimAlpha,
  resolveScrimColor,
  resolveTitleColor,
  toAccessor,
  useControlKeys,
  usePanelKeys,
  usePanelKit,
  usePanelTheme,
} from "./theme"

// -- Text / cell helpers ----------------------------------------------------
export {
  align,
  fitColumns,
  fitRow,
  graphemes,
  hasWideGlyphs,
  measure,
  padEnd,
  padStart,
  takeCells,
  truncate,
} from "./text"

// -- Controls: List ---------------------------------------------------------
export {
  List,
  buildListRows,
  firstEnabledId,
  fuzzyFilter,
  listColumnRow,
  listColumnValues,
  listPageIndicator,
  listReduce,
  moveActiveId,
  nextListPage,
  resolveListColumns,
  resolveListPage,
  truncateCells,
  useControlTheme,
} from "./controls/list"
export type {
  ListAction,
  ListControlProps,
  ListOutcome,
  ListPageWindow,
  ListReduceInput,
  ListRow,
  ListState,
  ResolvedListColumn,
} from "./controls/list"

// -- Slots (v1.1: /settings + /agents) --------------------------------------
export { PanelActions, PanelBody, PanelTitle, titleGradientStops } from "./slots"
export type { TitleStop } from "./slots"

// -- Controls: Button -------------------------------------------------------
export { Button, buttonVisual, pressButton } from "./controls/button"

// -- Controls: Check --------------------------------------------------------
export { Check, checkStateOf, nextCheckState, toggleCheck } from "./controls/check"
export type { CheckControlProps, CheckState } from "./controls/check"

// -- Controls: ConfirmDialog ------------------------------------------------
export { ConfirmDialog, createConfirmModel } from "./controls/confirm"
export type { ConfirmAction, ConfirmButtonState, ConfirmModel } from "./controls/confirm"

// -- Controls: Dropdown -----------------------------------------------------
export { DROPDOWN_MAX_ROWS, Dropdown, createDropdownModel } from "./controls/dropdown"
export type { DropdownModel, DropdownWindow } from "./controls/dropdown"

// -- Controls: InputRow -----------------------------------------------------
export { InputRow, createInputRowModel, parseNumberText } from "./controls/input-row"
export type { InputRowModel } from "./controls/input-row"

// -- Host wiring (T17-INT2) -------------------------------------------------
export { PANEL_KEY_IDS, PanelKitProvider, createHostKeyAdapter } from "./kit"
export type {
  PanelKeyId,
  PanelKeymapBinding,
  PanelKeymapHost,
  PanelKeymapLayer,
  PanelKitProviderHostProps,
} from "./kit"

// -- Stack host (T17-INT2) --------------------------------------------------
export { PanelStack, usePanels } from "./stack"
