/**
 * FocusRouter — the four-tier capture stack (ADR-R4 / v3 §3.4).
 *
 * ADR-0008 already owns one input-ownership stack (`page`/`dialog`/`panel`/
 * `dock` frames, `top()` + `owns(frame)`). FocusRouter is a *tiered view* of
 * that same stack: it maps a frame kind to a capture tier and gives every
 * keymap layer one structural gate, `allows(tier, frame?)`.
 *
 *   modal (3) > overlay (2) > main (1) > global (0)
 *
 *   dialog frame  -> modal      (confirm / stop-confirm owns Esc/Enter/Ctrl+C)
 *   panel / dock  -> overlay    (panel pager / ask dock owns PgUp/PgDn / nav)
 *   page frame    -> main + global (page-level layers; existing keymap
 *                                   `priority` still decides between them)
 *
 * The invariant is structural: except for `main` and `global` coexisting on
 * the page frame, exactly one tier is allowed at any time. A page-layer that
 * declares `capture: "main"` therefore cannot fire under an overlay even if
 * its author forgot to write a `pageOwns()` shim — that is the modality leak
 * this module removes. There is no second ownership state: frames are pushed
 * and popped by the ADR-0008 hosts (dialog / panel-kit / dock) as before.
 *
 * Placement: a sibling of `input-ownership.tsx`, mounted by replacing
 * `InputOwnershipProvider` with `FocusRouterProvider` in the app tree. The
 * provider nests the ownership provider so every host reads the same stack.
 */
import { createContext, useContext, type Accessor, type JSX, type ParentProps } from "solid-js"
import {
  InputOwnershipProvider,
  useInputOwnership,
  useInputOwnershipOptional,
  type InputOwnership,
  type OwnerFrame,
} from "./input-ownership"

/** Capture tiers, highest first. */
export type CaptureTier = "modal" | "overlay" | "main" | "global"

export const CAPTURE_TIERS = ["modal", "overlay", "main", "global"] as const

/** Rank is used only for the documented precedence matrix, never for layer priority. */
export const CAPTURE_RANK: Readonly<Record<CaptureTier, number>> = {
  modal: 3,
  overlay: 2,
  main: 1,
  global: 0,
}

/** The single frame-kind -> tier mapping (ADR-R4 linkage clause 1). */
export function tierOfFrame(frame: OwnerFrame | undefined): CaptureTier | undefined {
  if (!frame) return undefined
  switch (frame.kind) {
    case "dialog":
      return "modal"
    case "panel":
    case "dock":
      return "overlay"
    case "page":
      return "main"
  }
}

/**
 * Pure capture decision — the only ownership predicate a tiered layer uses.
 *
 * `top` is the current ownership stack top. `frame`, when supplied by an
 * overlay/modal surface, is the claim token that surface pushed; the decision
 * then also requires exact token identity (two stacked dialogs are distinct).
 *
 * `main` and `global` are both page tiers: they are allowed iff the page frame
 * is on top. Their relative order is the existing keymap `priority`, which this
 * change deliberately does not touch (linkage clause 3).
 */
export function resolveCapture(
  top: OwnerFrame | undefined,
  tier: CaptureTier,
  frame?: OwnerFrame | undefined,
): boolean {
  if (!top) return false
  if (tier === "main" || tier === "global") return top.kind === "page"
  const tierMatches = tierOfFrame(top) === tier
  if (!tierMatches) return false
  return frame === undefined || top.id === frame.id
}

export interface FocusRouter {
  /** The ADR-0008 stack top (never undefined while the provider is mounted). */
  readonly top: Accessor<OwnerFrame | undefined>
  /** The tier of the current top frame. */
  readonly topTier: Accessor<CaptureTier | undefined>
  /** The one gate tiered layers consult inside their `enabled:` callback. */
  allows(tier: CaptureTier, frame?: OwnerFrame | undefined): boolean
  /** The underlying ADR-0008 ownership (hosts keep using push/pop/owns). */
  readonly ownership: InputOwnership
}

/** Pure factory — unit-testable without a JSX tree. */
export function createFocusRouter(ownership: InputOwnership): FocusRouter {
  const top = ownership.top
  return {
    top,
    topTier: () => tierOfFrame(top()),
    allows(tier, frame) {
      return resolveCapture(top(), tier, frame)
    },
    ownership,
  }
}

const Context = createContext<FocusRouter | undefined>(undefined)

/** Required inside the app tree; throws to catch a missing provider early. */
export function useFocusRouter(): FocusRouter {
  const router = useContext(Context)
  if (!router) throw new Error("FocusRouter.Provider is missing")
  return router
}

/** For layers/harnesses that may mount without the router: no tier gating. */
export function useFocusRouterOptional(): FocusRouter | undefined {
  return useContext(Context)
}

/**
 * Page-ownership predicate, now sourced from the router. Kept as an alias of
 * the ADR-0008 `useIsPageOwner` name so existing call sites (`pageOwns`) route
 * through the single authority without editing their assertions. Falls back
 * to the legacy ownership predicate when no router is mounted (bare FT
 * harnesses, the unchanged `app.tsx` tree).
 */
export function useIsPageOwner(): () => boolean {
  const router = useFocusRouterOptional()
  if (router) return () => router.allows("main")
  const ownership = useInputOwnershipOptional()
  return () => ownership === undefined || ownership.owns(ownership.pageFrame())
}

/**
 * Gate for overlay surfaces (panel pager / ask dock): true while the supplied
 * claim frame is the top frame. Falls back to the legacy `owns` predicate.
 */
export function useOwnsFrame(frame: () => OwnerFrame | undefined): () => boolean {
  const router = useFocusRouterOptional()
  if (router) return () => router.allows("overlay", frame())
  const ownership = useInputOwnershipOptional()
  return () => ownership === undefined || ownership.owns(frame())
}

function Scope(props: ParentProps): JSX.Element {
  const router = createFocusRouter(useInputOwnership())
  return <Context.Provider value={router}>{props.children}</Context.Provider>
}

/**
 * Drop-in replacement for `InputOwnershipProvider`: nests the ownership stack
 * and exposes the FocusRouter view above it.
 */
export function FocusRouterProvider(props: ParentProps): JSX.Element {
  return (
    <InputOwnershipProvider>
      <Scope>{props.children}</Scope>
    </InputOwnershipProvider>
  )
}
