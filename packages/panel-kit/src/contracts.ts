/**
 * contracts.ts — frozen API surface for @dsh-opentui/panel-kit.
 *
 * This file is the single source of truth for the three parallel adapters
 * (shell / controls / stack+demo). It contains TYPES and spec-pinned
 * CONSTANTS only: no component implementation, no theme values, no timers.
 *
 * Sources: assets/panel-kit-spec.md §3 (component signatures), §7 (theme
 * tokens), §2.2 (decision D1: the kit never imports tui-base).
 *
 * T17-INT1 integration amendments (2026-11-12) — all 14 lane requests arbitrated:
 *   A1 ACCEPTED  PanelProps gains depth/active/onReady + PanelShellHandle.
 *   A2 DECIDED   Esc owner = Panel; PanelKeyAdapter is transport, beforeClose is
 *                semantics; standalone fallback is useKeyboard("escape") only.
 *   A3 DECIDED   §4.5 fade covers shell chrome only (title/subtitle); body is
 *                consumer-owned and MUST be static during the slide (§5.3).
 *   A4 ACCEPTED  Content-sized height: first frame clamps slide amplitude
 *                conservatively against maxHeight (documented on `height`).
 *   B1 ACCEPTED  CheckProps gains indeterminate + indeterminateGlyph.
 *   B2 ACCEPTED  ListProps gains controlled query/onQueryChange and width.
 *   B3 DECIDED   ONE theme injection point: src/theme.ts PanelKitContext +
 *                panelKitContext()/usePanelKit()/usePanelTheme(). The Symbol.for
 *                registry and the list.tsx dual read are removed.
 *   B4 RATIFIED  No action.* tokens in v1: Button primary projects onto
 *                row.activeBg/row.activeFg; danger onto text.danger (see §7).
 *   B5 DECIDED   Canonical hooks live in theme.ts and are exported once.
 *   C1 DECIDED   Key routing: one modal table per layer (Panel) + per-layer
 *                PanelKeyRouter (innermost-first handlers); focusable controls
 *                keep the renderable key path. See PanelKeyRouter.
 *   C2 DECIDED   Theme host pinned to src/theme.ts (same as B3).
 *   C3 RATIFIED  Confirm destructive || tone "danger" -> danger button;
 *                otherwise primary (documented on ConfirmOptions.tone).
 *   C4 RATIFIED  InputRow commit modes: Enter always; blur on blur; change per
 *                edit; stepper settle always (documented on commit).
 *   C5 RATIFIED  Dropdown Space == Enter; Esc closes only the popup and is
 *                unconsumed when closed (documented on DropdownProps).
 * No new motion constants or timer APIs were introduced.
 *
 * T17-INT2 transition amendment (2026-11-12) — slide was replaced by fade:
 *   • PanelOptions drops enterFrom/exitTo; SLIDE_MS, VERTICAL_OFFSET,
 *     HORIZONTAL_OFFSET, SlideGeometry and SlideState are removed. Slide is
 *     DEFERRED in v1 (spec §4); FADE_MS stays.
 *   • The shell fades the whole themed subtree from theme.background.surface
 *     toward the resolved tokens on enter and back on exit. No layout writes,
 *     no per-row loop; reduced/off still jump.
 *   • PanelHandle close() now fades out (FADE_MS) before unmounting.
 *
 * v1.1 amendment (2026-11-12) — /settings + /agents migration:
 *   • IMPLEMENTED ListItem.cells / ListProps.columns (were contract-only).
 *     ListColumn gains optional `title` for the header row. Columns are fixed
 *     cell widths with left/right alignment; a row without a cell falls back
 *     to `label` in the first column; a narrow host `width` shrinks the
 *     declared widths (widest first, floor 1) and truncates with "…", so rows
 *     never overlap or overflow the budget. badge/description keep their v1
 *     positions around the column block.
 *   • IMPLEMENTED ListProps.pageSize (paged window, NOT a scroll container).
 *     At most pageSize render rows are painted; PgUp/PgDn/Home/End page the
 *     focused list and a right-aligned "first-last/total" indicator appears at
 *     the tail. Keys are consumed only while the list exceeds one page.
 *
 * v1.1 amendment (2026-11-13) — List cursor/page coupling:
 *   • UPGRADED contract: the active row must always be inside the painted page
 *     window. When activeId moves out of the window (up/down, Home/End, a
 *     controlled activeId change, or a filter reshuffle) the window follows to
 *     that row's page, and the "first-last/total" indicator follows with it.
 *   • PgUp/PgDn (and Home/End) still page, and after the jump the cursor is
 *     clamped into the new page — first row going forward, last row going back
 *     — so a page is never painted without a visible active row.
 *   • An empty list, a single row, exactly one page, or an activeId filtered
 *     out of the current query stay safe: no page is opened past the data.
 *     Still no scroll container, no render-structure change, no new deps.
 *   • IMPLEMENTED PanelTitle / PanelBody / PanelActions (src/slots.tsx, now
 *     exported). PanelBodyProps gains `maxRows`; `scroll` stays deferred to a
 *     later version — v1.1 paginates through List.pageSize instead.
 *   • No new motion constants, timers or dependencies.
 *
 * Adapted from @opencode/tui (MIT), Copyright 2025 opencode.
 */
import type { RGBA } from "@opentui/core"
import type { Accessor, JSX } from "solid-js"

// ---------------------------------------------------------------------------
// §3.1 Common types
// ---------------------------------------------------------------------------

export type PanelSize = "medium" | "large" | "xlarge" | "full"
export type PanelTone = "accent" | "warning" | "danger"
export type PanelButtonVariant = "primary" | "ghost" | "danger"
export type PanelBorderStyle = "single" | "heavy" | "double" | "rounded"

/** Width presets matching the existing dialog widths (spec §3.1). */
export const PANEL_WIDTHS: Readonly<Record<Exclude<PanelSize, "full">, number>> = Object.freeze({
  medium: 60,
  large: 88,
  xlarge: 116,
})

export interface PanelMetrics {
  /** Cells inside the frame. */
  readonly width: number
  /** Cells inside the frame. */
  readonly height: number
  /** width < 64 || height < 20 (spec §3.2). */
  readonly compact: boolean
}

// ---------------------------------------------------------------------------
// §4 / §6 Motion constants (spec-pinned; the driver itself is not here)
// ---------------------------------------------------------------------------

/** Foreground fade duration in ms (spec §4.2). */
export const FADE_MS = 160
/** Scrim alpha added per stack level (spec §6.2). */
export const SCRIM_STEP = 24
/** Scrim alpha ceiling (spec §6.2). */
export const SCRIM_MAX = 210

// ---------------------------------------------------------------------------
// §7 Theme tokens
// ---------------------------------------------------------------------------

export interface PanelBorderToken {
  readonly style: PanelBorderStyle
  readonly color: RGBA
}

/**
 * Flat projection of the host's resolved dialog surface (spec §7.1). The host
 * owns the mapping; the kit never reads a theme context.
 */
export interface PanelTheme {
  background: {
    /** ComponentTheme.background.base */
    readonly surface: RGBA
    /** background.raised.high (footer band, hovered row) */
    readonly raised: RGBA
    /** RGBA(0,0,0,150), or theme-specified */
    readonly scrim: RGBA
  }
  text: {
    readonly base: RGBA
    readonly muted: RGBA
    readonly faint: RGBA
    /** hue.interactive[500] */
    readonly accent: RGBA
    /** text.action.primary.disabled */
    readonly disabled: RGBA
    /** text.action.destructive.base */
    readonly danger: RGBA
    /** text.feedback.warning.base */
    readonly warning: RGBA
    /** text.feedback.success.base */
    readonly success: RGBA
  }
  /**
   * Row highlight. v1 action-token ratification (T17-INT1 B4): the theme has
   * no separate `action.*` group. Button `primary` projects action-primary
   * onto `activeBg`/`activeFg`; Button `danger` projects action.destructive
   * onto `text.danger`. Add a dedicated group in v1.1 only if a consumer
   * needs a non-focused primary surface distinct from the row highlight.
   */
  row: {
    /** background.action.primary.focused (also the v1 action-primary bg) */
    readonly activeBg: RGBA
    /** text.action.primary.focused (also the v1 action-primary fg) */
    readonly activeFg: RGBA
  }
  border: {
    readonly base: PanelBorderToken
    readonly focused: PanelBorderToken
    readonly warning: PanelBorderToken
  }
  /**
   * Glyph attribute bit masks per role. Values are `TextAttributes` members
   * from @opentui/core (`TextAttributes.BOLD` etc.); the kit never hardcodes
   * bold/underline on chrome (spec §7.2).
   */
  attributes: {
    readonly title: number
    readonly group: number
    readonly selected: number
    readonly keyHint: number
    readonly subtitle: number
  }
  /** Gradient title endpoints, painted statically (spec §4.6). */
  readonly identity: readonly [RGBA, RGBA]
}

// ---------------------------------------------------------------------------
// §2.2 Provider injection surface (decision D1)
// ---------------------------------------------------------------------------

/**
 * Motion gate supplied by the host. All three are live reads (called inside
 * reactive scopes), never snapshots: a tier or busy flip must be observed
 * without remounting the stack.
 */
export interface PanelMotionAdapter {
  /** Mirrors motionDecorationsEnabled(): true only for tier "full". */
  decorationsEnabled(): boolean
  /**
   * Mirrors motionFrameRate(): fps for the shared animation clock, or
   * undefined when the clock is paused (tier "off").
   */
  fps(): number | undefined
  /**
   * Jump-degradation signal: true when enter/exit/fade must land on the final
   * state immediately. Derived as `!decorationsEnabled() || fps() === undefined`
   * (spec §4.3).
   */
  jump(): boolean
}

/**
 * Command table registered with the host's modal key layer. Reserved ids:
 * "escape" (the single back action), "enter", "space", "up", "down", "left",
 * "right". A handler returns `false` to report the event unconsumed so the
 * layer's router can fall through (T17-INT1 C1). Only the top layer's commands
 * are enabled (spec §6.3).
 */
export type PanelKeyCommands = Record<string, () => void | boolean>

/**
 * One control-level key handler: `true` = consumed, `false` = fall through.
 * (T17-INT1 C1 key-routing protocol.)
 */
export type PanelKeyHandler = (id: string) => boolean

/**
 * Layer-local routing table. The Panel shell creates exactly ONE per layer and
 * provides it to its subtree; controls register handlers while they own focus
 * or while a transient popup is open.
 *
 * Dispatch order is innermost-first (most recently registered first); the
 * first handler returning `true` wins. When every handler declines, the panel
 * default runs (Esc -> beforeClose-guarded close). A control MUST NOT call
 * PanelKeyAdapter.scope itself inside a Panel: that would overwrite the
 * layer's single table (T17-INT1 C1/B3).
 */
export interface PanelKeyRouter {
  /** Returns an unregister disposer. */
  register(handler: PanelKeyHandler): () => void
}

export interface PanelKeyAdapter {
  /**
   * Register the modal key scope. The host wraps Keymap.mode.push("modal") +
   * Keymap.createLayer. Returns an optional disposer. Exactly one call per
   * layer: the Panel shell owns it (T17-INT1 A2/C1).
   */
  scope(commands: PanelKeyCommands): void | (() => void)
  /**
   * Focus-takeover hook: `true` when the stack takes focus (depth 0 -> 1),
   * `false` when it restores the previous renderable (depth -> 0).
   * Spec §6.4.
   */
  focusTakeover?(active: boolean): void
}

export interface PanelKitContextValue {
  readonly theme: Accessor<PanelTheme>
  readonly motion: PanelMotionAdapter
  readonly keys?: PanelKeyAdapter
}

export interface PanelKitProviderProps {
  theme: PanelTheme | Accessor<PanelTheme>
  motion: PanelMotionAdapter
  keys?: PanelKeyAdapter
  children?: JSX.Element
}

// ---------------------------------------------------------------------------
// §3.2 Panel shell
// ---------------------------------------------------------------------------

export interface PanelOptions {
  id?: string
  title: string
  subtitle?: string
  /** default "medium" */
  size?: PanelSize
  /** cells; overrides size */
  width?: number
  /**
   * cells; default content height. With no explicit height the frame grows to
   * its content up to `maxHeight` (no geometry is animated in v1).
   */
  height?: number
  /** default terminalRows - 4 */
  maxHeight?: number
  /** default "center"; "top" = vertical quarter (dialog parity) */
  align?: "center" | "top"
  /** default "accent"; warning/danger recolor frame + title */
  tone?: PanelTone
  /**
   * Overrides theme.border.base.style for this panel. Color always comes from
   * the theme token; the border color participates in the fade, but the style
   * switches instantly and is never animated.
   */
  border?: PanelBorderStyle
  /** default true */
  scrim?: boolean
  /** 0..255; default theme.background.scrim alpha; +24 per stack level, capped 210 */
  scrimAlpha?: number
  /**
   * default true. Enter fades the whole themed subtree from
   * theme.background.surface toward the resolved tokens over FADE_MS; false
   * skips the enter tint (exit still fades). The scrim is painted at its final
   * alpha immediately (spec §4.2).
   */
  fadeIn?: boolean
  /** Veto/guard (e.g. unsaved drafts). Runs before close, including Esc. */
  beforeClose?: () => boolean | Promise<boolean>
  onClose?: () => void
  /**
   * There is deliberately NO dismissOnScrimClick: Esc is the only back action
   * (user decision 2026-11-12). Scrims are painted, never hit-tested.
   */
}

export interface PanelProps extends PanelOptions {
  children?: JSX.Element
  /** Advanced: replaces the default title row. */
  header?: JSX.Element
  /**
   * Stack level: feeds the +24-per-level scrim formula (spec §6.2). A direct
   * standalone panel passes 0 (default). (T17-INT1 A1)
   */
  depth?: number
  /**
   * Esc ownership (default true). A stack sets false for every non-top layer
   * so only the top layer registers the modal table. (T17-INT1 A1/A2)
   */
  active?: boolean
  /**
   * Receives the imperative close handle once the shell is mounted; the stack
   * stores it behind PanelHandle. (T17-INT1 A1)
   */
  onReady?: (handle: PanelShellHandle) => void
}

/** Shell phase observed through {@link PanelShellHandle}. */
export type PanelShellPhase = "idle" | "entering" | "open" | "exiting" | "closed"

/**
 * Imperative close surface published to the stack through
 * PanelProps.onReady. The stack wraps it as contracts.PanelHandle (adds id and
 * depth). (T17-INT1 A1)
 */
export interface PanelShellHandle {
  /** Fades out (FADE_MS) then calls onClose. Idempotent. */
  close(): void
  /** Unmount immediately (teardown, second Esc during exit). */
  closeNow(): void
  readonly phase: Accessor<PanelShellPhase>
}

// ---------------------------------------------------------------------------
// §3.3 PanelStack and handle API
// ---------------------------------------------------------------------------

export interface PanelHandle {
  readonly id: string
  readonly depth: number
  /** Fades out (FADE_MS) then unmounts. Idempotent. */
  close(): void
  /** Unmounts immediately; teardown and second-Esc path. */
  closeNow(): void
}

export interface PanelStackApi {
  open(render: () => JSX.Element, options: PanelOptions): PanelHandle
  /** Top by default. */
  close(handle?: PanelHandle): void
  closeAll(): void
  confirm(options: ConfirmOptions): Promise<boolean>
  readonly depth: number
  readonly top: PanelHandle | undefined
}

export interface PanelStackProps {
  /** default 4 */
  maxDepth?: number
  children?: JSX.Element
}

/** One entry in the host's layer list; rendered once, keyed by id. */
export interface StackLayer {
  readonly id: string
  readonly depth: number
  readonly options: PanelOptions
  readonly render: () => JSX.Element
}

// ---------------------------------------------------------------------------
// §3.4 Panel slots
// ---------------------------------------------------------------------------

export interface PanelTitleProps {
  title: string
  subtitle?: string
  /** "esc" by default; false hides the hint. */
  closeHint?: string | false
  /** Static identity gradient; full tier only (spec §4.6). */
  gradient?: readonly [RGBA, RGBA]
  right?: JSX.Element
}

export interface PanelBodyProps {
  /**
   * Scroll when content exceeds the frame; default false. Deferred: v1.1
   * paginates through List.pageSize instead of shipping a scroll container.
   */
  scroll?: boolean
  /** Side padding in cells; default 3 (dialog inset). */
  inset?: number
  /** Row cap in terminal cells; omitted = grow with the frame. (v1.1) */
  maxRows?: number
  children?: JSX.Element
}

export interface PanelAction {
  id: string
  label: string
  keyHint?: string
  /** default "ghost" */
  variant?: PanelButtonVariant
  disabled?: boolean
  onPress: () => void
}

export interface PanelActionsProps {
  primary?: PanelAction[]
  secondary?: PanelAction[]
  /** Muted hint line; e.g. "enter save · esc close". */
  hint?: string
}

// ---------------------------------------------------------------------------
// §3.5 List
// ---------------------------------------------------------------------------

export interface ListColumn {
  id: string
  /** Header label (v1.1); omitted = blank header cell. */
  title?: string
  /** cells, fixed; no auto-sizing in v1 */
  width: number
  align?: "left" | "right"
}

export interface ListGroup {
  id: string
  label?: string
}

export interface ListItem<T = unknown> {
  id: string
  label: string
  description?: string
  /** Extra fixed columns; requires columns[] (v1.1, needed by /agents). */
  cells?: Record<string, string>
  value?: T
  group?: string
  /** Static marker, e.g. "●" current item / "✔" */
  badge?: string
  tone?: "default" | "muted" | "warning" | "danger"
  disabled?: boolean
}

export interface ListProps<T = unknown> {
  items: ListItem<T>[]
  groups?: ListGroup[]
  /** default "single" */
  mode?: "single" | "multi"
  /** Controlled ids; single = at most one. */
  selected?: string[]
  /** Focus row (uncontrolled default: first enabled). */
  activeId?: string
  /** v1.1; fixed columns for the row (see ListColumn). Omitted = label-only rows. */
  columns?: ListColumn[]
  /**
   * Paged window: paint at most this many render rows (group headers count)
   * and page with PgUp/PgDn/Home/End while focused. Omitted = no paging.
   * The active row always stays inside the painted window: cursor movement
   * across a page boundary scrolls the window to that row's page (v1.1).
   * (v1.1 — replaces the deferred scroll primitive.)
   */
  pageSize?: number
  /**
   * Controlled fuzzy query. Omit to use the List's internal typing buffer;
   * when supplied the List paints this value and reports keystrokes through
   * onQueryChange (T17-INT1 B2).
   */
  query?: string
  onQueryChange?: (query: string) => void
  /**
   * Row budget in cells for tail-preserving truncation (the host knows its body
   * width; the control never manages layout containers). Omit to let the host
   * clip. (T17-INT1 B2)
   */
  width?: number
  emptyLabel?: string
  onActiveChange?: (id: string) => void
  /** Enter / Space (single). */
  onSelect?: (item: ListItem<T>) => void
  /** Multi toggle (Space). */
  onChange?: (ids: string[]) => void
  renderFooter?: (item: ListItem<T>) => JSX.Element
}

// ---------------------------------------------------------------------------
// §3.6 Button
// ---------------------------------------------------------------------------

export interface ButtonProps {
  label: string
  /** default "ghost" */
  variant?: PanelButtonVariant
  keyHint?: string
  disabled?: boolean
  focused?: boolean
  onPress: () => void
}

// ---------------------------------------------------------------------------
// §3.7 Check
// ---------------------------------------------------------------------------

export interface CheckProps {
  checked: boolean
  label?: string
  /** When present the check is interactive; Space/Enter toggles. */
  onChange?: (checked: boolean) => void
  disabled?: boolean
  /** default "✔" */
  trueGlyph?: string
  /** default "✘" */
  falseGlyph?: string
  /** default "success" */
  trueTone?: "success" | "accent"
  /** default "faint" */
  falseTone?: "faint" | "danger"
  /**
   * Half-selected (mixed) state over `checked`, for tri-state flows such as a
   * group toggle. First toggle resolves mixed -> on. (T17-INT1 B1)
   */
  indeterminate?: boolean
  /** default "▌" (spec §5.2 glyph vocabulary). */
  indeterminateGlyph?: string
}

// ---------------------------------------------------------------------------
// §3.8 ConfirmDialog
// ---------------------------------------------------------------------------

export interface ConfirmOptions {
  title: string
  message: string | JSX.Element
  /** default "Confirm" */
  confirmLabel?: string
  /** default "Cancel" */
  cancelLabel?: string
  /**
   * default "warning"; drives the frame/title recolor. Confirm button variant
   * mapping (T17-INT1 C3): `destructive || tone === "danger"` -> danger,
   * otherwise primary. The tone itself never disables an action.
   */
  tone?: "accent" | "warning" | "danger"
  /** default false; focuses Cancel first */
  destructive?: boolean
}

export type ConfirmProps = ConfirmOptions & {
  onConfirm: () => void
  onCancel: () => void
}

/** Spec §3.8 name; identical to {@link ConfirmProps}. */
export type ConfirmDialogProps = ConfirmProps

// ---------------------------------------------------------------------------
// §3.9 Dropdown
// ---------------------------------------------------------------------------

export interface DropdownOption<T = unknown> {
  id: string
  label: string
  description?: string
  disabled?: boolean
  value: T
}

/**
 * Trigger row + in-panel popup. Space and Enter are interchangeable: both open
 * the popup when closed and select the cursor option when open. Esc closes
 * only the popup while open and reports the event unconsumed when the popup is
 * already closed, so the panel back action proceeds (T17-INT1 C5).
 */
export interface DropdownProps<T = unknown> {
  label?: string
  value?: T
  options: DropdownOption<T>[]
  /** default "—" */
  placeholder?: string
  disabled?: boolean
  onChange: (value: T, option: DropdownOption<T>) => void
}

// ---------------------------------------------------------------------------
// §3.10 InputRow
// ---------------------------------------------------------------------------

export interface InputRowProps {
  label: string
  /** default "text" */
  kind?: "text" | "number"
  value: string | number
  /** text: per keystroke */
  onChange?: (next: string) => void
  /** Enter / blur / stepper settle */
  onCommit?: (next: string | number) => void
  /**
   * default "enter". Commit triggers (T17-INT1 C4): Enter always commits a
   * valid value; "blur" additionally commits when the row loses focus;
   * "change" additionally commits per edit. A number stepper's settle commits
   * regardless of this mode; readOnly/disabled rows never commit.
   */
  commit?: "enter" | "blur" | "change"
  placeholder?: string
  min?: number
  max?: number
  /** number kind; default 1 */
  step?: number
  unit?: string
  /** Renders a static value row (T18 read-only items). */
  readOnly?: boolean
  password?: boolean
  disabled?: boolean
  /** Error text under the row. */
  validate?: (value: string | number) => string | undefined
}
