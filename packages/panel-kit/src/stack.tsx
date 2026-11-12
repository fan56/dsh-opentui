/**
 * stack.tsx — PanelStack: layer host, handle API, focus save/restore.
 *
 * Contract: contracts.ts §3.3 (StackLayer / PanelStackApi / PanelStackProps).
 * Semantics: spec §4.2 (one-shot exit, second-Esc fast close), §6.1-§6.4
 * (z-order, per-layer scrim, inner-first Esc, focus trap/restore).
 *
 * Each layer renders `<Panel depth={index} active={isTop} onReady={...} />`:
 *   - `depth` feeds the scrim formula and `zIndex = 3000 + depth`;
 *   - `active` makes only the top layer register the modal table, so Esc is
 *     inner-first (a popup/confirm handler consumes it before the panel close);
 *   - `onReady` publishes the shell handle used by PanelHandle.close/closeNow.
 *
 * No timers: focus restore is a microtask (spec §9.5 forbids setTimeout in this
 * package). T17-INT2.
 */
import { useRenderer } from "@opentui/solid"
import type { Renderable } from "@opentui/core"
import {
  For,
  batch,
  createContext,
  createSignal,
  useContext,
  type JSX,
} from "solid-js"
import type {
  ConfirmOptions,
  PanelHandle,
  PanelOptions,
  PanelShellHandle,
  PanelStackApi,
  PanelStackProps,
} from "./contracts"
import { ConfirmDialog } from "./controls/confirm"
import { Panel } from "./panel"

interface StackEntry {
  readonly id: string
  readonly options: PanelOptions
  readonly render: () => JSX.Element
  readonly focusBefore: Renderable | null
  handle?: PanelShellHandle
  pendingClose: boolean
}

const PanelStackContext = createContext<PanelStackApi | undefined>(undefined)

export function usePanels(): PanelStackApi {
  const api = useContext(PanelStackContext)
  if (!api) throw new Error("panel-kit: usePanels() requires <PanelStack>")
  return api
}

/** True when `node` is still mounted under the renderer root. */
function inTree(root: Renderable, node: Renderable): boolean {
  if (root === node) return true
  for (const child of root.getChildren()) {
    if (inTree(child, node)) return true
  }
  return false
}

export function PanelStack(props: PanelStackProps): JSX.Element {
  const renderer = useRenderer()
  const [layers, setLayers] = createSignal<StackEntry[]>([])
  const handles = new Map<string, PanelHandle>()
  let counter = 0
  let baseFocus: Renderable | null = null

  const maxDepth = () => props.maxDepth ?? 4

  const restore = (target: Renderable | null) => {
    queueMicrotask(() => {
      if (layers().length > 0) return
      if (!target || target.isDestroyed) return
      if (!inTree(renderer.root, target)) return
      target.focus()
    })
  }

  const restoreUnder = (closing: StackEntry) => {
    queueMicrotask(() => {
      if (layers().length === 0) return
      const target = closing.focusBefore
      if (!target || target.isDestroyed) return
      if (!inTree(renderer.root, target)) return
      target.focus()
    })
  }

  const removeEntry = (id: string) => {
    const closing = layers().find((entry) => entry.id === id)
    if (!closing) return
    const next = layers().filter((entry) => entry.id !== id)
    handles.delete(id)
    setLayers(next)
    if (next.length === 0) restore(baseFocus)
    else restoreUnder(closing)
  }

  const makeHandle = (entry: StackEntry): PanelHandle => ({
    id: entry.id,
    get depth() {
      return Math.max(0, layers().findIndex((item) => item.id === entry.id))
    },
    close() {
      if (entry.handle) entry.handle.close()
      else entry.pendingClose = true
    },
    closeNow() {
      if (entry.handle) entry.handle.closeNow()
      else {
        entry.options.onClose?.()
        removeEntry(entry.id)
      }
    },
  })

  const api: PanelStackApi = {
    open(render, options) {
      const id = options.id ?? `panel-${++counter}`
      if (layers().some((entry) => entry.id === id)) {
        throw new Error(`panel-kit: duplicate panel id "${id}"`)
      }
      if (layers().length >= maxDepth()) {
        if (typeof process === "undefined" || process.env.NODE_ENV !== "production") {
          throw new Error(`panel-kit: maxDepth ${maxDepth()} exceeded`)
        }
        // Production: silent no-op handle (spec §3.3).
        return {
          id,
          depth: 0,
          close: () => {},
          closeNow: () => {},
        }
      }

      const focused = renderer.currentFocusedRenderable
      if (layers().length === 0) baseFocus = focused
      focused?.blur()

      const entry: StackEntry = {
        id,
        options: { ...options, id },
        render,
        focusBefore: focused,
        pendingClose: false,
      }
      setLayers((current) => [...current, entry])
      const handle = makeHandle(entry)
      handles.set(id, handle)
      return handle
    },

    close(handle) {
      const target = handle ?? (layers().length > 0 ? handles.get(layers().at(-1)!.id) : undefined)
      target?.close()
    },

    closeAll() {
      const entries = layers()
      batch(() => {
        for (const entry of entries) {
          if (entry.handle) entry.handle.closeNow()
          else entry.options.onClose?.()
        }
        handles.clear()
        setLayers([])
      })
      restore(baseFocus)
    },

    confirm(options: ConfirmOptions) {
      return new Promise<boolean>((resolve) => {
        let settled = false
        let handle: PanelHandle | undefined
        const finish = (value: boolean) => {
          if (settled) return
          settled = true
          resolve(value)
          handle?.close()
        }
        handle = api.open(
          () => (
            <ConfirmDialog
              {...options}
              onConfirm={() => finish(true)}
              onCancel={() => finish(false)}
            />
          ),
          {
            title: options.title,
            tone: options.tone ?? "warning",
            size: "medium",
            height: 10,
            onClose: () => {
              if (settled) return
              settled = true
              resolve(false)
            },
          },
        )
      })
    },

    get depth() {
      return layers().length
    },

    get top() {
      if (layers().length === 0) return undefined
      return handles.get(layers().at(-1)!.id)
    },
  }

  return (
    <PanelStackContext.Provider value={api}>
      {props.children}
      <For each={layers()}>
        {(entry, index) => (
          <Panel
            {...entry.options}
            id={entry.id}
            depth={index()}
            active={index() === layers().length - 1}
            onClose={() => {
              entry.options.onClose?.()
              removeEntry(entry.id)
            }}
            onReady={(handle) => {
              entry.handle = handle
              if (entry.pendingClose) {
                entry.pendingClose = false
                handle.close()
              }
            }}
          >
            {entry.render()}
          </Panel>
        )}
      </For>
    </PanelStackContext.Provider>
  )
}
