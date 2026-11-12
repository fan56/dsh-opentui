/**
 * list.tsx — List selector (spec §3.5): single/multi selection, ListGroup
 * flattening, fuzzy filtering, static active-row highlight (no background
 * animation — spec §4.4 red line), width truncation keeping the tail, and an
 * empty state.
 *
 * Selection/active/filter logic is pure (`listReduce` + helpers) so the unit
 * suite in test/controls-a.test.tsx runs without a renderer (spec §9.1).
 * Rendering reads every color/attribute from the injected PanelTheme — the kit
 * never hardcodes colors or glyph attributes (spec §7.2).
 *
 * Theme plumbing: the single injection point is `src/theme.ts` (T17-INT1 B3).
 * Controls read the live theme through `useControlTheme`, a thin alias of
 * `usePanelTheme` kept for the sibling controls' import path; there is no
 * second context identity and no Symbol.for registry.
 *
 * Adapted from @opencode/tui, Copyright 2025 opencode, MIT
 * (form: ui/dialog-select.tsx fuzzy filter / grouping / row markers)
 */
import type { KeyEvent } from "@opentui/core"
import stringWidth from "string-width"
import {
  createMemo,
  createSignal,
  For,
  Show,
  type Accessor,
  type JSX,
} from "solid-js"
import type {
  ListGroup,
  ListItem,
  ListProps,
  PanelTheme,
} from "../contracts"
import { usePanelTheme } from "../theme"

// ---------------------------------------------------------------------------
// Theme injection (single canonical host: src/theme.ts)
// ---------------------------------------------------------------------------

/**
 * Live PanelTheme accessor for controls (spec §7.4: a theme switch recolors
 * without remount). Alias of `usePanelTheme` so control modules share one
 * import path; no provider degrades to the fallback palette (spec §7.2).
 */
export function useControlTheme(): Accessor<PanelTheme> {
  return usePanelTheme()
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" })

function graphemes(text: string): string[] {
  return Array.from(graphemeSegmenter.segment(text), (part) => part.segment)
}

/**
 * Truncate `text` to at most `width` display cells, measured with string-width
 * so CJK/emoji count as two cells (spec §5.2). `keep: "tail"` (default) drops
 * the head and keeps the tail (`…` at the front, dialog-select truncateTitle
 * "left" semantics); `keep: "head"` drops the tail (`…` at the end).
 */
export function truncateCells(text: string, width: number, keep: "tail" | "head" = "tail"): string {
  if (width <= 0) return ""
  if (stringWidth(text) <= width) return text
  if (width === 1) return "…"

  const budget = width - 1 // one cell for "…"
  const parts = graphemes(text)
  const picked: string[] = []
  let used = 0
  if (keep === "tail") {
    for (let i = parts.length - 1; i >= 0; i--) {
      const part = parts[i]!
      const next = stringWidth(part)
      if (used + next > budget) break
      picked.unshift(part)
      used += next
    }
    return "…" + picked.join("")
  }
  for (const part of parts) {
    const next = stringWidth(part)
    if (used + next > budget) break
    picked.push(part)
    used += next
  }
  return picked.join("") + "…"
}

/**
 * Score one query term against a text field. Returns null when `term` is not a
 * subsequence of `text`. Higher is better: consecutive runs, word starts, and
 * early matches win (fuzzysort-shaped, dialog-select.tsx:212-233 form).
 */
function termScore(term: string, text: string): number | null {
  const haystack = text.toLowerCase()
  let cursor = 0
  let score = 0
  let streak = 0
  for (const char of term) {
    const at = haystack.indexOf(char, cursor)
    if (at < 0) return null
    if (at === cursor && cursor > 0) {
      streak += 1
      score += 5 + streak
    } else {
      streak = 0
    }
    if (at === 0 || /[\s\-_./]/.test(haystack[at - 1]!)) score += 10
    score += Math.max(0, 8 - at)
    cursor = at + 1
  }
  // Shorter fields rank higher on ties.
  return score - haystack.length * 0.1
}

/**
 * Fuzzy filter used by the List filter line. Multi-word queries AND their
 * terms (each term may hit label or description); label hits weigh double
 * (dialog-select.tsx:216-233 weighting). Empty/blank query returns every item;
 * no hit returns [].
 */
export function fuzzyFilter<T>(items: readonly ListItem<T>[], query: string): ListItem<T>[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (terms.length === 0) return [...items]

  const scored: { item: ListItem<T>; score: number }[] = []
  for (const item of items) {
    let total = 0
    let matched = true
    for (const term of terms) {
      const label = termScore(term, item.label)
      const description = item.description === undefined ? null : termScore(term, item.description)
      // Label hits weigh double (dialog-select.tsx:216-233 weighting).
      const labelWeighted = label === null ? null : label * 2
      const score =
        labelWeighted === null
          ? description
          : description === null
            ? labelWeighted
            : Math.max(labelWeighted, description)
      if (score === null) {
        matched = false
        break
      }
      total += score
    }
    if (matched) scored.push({ item, score: total })
  }
  scored.sort((a, b) => b.score - a.score)
  return scored.map((entry) => entry.item)
}

/** One rendered row: a non-selectable group header or a selectable item. */
export type ListRow<T> =
  | { readonly kind: "group"; readonly group: ListGroup }
  | { readonly kind: "item"; readonly item: ListItem<T> }

/**
 * Flatten items into render rows. Items bucket by `item.group` ("" = ungrouped
 * renders first without a header). `groups` pins bucket order and labels for
 * known ids; unknown group ids keep first-appearance order and use the id as
 * label (dialog-select grouped() form). Group rows are not focusable.
 */
export function buildListRows<T>(
  items: readonly ListItem<T>[],
  groups?: readonly ListGroup[],
): ListRow<T>[] {
  const order: string[] = [""]
  const labels = new Map<string, string>()
  labels.set("", "")
  for (const group of groups ?? []) {
    if (!labels.has(group.id)) order.push(group.id)
    labels.set(group.id, group.label ?? group.id)
  }
  const buckets = new Map<string, ListItem<T>[]>([["", []]])
  for (const item of items) {
    const key = item.group ?? ""
    if (!buckets.has(key)) {
      buckets.set(key, [])
      if (!labels.has(key)) {
        order.push(key)
        labels.set(key, key)
      }
    }
    buckets.get(key)!.push(item)
  }

  const rows: ListRow<T>[] = []
  for (const key of order) {
    const bucket = buckets.get(key)
    if (!bucket || bucket.length === 0) continue
    if (key !== "") rows.push({ kind: "group", group: { id: key, label: labels.get(key) } })
    for (const item of bucket) rows.push({ kind: "item", item })
  }
  return rows
}

/** Ids of selectable rows (item rows that are not disabled). */
function enabledIds<T>(rows: readonly ListRow<T>[]): string[] {
  const ids: string[] = []
  for (const row of rows) {
    if (row.kind === "item" && !row.item.disabled) ids.push(row.item.id)
  }
  return ids
}

/**
 * Move the active row by `delta` over enabled item rows (group rows and
 * disabled items are skipped), wrapping at both ends. `currentId` may point at
 * a now-hidden row; movement then starts from the nearest edge.
 */
export function moveActiveId<T>(
  rows: readonly ListRow<T>[],
  currentId: string | undefined,
  delta: number,
): string | undefined {
  const ids = enabledIds(rows)
  if (ids.length === 0) return undefined
  const at = currentId === undefined ? -1 : ids.indexOf(currentId)
  const base = at < 0 ? (delta >= 0 ? -1 : 0) : at
  const next = ((base + delta) % ids.length + ids.length) % ids.length
  return ids[next]
}

/** First enabled item id (uncontrolled active default). */
export function firstEnabledId<T>(rows: readonly ListRow<T>[]): string | undefined {
  return enabledIds(rows)[0]
}

// ---------------------------------------------------------------------------
// Pure selection state machine
// ---------------------------------------------------------------------------

export interface ListState {
  readonly activeId: string | undefined
  readonly selected: readonly string[]
  readonly query: string
}

export type ListAction =
  | { readonly type: "move"; readonly delta: number }
  | { readonly type: "focus"; readonly id: string }
  | { readonly type: "activate" }
  | { readonly type: "toggle" }
  | { readonly type: "query"; readonly query: string }

export interface ListOutcome<T> {
  readonly state: ListState
  /** Enter/Space on a single-mode row. */
  readonly select?: ListItem<T>
  /** Multi-mode toggle result (already add/removed). */
  readonly change?: string[]
  /** Active row moved (controlled hook for onActiveChange). */
  readonly active?: string
}

export interface ListReduceInput<T> {
  readonly items: readonly ListItem<T>[]
  readonly groups?: readonly ListGroup[]
  readonly mode: "single" | "multi"
}

/**
 * Selection state machine for the List (spec §3.5):
 * - single: Enter/Space selects and emits `select` (selected = at most one);
 * - multi: Space/Enter toggles the active row and emits `change` immediately —
 *   Enter never batches or defers;
 * - group rows and disabled items are never active and never emit.
 */
export function listReduce<T>(
  input: ListReduceInput<T>,
  state: ListState,
  action: ListAction,
): ListOutcome<T> {
  const visible = () => fuzzyFilter(input.items, state.query)
  const rows = () => buildListRows(visible(), input.groups)

  if (action.type === "query") {
    const nextQuery = action.query
    const nextRows = buildListRows(fuzzyFilter(input.items, nextQuery), input.groups)
    const ids = enabledIds(nextRows)
    const activeId = state.activeId !== undefined && ids.includes(state.activeId)
      ? state.activeId
      : ids[0]
    const outcome: ListOutcome<T> = {
      state: { activeId, selected: state.selected, query: nextQuery },
    }
    return activeId !== state.activeId && activeId !== undefined
      ? { ...outcome, active: activeId }
      : outcome
  }

  if (action.type === "move") {
    const activeId = moveActiveId(rows(), state.activeId, action.delta)
    const outcome: ListOutcome<T> = { state: { ...state, activeId } }
    return activeId !== undefined && activeId !== state.activeId
      ? { ...outcome, active: activeId }
      : outcome
  }

  if (action.type === "focus") {
    const target = rows().find(
      (row) => row.kind === "item" && row.item.id === action.id && !row.item.disabled,
    )
    if (!target) return { state }
    return { state: { ...state, activeId: action.id }, active: action.id }
  }

  // activate (Enter) / toggle (Space): both keys behave identically per mode.
  const active = rows().find(
    (row) => row.kind === "item" && row.item.id === state.activeId && !row.item.disabled,
  )
  if (!active || active.kind !== "item") return { state }
  const item = active.item

  if (input.mode === "single") {
    return {
      state: { ...state, selected: [item.id] },
      select: item,
    }
  }
  const selected = state.selected.includes(item.id)
    ? state.selected.filter((id) => id !== item.id)
    : [...state.selected, item.id]
  return {
    state: { ...state, selected },
    change: selected,
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/** ListProps (contract) already carries width/query/onQueryChange (T17-INT1 B2). */
export type ListControlProps<T> = ListProps<T>

function toneColor(theme: PanelTheme, tone: ListItem["tone"], active: boolean) {
  if (active) return theme.row.activeFg
  switch (tone) {
    case "muted":
      return theme.text.muted
    case "warning":
      return theme.text.warning
    case "danger":
      return theme.text.danger
    default:
      return theme.text.base
  }
}

export function List<T>(props: ListControlProps<T>): JSX.Element {
  const theme = useControlTheme()
  const [state, setState] = createSignal<ListState>({
    activeId: props.activeId,
    selected: props.selected ?? [],
    query: "",
  })

  const mode = () => props.mode ?? "single"
  /** Controlled query wins; otherwise the internal typing buffer (T17-INT1 B2). */
  const query = () => props.query ?? state().query
  const rows = createMemo(() =>
    buildListRows(fuzzyFilter(props.items, query()), props.groups),
  )
  const activeId = () => props.activeId ?? state().activeId
  const selectedIds = () => props.selected ?? state().selected

  function dispatch(action: ListAction) {
    const outcome = listReduce(
      { items: props.items, groups: props.groups, mode: mode() },
      { activeId: activeId(), selected: selectedIds(), query: query() },
      action,
    )
    setState(outcome.state)
    if (action.type === "query") props.onQueryChange?.(action.query)
    if (outcome.active !== undefined) props.onActiveChange?.(outcome.active)
    if (outcome.select !== undefined) props.onSelect?.(outcome.select)
    if (outcome.change !== undefined) props.onChange?.(outcome.change)
  }

  function onKeyDown(key: KeyEvent) {
    switch (key.name) {
      case "up":
        dispatch({ type: "move", delta: -1 })
        break
      case "down":
        dispatch({ type: "move", delta: 1 })
        break
      case "return":
      case "enter":
        dispatch({ type: "activate" })
        break
      case "space":
        dispatch({ type: "toggle" })
        break
      case "backspace":
        dispatch({ type: "query", query: query().slice(0, -1) })
        break
      case "escape":
        if (query().length === 0) return
        dispatch({ type: "query", query: "" })
        break
      default:
        if (key.ctrl || key.meta) return
        if (key.sequence.length !== 1 || key.name === "space") return
        dispatch({ type: "query", query: query() + key.sequence })
        break
    }
    key.preventDefault()
    key.stopPropagation()
  }

  const itemRows = createMemo(() => rows().filter((row) => row.kind === "item"))
  const rowWidth = () => props.width

  return (
    <box flexDirection="column" focusable onKeyDown={onKeyDown}>
      <Show when={query().length > 0}>
        <text fg={theme().text.muted}>/{query()}</text>
      </Show>
      <Show
        when={itemRows().length > 0}
        fallback={<text fg={theme().text.muted}>{props.emptyLabel ?? "No items"}</text>}
      >
        <For each={rows()}>
          {(row) =>
            row.kind === "group" ? (
              <text attributes={theme().attributes.group} fg={theme().text.muted}>
                {row.group.label ?? row.group.id}
              </text>
            ) : (
              <ListRowView
                item={row.item}
                theme={theme()}
                active={row.item.id === activeId()}
                selected={selectedIds().includes(row.item.id)}
                marker={mode() === "multi"}
                width={rowWidth()}
                footer={props.renderFooter}
              />
            )
          }
        </For>
      </Show>
    </box>
  )
}

function ListRowView<T>(props: {
  item: ListItem<T>
  theme: PanelTheme
  active: boolean
  selected: boolean
  marker: boolean
  width?: number
  footer?: (item: ListItem<T>) => JSX.Element
}): JSX.Element {
  const { item, theme } = props
  const disabled = item.disabled === true
  const active = props.active && !disabled
  const fg = disabled ? theme.text.disabled : toneColor(theme, item.tone, active)

  // Label truncation keeps the tail (spec: 宽度截断保尾); the label is the
  // flexible segment, badge/description/footer survive.
  const prefixCells =
    (props.marker ? 2 : 0) + (item.badge !== undefined ? stringWidth(item.badge) + 1 : 0)
  const suffixCells = item.description === undefined ? 0 : stringWidth(item.description) + 1
  const labelBudget =
    props.width === undefined ? undefined : props.width - prefixCells - suffixCells
  const label =
    labelBudget === undefined ? item.label : truncateCells(item.label, labelBudget, "tail")

  return (
    <box
      flexDirection="row"
      backgroundColor={active ? theme.row.activeBg : undefined}
    >
      <Show when={props.marker}>
        <text fg={active ? theme.row.activeFg : theme.text.success}>
          {props.selected ? "✔ " : "  "}
        </text>
      </Show>
      <Show when={item.badge !== undefined}>
        <text fg={active ? theme.row.activeFg : theme.text.accent}>{item.badge} </text>
      </Show>
      <text fg={fg}>{label}</text>
      <Show when={item.description !== undefined}>
        <text fg={disabled ? theme.text.disabled : active ? theme.row.activeFg : theme.text.muted}>
          {" " + item.description}
        </text>
      </Show>
      <box flexGrow={1} />
      <Show when={props.footer !== undefined}>{props.footer!(item)}</Show>
    </box>
  )
}
