/**
 * Input ownership (ADR-0008): one ordered stack that says which surface owns
 * the keyboard right now.
 *
 * Keymap layers already have a mode (`opencode.mode`) and a priority, neither
 * of which can express a nested stack: `mode:"global"` matches in EVERY mode
 * (`keymap.tsx`, the `mode === "global"` exemption), and `priority` is a
 * per-layer constant fixed at registration, so two overlays that sit at the
 * same priority tie and the later registration wins regardless of which
 * surface is visually on top. This context adds the missing datum:
 *
 *   - frames are pushed as surfaces open, innermost last;
 *   - `top()` is never undefined; the page frame is the bottom frame;
 *   - `owns(frame)` is the only ownership predicate a layer may use.
 *
 * Every key layer keeps its own reason to be enabled (a dialog stack is
 * non-empty, a panel table is active) and adds the ownership conjunction:
 *
 *   - page-level `mode:"global"` layers gate on `owns(pageFrame())`;
 *   - overlay layers gate on `owns(myFrame)`.
 *
 * Placement: a sibling of `keymap.tsx`, not inside it. `keymap.tsx` is the
 * generic OpenTUI keymap adapter and is imported by `ui/dialog.tsx`; ownership
 * is an app-routing concern that the dialog and panel-kit hosts add on top.
 * A separate file keeps the dependency direction one-way (hosts -> ownership;
 * keymap knows nothing about it) and avoids a context cycle.
 */
import { createContext, createSignal, useContext, type Accessor, type JSX, type ParentProps } from "solid-js"

/** The page is the implicit bottom frame; overlays are pushed above it. */
export type OwnerKind = "page" | "dialog" | "panel" | "dock"

/** Frame kinds a surface may push; the page frame is provider-owned. */
export type OverlayKind = Exclude<OwnerKind, "page">

/**
 * One ownership claim. Identity is the `id` token, not the kind or the object
 * identity: hosts may hand back a store proxy of the frame, and two dialogs
 * stacked on each other, or a confirm panel pushed over /settings, are
 * distinct frames. `kind` is only the readable label.
 */
export interface OwnerFrame {
  readonly id: symbol
  readonly kind: OwnerKind
}

export interface InputOwnership {
  /** Never undefined; the page frame is the bottom frame. */
  readonly top: Accessor<OwnerFrame>
  /** The bottom frame, created once by the provider. */
  pageFrame(): OwnerFrame
  /** Push an overlay claim; returns the token its layer must compare. */
  push(kind: OverlayKind): OwnerFrame
  /**
   * Remove a claim. Idempotent: both hosts unmount asynchronously, so a pop
   * may arrive after the frame is already gone. The page frame is never
   * removed.
   */
  pop(frame: OwnerFrame | undefined): void
  /** Top-frame identity check — the ONLY ownership predicate. */
  owns(frame: OwnerFrame | undefined): boolean
}

const Context = createContext<InputOwnership | undefined>(undefined)

export function InputOwnershipProvider(props: ParentProps): JSX.Element {
  const page: OwnerFrame = { id: Symbol("page"), kind: "page" }
  const [stack, setStack] = createSignal<readonly OwnerFrame[]>([page])
  const top = () => stack().at(-1) ?? page
  const value: InputOwnership = {
    top,
    pageFrame: () => page,
    push(kind) {
      const frame: OwnerFrame = { id: Symbol(kind), kind }
      setStack((items) => [...items, frame])
      return frame
    },
    pop(frame) {
      if (!frame || frame === page) return
      // Compare by `id`, not object identity: hosts that keep their frame in a
      // Solid store (`dialog.tsx`) read back a store proxy, so the handle they
      // pass here is never `===` the pushed object. `id` is the frame token's
      // stable identity (two frames of the same kind have distinct ids).
      setStack((items) =>
        items.some((item) => item.id === frame.id) ? items.filter((item) => item.id !== frame.id) : items,
      )
    },
    owns(frame) {
      return frame !== undefined && top().id === frame.id
    },
  }
  return <Context.Provider value={value}>{props.children}</Context.Provider>
}

/** The provider is required in the app tree; hosts call this. */
export function useInputOwnership(): InputOwnership {
  const value = useContext(Context)
  if (!value) throw new Error("InputOwnership.Provider is missing")
  return value
}

/**
 * For components a harness may mount without the provider: ownership is then
 * untracked, and every gate below falls back to its pre-ownership behavior.
 */
export function useInputOwnershipOptional(): InputOwnership | undefined {
  return useContext(Context)
}

/**
 * Page-level layer gate: true while nothing above the page owns the keyboard
 * (and when no ownership provider is mounted at all, e.g. a bare FT
 * harness). Use inside the layer's `enabled:` callback so the signal read is
 * tracked by the keymap layer registration.
 */
export function useIsPageOwner(): () => boolean {
  const ownership = useInputOwnershipOptional()
  return () => ownership === undefined || ownership.owns(ownership.pageFrame())
}
