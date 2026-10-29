/**
 * TodosWidget — the agent's live todo list as a dock panel. The host todo
 * tool appends a `todo/write` session event carrying the WHOLE list (last
 * write wins, no ids), and the host projection clears the list at every
 * turn/start — so this component is a pure function of the latest
 * snapshot: empty or all-completed renders zero rows (the panel vanishes
 * the moment the work is done, tui-pi style). Rows are re-derived every
 * render; sorting keeps in_progress on top, done newest-first at the
 * bottom, and the window shows the first 5 rows of that order — state
 * transitions themselves do the paging.
 */
import { For, type JSX } from "solid-js"
import type { Theme } from "./theme.ts"

export interface TodoItem {
  content: string
  status: "pending" | "in_progress" | "completed"
}

/** Rows kept visible at once; longer lists page by state transitions. */
const MAX_ROWS = 5

const STATUS_GLYPH: Record<TodoItem["status"], string> = {
  pending: "☐",
  in_progress: "▶",
  completed: "☑",
}

/** Sort: in_progress first, then pending, completed newest-first last. */
function sortTodos(todos: TodoItem[]): TodoItem[] {
  const rank = (t: TodoItem) => (t.status === "in_progress" ? 0 : t.status === "pending" ? 1 : 2)
  const completed = todos.filter((t) => t.status === "completed")
  return [...todos].sort((a, b) => rank(a) - rank(b) || (completed.indexOf(b) - completed.indexOf(a)))
}

export function TodosWidget(props: { todos: TodoItem[]; theme: Theme }): JSX.Element {
  const th = () => props.theme
  const visible = () => sortTodos(props.todos).slice(0, MAX_ROWS)
  const remaining = () => Math.max(0, props.todos.length - visible().length)
  const active = () => props.todos.some((t) => t.status === "in_progress" || t.status === "pending")

  return (
    <For each={visible()}>
      {(t, i) => (
        <text style={{ fg: t.status === "completed" ? th().tokens.dim : t.status === "in_progress" ? th().tokens.accent : th().tokens.text }}>
          {`${i() === 0 && active() ? "📋 " : "   "}${STATUS_GLYPH[t.status]} ${t.content}${i() === visible().length - 1 && remaining() > 0 ? ` (+${remaining()})` : ""}`}
        </text>
      )}
    </For>
  )
}
