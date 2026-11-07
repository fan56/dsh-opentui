/**
 * The cordis plugin entry, v2 (batch 10a) — this file is what the dsh host
 * loads when the `dsh-opentui` profile boots: it mounts the OpenTUI engine
 * inside the host process and renders the REBUILT tui-base view
 * (Transcript + composer + turn overlays + slash palette + powerline),
 * wired to a HostSession through HostSessionSeam (the in-process twin of
 * the batch-9a RemoteSessionSeam).
 *
 * Composition laws (tui-base README, batch-9a note — learned on the first
 * real boot): children ride GETTERS (compiled-JSX law — eager children are
 * created in the parent's owner scope and miss every context the provider
 * sets), components compose through @opentui/solid's OWN createComponent
 * (plain solid's skips the renderer's owner/context glue), and this entry
 * carries NO JSX for the same reason. The view graph is bundled from
 * tui-base's SOURCE tree (the package export map does not expose the
 * session routes); ADR-0006 direction shell → tui-base is respected.
 *
 * Runtime contract (see build-host.ts): @opentui/* and solid-js stay
 * external (resolved from the bundle dir's own node_modules, 0.8.1);
 * dsh-llm resolves from the global dsh closure via symlink. The old
 * host-entry.tsx/ShellHost stay in tree until the batch-10c deletion.
 */
import { spawn } from "node:child_process"
import type { Context } from "@deepseek-ai/cordis"
import { createSignal, onCleanup, onMount, ErrorBoundary } from "solid-js"
import { createComponent, createElement, render, spread } from "@opentui/solid"
// source-imports are inlined by the bundler; none of them import cordis at runtime
import { mountEngine } from "../../runtime/src/engine.ts"
import { Config } from "./plugin-config.ts"
import { HostSession } from "./host-session.ts"
import { HostSessionSeam } from "./host-session-seam-adapter.ts"

// tui-base view graph (bundled from source; see header)
import { SessionComposer } from "../../tui-base/src/routes/session/session-composer"
import { SubagentsPicker } from "../../tui-base/src/routes/session/subagents-picker"
import { registerSubagentSteerFeedback } from "../../tui-base/src/routes/session/subagent-markers"
import { createSeamRows } from "../../tui-base/src/routes/session/seam-rows"
import { Transcript } from "../../tui-base/src/routes/session/transcript"
import { TurnOverlayController } from "../../tui-base/src/routes/session/turn-overlay-controller"
import { registerTurnOverlays, TurnOverlayHost } from "../../tui-base/src/routes/session/turn-overlays"
import { createSlashHost, SlashPalette } from "../../tui-base/src/routes/session/slash-palette"
import { BtwController, createBtwOpener, createBtwSnapshotBuilder } from "../../tui-base/src/routes/session/btw-overlay"
import { DialogSelect } from "../../tui-base/src/ui/dialog-select"
import { DialogProvider, useDialog } from "../../tui-base/src/ui/dialog"
import { ToastProvider } from "../../tui-base/src/ui/toast"
import { ClipboardProvider } from "../../tui-base/src/context/clipboard"
import { Keymap } from "../../tui-base/src/context/keymap"
import { ThemeProvider, useTheme, useThemes } from "../../tui-base/src/context/theme"
import { ConfigProvider, resolve } from "../../tui-base/src/config"
import { createThemeSeam } from "../../tui-base/src/seams/theme"
import { PowerlineFooter, sessionFooterSegments } from "../../tui-base/src/routes/session/powerline"
import { readCacheHitMode } from "../../tui-base/src/seams/config"
import { StatusBar } from "../../tui-base/src/routes/session/status-bar"
import { TurnCancelKeys } from "../../tui-base/src/routes/session/turn-cancel"

// cordis v4: every ctx.<service> access must be declared here — and the
// loader unwraps `default ?? exports`, so inject must ride ON the default
// export object, not as a sibling named export
const inject = ["agents"]

/** True when this process already carries the FFI flag (guards re-exec). */
function hasFfiFlag(): boolean {
  return (process.env.NODE_OPTIONS ?? "").includes("--experimental-ffi")
}

/**
 * OpenTUI's native layer needs --experimental-ffi, which a bare
 * `dsh --profile dsh-opentui` does not carry (only the dsh-opentui launcher
 * injects it). Instead of dying, re-exec the SAME dsh command with the flag
 * merged into NODE_OPTIONS: the child reaches this path again WITH the flag
 * and boots normally. Guarded by hasFfiFlag so it never loops.
 */
function reExecWithFfi(): boolean {
  if (hasFfiFlag()) return false
  const env = {
    ...process.env,
    NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --experimental-ffi`.trim(),
  }
  const child = spawn(process.argv[1]!, process.argv.slice(2), {
    env,
    stdio: "inherit",
    cwd: process.cwd(),
  })
  child.on("exit", (code) => process.exit(code ?? 0))
  return true
}

/** Synchronous dev diagnostics (console output races process.exit). */
function appendDiagnostic(line: string): void {
  try {
    require("node:fs").appendFileSync("/tmp/b10a-render-diag.txt", `${line}\n`)
  } catch {
    /* diagnostics are best-effort */
  }
}

const overlays = new TurnOverlayController()

/** The v2 session page: the real seam driving the rebuilt view (the
 * batch-9a V2SessionPage composition, host-session edition). */
function V2SessionPage(props: { seam: HostSessionSeam; themeName?: string; quit: () => void }) {
  const seam = props.seam
  const projection = createSeamRows(seam, () => seam.currentSessionId() ?? "", {
    // Mid-turn approvals route through the batch-5 card.
    onApprove: (name, args) => overlays.requestApproval(name, args),
  })
  const dialog = useDialog()
  const theme = useTheme()
  const themeSeam = createThemeSeam(useThemes())
  if (props.themeName && !themeSeam.setTheme(props.themeName)) {
    console.error(`[host-entry-v2] unknown theme ${props.themeName}; bundled: ${themeSeam.list().join(", ")}`)
  }
  const [composerBusy, setComposerBusy] = createSignal(false)
  const [turnBusy, setTurnBusy] = createSignal(false)
  const busy = () => composerBusy() || turnBusy()
  const [busySince, setBusySince] = createSignal(0)
  const [msgs, setMsgs] = createSignal(0)
  const [model, setModel] = createSignal<{ providerID: string; modelID: string } | undefined>()
  const [now, setNow] = createSignal(new Date())
  let composerRef: { focused(): boolean; focus(): void } | undefined
  onMount(() => {
    void projection.load()
    void seam.currentModelSelection().then(setModel)
    const timer = setInterval(() => setNow(new Date()), 1000)
    onCleanup(() => clearInterval(timer))
  })
  const elapsed = () => (busy() ? Math.max(0, Math.floor((now().getTime() - busySince()) / 1000)) : 0)
  const send = (text: string) => {
    setMsgs((n) => n + 1)
    setTurnBusy(true)
    setBusySince(Date.now())
    const done = projection.send(text)
    void done.finally(() => setTurnBusy(false))
    return done
  }
  // ⚡ CH (batch F2): usage lands at turn end, so reading turnBusy() here
  // re-runs the getter-fed segment list on each turn boundary (footer row
  // only — PowerlineFooter's `left` prop is a getter, reactive-prop law).
  // cacheHitMode (batch F2, tui-pi semantics): the mode is re-read off the
  // config seam on every re-run — a profile flip applies on the next
  // repaint without a restart.
  const cacheRate = () => {
    turnBusy()
    const mode = readCacheHitMode(seam.configLoad?.())
    return seam.cacheHitRate?.(mode) ?? null
  }
  const segments = () =>
    sessionFooterSegments({
      provider: model()?.providerID,
      model: model()?.modelID,
      messages: msgs(),
      tools: 0,
      cacheHitRate: cacheRate(),
      theme,
    })
  let cmdOrdinal = 0
  // G1 resume-picker: the optional third arg paints an aligned column-header
  // line under the dialog title (DialogSelect's muted header description) —
  // the /sessions UPDATED/DIR columns ride it.
  const pickOne = (title: string, options: { title: string; value: string }[], headerLine?: string) =>
    new Promise<string | undefined>((resolvePick) => {
      let settled = false
      const done = (value: string | undefined) => {
        if (settled) return
        settled = true
        dialog.clear()
        resolvePick(value)
      }
      dialog.replace(
        () =>
          createComponent(DialogSelect, {
            title,
            description: headerLine,
            renderFilter: false,
            options: options.map((option) => ({ title: option.title, value: option.value })),
            onSelect: (option: { value: string }) => done(option.value),
            onCancel: () => done(undefined),
          }),
        () => done(undefined),
      )
    })
  // /btw side-question overlay (feature batch F3): out-of-band answer over
  // the facade's throwaway session; never touches the main turn.
  const btw = new BtwController({
    ask: (question, snapshot, onDelta) =>
      seam.btwAsk ? seam.btwAsk(question, snapshot, onDelta) : Promise.resolve("error: /btw unavailable"),
    snapshot: createBtwSnapshotBuilder(seam),
  })
  const openBtw = createBtwOpener({ controller: btw, dialog })
  // Batch D9: the transcript print path (the slash-command feedback row, the
  // /help print path) shared by the slash host AND the steer outcome echo —
  // the subagent steer components print through the module bridge's feedback
  // slot, which registers this same printer.
  const sayLine = (text: string) =>
    projection.apply({
      type: "message.part.updated",
      details: { messageID: "cmd", part: { type: "text", id: `cmd-${++cmdOrdinal}`, text } },
    })
  registerSubagentSteerFeedback(sayLine)
  const slash = createSlashHost({
    seam,
    say: sayLine,
    clear: () => projection.hydrate([]),
    reload: () => {
      const settled = projection.load()
      void seam.currentModelSelection().then(setModel)
      return settled
    },
    quit: props.quit,
    pickOne,
    openBtw: (argText: string) => void openBtw(argText),
    // /theme switch surface (batch F7a/F7b): the page's ThemeSeam, re-hiding
    // the picker behind the generic pickOne modal. Apply is live; the picked
    // name ALSO persists through the seam's configSave (batch F7b —
    // HostSession.configSave upserts the profile config.json `theme` key),
    // and boot applies the stored name (props.themeName ← configLoad().theme).
    themes: {
      current: () => themeSeam.current(),
      list: () => themeSeam.list(),
      set: (name: string) => {
        const applied = themeSeam.setTheme(name)
        if (applied) {
          try {
            seam.configSave?.({ theme: name })
          } catch (error) {
            console.error("[host-entry-v2] theme persist failed:", error)
          }
        }
        return applied
      },
    },
  })
  const overlayHost = createComponent(TurnOverlayHost, {
    controller: overlays,
    reclaimFocus: () => {
      if (composerRef && !composerRef.focused()) composerRef.focus()
    },
  })
  // Single root node (the example's <box flexDirection="column">); the
  // reconciler-native intrinsic path: createElement(tag) + spread(props).
  const root = createElement("box")
  spread(root, {
    flexDirection: "column",
    width: "100%",
    height: "100%",
    backgroundColor: "black",
    get children() {
      return [
        createComponent(Transcript, {
          seam,
          projection,
          get children() {
            return createComponent(SessionComposer, {
              seam,
              send,
              onBusyChange: setComposerBusy,
              ref: (r: { focused(): boolean; focus(): void }) => (composerRef = r),
              slashKeyFilter: slash.slashKeyFilter,
              slashSync: (buffer: string) => slash.controller.sync(buffer, slash.commands),
              interceptSubmit: slash.interceptSubmit,
              slashPalette: () => createComponent(SlashPalette, { controller: slash.controller, commands: slash.commands }),
              slashHeight: () => slash.controller.rows(),
            })
          },
        }),
        // Subagents picker (batch C10a mount-gap fix): the vendored
        // SubagentsTab needs the vendored app contexts this page never
        // mounts, so the seam-native picker (rows off the subagent-markers
        // store, steer through the module bridge) rides here instead —
        // toggled by the vendored `session.child.first` keybind (down).
        // Getter-prop law: the seam rides a getter.
        createComponent(SubagentsPicker, {
          get seam() {
            return seam
          },
        }),
        // Cancel contract (batch V2, ported here — plugin parity with
        // tui-base/examples/v2-entry.tsx): esc interrupts the running turn;
        // ctrl+c interrupts + arms, ctrl+c x2 quits through props.quit.
        // engine.ts runs the renderer with exitOnCtrlC: false, so without
        // this layer ctrl+c was swallowed and never quit (only /quit did).
        // Props are functions / stable refs only (reactive-prop law).
        createComponent(TurnCancelKeys, {
          busy,
          interrupt: () => seam.interrupt(),
          quit: props.quit,
          enabled: () => dialog.stack.length === 0,
          escapeYields: () => slash.controller.open,
        }),
        // Reactive-prop law (batch 10d, ported here in batch V5): sibling
        // props ride GETTERS. An eager busy()/segments()/now() read is
        // tracked by this children getter, so every 1s clock tick re-ran it
        // and remounted the whole subtree — including SessionComposer, whose
        // fresh textarea dropped the typed buffer between keystrokes (the
        // palette-open + typing failure: "/" then "h" left the buffer "h").
        createComponent(StatusBar, {
          get phase() {
            return busy() ? "stream" : null
          },
          elapsed,
        }),
        createComponent(PowerlineFooter, {
          get left() {
            return segments()
          },
          get right() {
            return clock(now())
          },
          theme,
        }),
        overlayHost,
      ]
    },
  })
  return root
}

function clock(d: Date): string {
  return d.toTimeString().slice(0, 8)
}

/** Error boundary that surfaces view crashes synchronously (dev aid). */
function ErrorBoundaryDiagnostics(props: { children: unknown }) {
  return createComponent(ErrorBoundary, {
    fallback: (error: unknown) => {
      appendDiagnostic(`[v2 render error] ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`)
      process.stderr.write("dsh-opentui view crashed: " + String(error instanceof Error ? error.message : error) + "\n")
      process.exit(2)
      return null as never
    },
    get children() {
      return props.children
    },
  })
}

export function apply(ctx: Context, config?: { theme?: string }) {
  const session = new HostSession(ctx)
  const seam = new HostSessionSeam(session)
  registerTurnOverlays(seam, overlays)
  // Boot restore precedence (67-theme capture-verified 2026-11-07): the
  // PERSISTED profile config.json choice must win over the embedder pin —
  // the e2e image bakes `theme: catppuccin-mocha` into the plugin config
  // (cordis.patch.yml), and with config?.theme first that pin shadowed
  // configLoad().theme forever, making the F7b persist+restore pair
  // dead code at boot (live apply worked, restore never repainted).
  const themeName = session.configLoad().theme ?? config?.theme

  mountEngine({}).then(({ renderer }) => {
    // The engine owns THE CliRenderer on stdin (0.7-era host contract, kept):
    // solid's render() must reuse it — called renderer-less it creates a
    // SECOND CliRenderer and dies ("stdin is already used by another
    // CliRenderer", boot-validated).
    // The example page's provider closure, in the vendored app's order.
    // COMPILED-JSX LAW: children ride GETTERS — eager children are created
    // in the parent's owner scope and miss the provider's context.
    render(() =>
      createComponent(ConfigProvider, {
        config: resolve({}, { terminalSuspend: true }),
        get children() {
          return createComponent(Keymap.Provider, {
            get children() {
              return createComponent(ToastProvider, {
                get children() {
                  return createComponent(ThemeProvider, {
                    mode: "dark",
                    source: { discover: async () => ({}) },
                    get children() {
                      return createComponent(ClipboardProvider, {
                        value: { read: async () => undefined, write: async () => {} },
                        get children() {
                          return createComponent(DialogProvider, {
                            get children() {
                              return createComponent(ErrorBoundaryDiagnostics, {
                                get children() {
                                  return createComponent(V2SessionPage, {
                                    seam,
                                    themeName,
                                    quit: () => process.exit(0),
                                  })
                                },
                              })
                            },
                          })
                        },
                      })
                    },
                  })
                },
              })
            },
          })
        },
      }),
      renderer,
    ).catch((error: unknown) => {
      appendDiagnostic(`[v2 boot render failed] ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`)
      process.stderr.write("dsh-opentui boot failed: " + String(error instanceof Error ? error.message : error) + "\n")
    })
  }).catch((e) => {
    const msg = String(e)
    if (/native FFI is not available/.test(msg) && reExecWithFfi()) return
    process.stderr.write("dsh-opentui boot failed: " + msg + "\n")
  })
}

// Config rides ON the default export object: the cordis-plugin-loader
// unwraps `exports.default ?? exports`, so the runtime the host sees is this
// object — dsh-settings SettingsForms.describe() reads
// `entry.fiber.runtime.Config` off it and filters the entry OUT of the
// settings surface entirely when it is missing (which kept the F1 maxRounds
// hard-stop ladder disabled; see plugin-config.ts).
export const plugin = { name: "dsh-opentui", inject, apply, Config }
export { Config }
export default plugin
