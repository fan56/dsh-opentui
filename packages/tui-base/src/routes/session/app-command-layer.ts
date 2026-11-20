/**
 * App-level keymap layers for the v2 entry (0234).
 *
 * The shipped config defines leader/chord bindings (session.new, session.list,
 * session.timeline, session.queued_prompts, model.list, session.export and
 * command.palette.show) but the v2 client bundle never mounted a layer that
 * registers those command IDs. The keys therefore had no binding to match:
 * `ctrl+x` never entered a pending sequence and the following letter (and
 * `ctrl+p`) fell through as literal text into the composer.
 *
 * The original run bodies live in app.tsx / routes/session/index.tsx, which
 * the bundle does NOT include, and depend on app-only contexts (route, data,
 * local, sessionTabs) the v2 tree does not mount. These layers reuse the
 * v2-native faces instead — the same slash dispatch the shipped ctrl+g key
 * uses, plus the page-owned palette / history openers. Run bodies are injected
 * as deps so key routing can be unit-tested without the whole view graph.
 */
import type { KeymapLayer } from "../../context/keymap"

export interface AppCommandLayerDeps {
  /** Dispatch a typed slash command through the v2 slash host. */
  readonly slash: (name: string) => void
  /** Open the command palette dialog (page-owned dialog stack). */
  readonly openPalette: () => void
  /** Open the session timeline / turn-browser panel. */
  readonly openTimeline: () => void
  /** Ownership gate for the KEY BINDINGS: keep them off while a dialog/panel owns the keyboard. */
  readonly enabled?: () => boolean
}

const COMMANDS = [
  {
    id: "command.palette.show",
    title: "Show command palette",
    group: "System",
    palette: true as const,
    run: (deps: AppCommandLayerDeps) => () => deps.openPalette(),
  },
  {
    id: "session.new",
    title: "New session",
    group: "Session",
    palette: true as const,
    suggested: true as const,
    run: (deps: AppCommandLayerDeps) => () => deps.slash("/new"),
  },
  {
    id: "session.list",
    title: "List sessions",
    group: "Session",
    palette: true as const,
    suggested: true as const,
    run: (deps: AppCommandLayerDeps) => () => deps.slash("/resume"),
  },
  {
    id: "session.timeline",
    title: "Session timeline",
    group: "Session",
    palette: true as const,
    run: (deps: AppCommandLayerDeps) => () => deps.openTimeline(),
  },
  {
    id: "session.queued_prompts",
    title: "Queued prompts",
    group: "Prompt",
    palette: true as const,
    run: (deps: AppCommandLayerDeps) => () => deps.slash("/flush"),
  },
  {
    id: "model.list",
    title: "Switch model",
    group: "Agent",
    palette: true as const,
    suggested: true as const,
    run: (deps: AppCommandLayerDeps) => () => deps.slash("/model"),
  },
  {
    id: "session.export",
    title: "Export session",
    group: "Session",
    palette: true as const,
    run: (deps: AppCommandLayerDeps) => () => deps.slash("/export"),
  },
] as const

/**
 * Two layers, mirroring app.tsx:
 *  1. command definitions with NO bindings and NO ownership gate — always
 *     registered, so `ctrl+p`'s CommandPaletteDialog can list them while its
 *     own dialog owns the keyboard;
 *  2. the configured key bindings, gated on page ownership — so a dialog's
 *     own `ctrl+p` (dialog.select.prev) is never stolen by the palette.
 *
 * The IDs are deliberately the configured ones: Keymap.createLayer resolves
 * each binding from `config.keybinds.get(id)`, so the `<leader>n` / `ctrl+p`
 * strokes from config/keybind.ts light up unchanged.
 */
export function createAppCommandLayers(deps: AppCommandLayerDeps): Array<() => KeymapLayer> {
  return [
    () => ({
      // global: the layer stays reachable while its own palette dialog pushes
      // modal mode, so the Commands dialog can list these entries.
      mode: "global" as const,
      commands: COMMANDS.map(({ run, ...command }) => ({ ...command, bind: false as const, run: run(deps) })),
    }),
    () => ({
      ...(deps.enabled ? { enabled: deps.enabled } : {}),
      bindings: COMMANDS.map((command) => command.id),
    }),
  ]
}
