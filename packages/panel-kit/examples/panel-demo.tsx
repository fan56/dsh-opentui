/**
 * panel-demo.tsx — interactive showcase for @dsh-opentui/panel-kit.
 *
 *   bun packages/panel-kit/examples/panel-demo.tsx
 *   PANEL_DEMO_SCENE=zoo|fade|stack bun packages/panel-kit/examples/panel-demo.tsx
 *
 * Scenes:
 *   zoo   — List / Check / Dropdown / InputRow / Button.
 *   fade  — one-shot 160 ms fade in / fade out (the v1 transition).
 *   stack — settings-style panel + ConfirmDialog on top; Esc steps back one
 *           layer, the lower layer is dimmed by its own scrim.
 *
 * 80x24: panels use size "medium"/"large" + maxHeight 18 and auto clamp to
 * terminal - 2 / terminal - 4; compact inset switching is internal.
 */
import { render, useKeyboard, useTerminalDimensions } from "@opentui/solid"
import { createSignal, onMount, type JSX } from "solid-js"
import type {
  DropdownOption,
  PanelKeyAdapter,
  PanelKeyCommands,
  PanelMotionAdapter,
} from "../src/contracts"
import { Button } from "../src/controls/button"
import { Check } from "../src/controls/check"
import { Dropdown } from "../src/controls/dropdown"
import { InputRow } from "../src/controls/input-row"
import { List } from "../src/controls/list"
import { FALLBACK_THEME } from "../src/fallback"
import { PanelKitProvider } from "../src/kit"
import { usePanelTheme } from "../src/theme"
import { PanelStack, usePanels } from "../src/stack"

const DEFAULT_THEME = FALLBACK_THEME
const KEY_IDS = new Set(["escape", "enter", "space", "up", "down", "left", "right"])

const FULL_MOTION: PanelMotionAdapter = {
  decorationsEnabled: () => true,
  fps: () => 60,
  jump: () => false,
}

/**
 * Demo-only keyboard adapter (no tui-base import): a layered dispatcher over
 * useKeyboard. The top-most registered table wins; a `false` result falls
 * through to the next table, then the focused renderable.
 */
function useDemoKeys(): PanelKeyAdapter {
  const tables: PanelKeyCommands[] = []
  useKeyboard((key) => {
    const id = key.name === "return" ? "enter" : key.name
    if (!KEY_IDS.has(id)) return
    for (let at = tables.length - 1; at >= 0; at -= 1) {
      const handler = tables[at]?.[id]
      if (!handler) continue
      if (handler() === false) continue
      key.preventDefault()
      key.stopPropagation()
      return
    }
  })
  return {
    scope(commands) {
      tables.push(commands)
      return () => {
        const at = tables.lastIndexOf(commands)
        if (at >= 0) tables.splice(at, 1)
      }
    },
  }
}

// ---------------------------------------------------------------------------
// Zoo
// ---------------------------------------------------------------------------

function ZooScene(): JSX.Element {
  const [selected, setSelected] = createSignal<string[]>(["list"])
  const [checked, setChecked] = createSignal(true)
  const [choice, setChoice] = createSignal("auto")
  const [name, setName] = createSignal("")

  const choices: DropdownOption<string>[] = [
    { id: "auto", label: "Auto", value: "auto" },
    { id: "full", label: "Full", value: "full" },
    { id: "off", label: "Off", value: "off" },
  ]

  // Compact 80x24 layout: no section chrome, five rows of controls. The zoo
  // must show every widget without scrolling (round-3 capture finding).
  return (
    <box flexDirection="column" gap={1}>
      <List
        items={[
          { id: "list", label: "List", description: "groups, fuzzy filter" },
          { id: "check", label: "Check", description: "tri-state" },
          { id: "drop", label: "Dropdown", description: "in-panel popup" },
          { id: "input", label: "InputRow", description: "text / number" },
        ]}
        mode="multi"
        selected={selected()}
        onChange={setSelected}
        width={60}
      />
      <Check checked={checked()} label="Decorations" onChange={setChecked} />
      <Dropdown label="mode" value={choice()} options={choices} onChange={setChoice} />
      <InputRow
        label="nickname"
        value={name()}
        onChange={setName}
        placeholder="click to edit, enter commits"
      />
      <box flexDirection="row" gap={2}>
        <Button label="Apply" variant="primary" onPress={() => {}} keyHint="enter" />
        <Button label="Reset" variant="ghost" onPress={() => {}} />
      </box>
    </box>
  )
}

// ---------------------------------------------------------------------------
// Fade (v1 transition)
// ---------------------------------------------------------------------------

function FadeScene(): JSX.Element {
  const theme = usePanelTheme()
  return (
    <box flexDirection="column" gap={1}>
      <text fg={theme().text.base}>one-shot tint · 160 ms · no layout writes</text>
      <text fg={theme().text.muted}>enter fades from the surface color; esc fades this panel out.</text>
      <text fg={theme().text.faint}>choose “Fade” again from the menu to replay.</text>
    </box>
  )
}

function openFade(panels: ReturnType<typeof usePanels>): void {
  panels.open(() => <FadeScene />, {
    title: "Fade · panel",
    size: "medium",
    height: 10,
  })
}

// ---------------------------------------------------------------------------
// Stack
// ---------------------------------------------------------------------------

function SettingsScene(): JSX.Element {
  const theme = usePanelTheme()
  const panels = usePanels()
  const [retention, setRetention] = createSignal<number>(8)
  const [result, setResult] = createSignal("")

  const sections: DropdownOption<string>[] = [
    { id: "general", label: "General", value: "general" },
    { id: "models", label: "Models", value: "models" },
    { id: "account", label: "Account", value: "account" },
    { id: "delete", label: "Delete workspace…", value: "delete" },
  ]

  const confirmDelete = () => {
    void panels
      .confirm({
        title: "Delete workspace?",
        message: "This removes the workspace and its drafts. This cannot be undone.",
        confirmLabel: "Delete",
        cancelLabel: "Keep",
        destructive: true,
        tone: "danger",
      })
      .then((ok) => setResult(ok ? "deleted" : "kept"))
  }

  return (
    <box flexDirection="column" gap={1}>
      <text fg={theme().text.muted}>Settings (stub) — a ConfirmDialog opens over this layer.</text>
      <Dropdown
        label="section"
        value="general"
        options={sections}
        onChange={(next) => {
          if (next === "delete") confirmDelete()
        }}
      />
      <InputRow label="display name" value="dsh" placeholder="name" />
      <InputRow
        label="retention"
        kind="number"
        value={retention()}
        onChange={(next) => setRetention(Number(next) || 0)}
        onCommit={(next) => setRetention(Number(next))}
        min={0}
        max={30}
        unit="days"
      />
      <text fg={theme().text.faint}>result: {result() || "—"}</text>
      <text fg={theme().text.faint}>esc closes confirm first, then this panel</text>
    </box>
  )
}

// ---------------------------------------------------------------------------
// Root menu
// ---------------------------------------------------------------------------

const SCENES: DropdownOption<string>[] = [
  { id: "zoo", label: "Widget zoo", description: "List · Check · Dropdown · InputRow · Button", value: "zoo" },
  { id: "fade", label: "Fade in/out", description: "160 ms one-shot tint", value: "fade" },
  { id: "stack", label: "Stack + confirm", description: "Esc steps back one layer", value: "stack" },
]

function Menu(props: { initialScene?: string }): JSX.Element {
  const theme = usePanelTheme()
  const panels = usePanels()
  const dimensions = useTerminalDimensions()

  const openScene = (scene: string) => {
    if (scene === "zoo") {
      panels.open(() => <ZooScene />, {
        title: "Widget zoo",
        size: "large",
        maxHeight: 18,
      })
    } else if (scene === "fade") {
      openFade(panels)
    } else if (scene === "stack") {
      panels.open(() => <SettingsScene />, {
        title: "Settings",
        size: "medium",
        maxHeight: 18,
      })
    }
  }

  onMount(() => {
    if (props.initialScene) openScene(props.initialScene)
  })

  return (
    <box flexDirection="column" padding={1} gap={1}>
      <text fg={theme().text.base}>{`panel-kit demo · ${dimensions().width}x${dimensions().height}`}</text>
      <text fg={theme().text.muted}>enter opens the scene picker · esc steps back one layer</text>
      <Dropdown label="scene" placeholder="choose a scene" options={SCENES} onChange={openScene} />
      <text fg={theme().text.faint}>
        zoo: widgets · fade: one-shot tint · stack: confirm over settings
      </text>
    </box>
  )
}

export function Demo(props: { motion?: PanelMotionAdapter; initialScene?: string }): JSX.Element {
  const keys = useDemoKeys()
  return (
    <PanelKitProvider theme={DEFAULT_THEME} motion={props.motion ?? FULL_MOTION} keys={keys}>
      <PanelStack maxDepth={4}>
        <Menu initialScene={props.initialScene} />
      </PanelStack>
    </PanelKitProvider>
  )
}

if (import.meta.main) {
  await render(() => <Demo initialScene={process.env.PANEL_DEMO_SCENE} />)
}
