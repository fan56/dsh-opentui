/**
 * The declarative surface protocol — layer 2 of the integration model.
 *
 * Plugins that do not want a Solid build step describe their UI as data
 * (surfaces: widgets, panels, status-bar items) and register it through the
 * `opentui.surface` cordis service. The Runtime renders these declarations
 * with Kit components. This module is types only: consumers depend on it as
 * a devDependency with zero runtime cost.
 */

/** Where a declared surface attaches in the shell layout. */
export type SurfaceSlot =
  /** A row in the status bar at the bottom of the shell. */
  | "status"
  /** A docked panel toggled by the user (e.g. via a command or keybind). */
  | "panel"
  /** A transient overlay taking focus, dismissed with escape by default. */
  | "overlay"

/** One-line text with optional emphasis; safe to compose into any slot. */
export interface SurfaceTextPart {
  text: string
  color?: string
  bold?: boolean
  dim?: boolean
}

export interface SurfaceWidgetDecl {
  kind: "widget"
  slot: Extract<SurfaceSlot, "status">
  /** Stable id; replaces any previous declaration with the same id. */
  id: string
  /** Ordering hint within the slot; lower sorts first. */
  order?: number
  parts: SurfaceTextPart[]
  /** Tooltip / long form shown when the widget is focused. */
  detail?: SurfaceLine[]
}

export interface SurfacePanelDecl {
  kind: "panel"
  slot: Extract<SurfaceSlot, "panel">
  id: string
  title: string
  /** Initial open state; the shell owns the current state afterwards. */
  open?: boolean
  body: SurfaceLine[]
  /** Keybind the shell should bind to toggle this panel, e.g. "ctrl+p". */
  toggleKey?: string
  /** Called when the user scrolls the panel body. */
  onScroll?: (offset: number) => void
}

export interface SurfaceOverlayDecl {
  kind: "overlay"
  slot: Extract<SurfaceSlot, "overlay">
  id: string
  title: string
  body: SurfaceLine[]
  /** Dismiss callback; the runtime closes the overlay before calling. */
  onClose?: () => void
}

export type SurfaceDecl = SurfaceWidgetDecl | SurfacePanelDecl | SurfaceOverlayDecl

/** A line of rendered content inside a panel or overlay body. */
export interface SurfaceLine {
  parts: SurfaceTextPart[]
  /** Indent level in columns. */
  indent?: number
}

/** Events a declarative surface can receive from the runtime. */
export type SurfaceEvent =
  | { type: "open"; id: string }
  | { type: "close"; id: string }
  | { type: "key"; id: string; key: string }

/** The handle injected into plugins that consume the surface service. */
export interface SurfaceService {
  /** Replace (upsert) a declaration. Call again to update content. */
  declare(decl: SurfaceDecl): void
  /** Remove a declaration by id. */
  retract(id: string): void
  /**
   * Subscribe to events for declarations owned by this plugin.
   * Returns an unsubscribe function.
   */
  onEvent(cb: (event: SurfaceEvent) => void): () => void
}

declare module "@deepseek-ai/cordis" {
  interface Context {
    surface: SurfaceService
  }
}
