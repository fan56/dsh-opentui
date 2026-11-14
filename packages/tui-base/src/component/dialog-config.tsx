import { createMemo, createSignal } from "solid-js"
import { useConfig, useNewDesigns } from "../config"
import { useThemes } from "../context/theme"
import { useDialog, type DialogContext } from "../ui/dialog"
import { DialogSelect, DialogSelectChoice } from "../ui/dialog-select"
import { useToast } from "../ui/toast"
import { t } from "../i18n"
import { DialogThemeList } from "./dialog-theme-list"

type Setting = {
  /** i18n key (`dialog.config.*`), resolved through t() at read time so no language value is baked flat at module scope. */
  titleKey: string
  /** i18n key (`dialog.config.category.*`). */
  categoryKey: string
  path: string[]
  /** Shown below the list while the setting is selected, under the "new-designs" experiment. i18n key. */
  descriptionKey: string
  default: unknown
  values?: readonly unknown[]
  /** i18n keys parallel to `values`; shown for enum settings. */
  labelKeys?: readonly string[]
  step?: number
  min?: number
  max?: number
  format?: (value: unknown) => string
  keywords?: readonly string[]
  /** Under the "new-designs" experiment, enter opens this picker instead of cycling. ←/→ still cycle. */
  open?: (dialog: DialogContext) => void
}

export const settings: Setting[] = [
  {
    titleKey: "dialog.config.theme.name.title",
    categoryKey: "dialog.config.category.appearance",
    path: ["theme", "name"],
    descriptionKey: "dialog.config.theme.name.description",
    default: "opencode",
    keywords: ["color scheme", "colors"],
    open: (dialog) =>
      dialog.replace(() => (
        <DialogThemeList onClose={() => dialog.replace(() => <DialogConfig current="theme.name" />)} />
      )),
  },
  {
    titleKey: "dialog.config.theme.mode.title",
    categoryKey: "dialog.config.category.appearance",
    path: ["theme", "mode"],
    descriptionKey: "dialog.config.theme.mode.description",
    default: "system",
    values: ["system", "dark", "light"],
    keywords: ["dark mode", "light mode", "system theme"],
  },
  {
    // Kept for the vendored config schema/legacy callers, but the v2 client
    // reads motion from skin/motion.ts (the `/motion` command), NOT this key —
    // so `motion` is deliberately not a search keyword here (typing "motion"
    // must not land on a switch that does nothing in v2).
    titleKey: "dialog.config.animations.title",
    categoryKey: "dialog.config.category.appearance",
    path: ["animations"],
    descriptionKey: "dialog.config.animations.description",
    default: false,
    values: [false, true],
    labelKeys: ["common.off", "common.on"],
    keywords: ["effects"],
  },
  {
    titleKey: "dialog.config.session.sidebar.title",
    categoryKey: "dialog.config.category.session",
    path: ["session", "sidebar"],
    descriptionKey: "dialog.config.session.sidebar.description",
    default: "auto",
    values: ["hide", "auto"],
    keywords: ["side panel"],
  },
  {
    titleKey: "dialog.config.session.scrollbar.title",
    categoryKey: "dialog.config.category.session",
    path: ["session", "scrollbar"],
    descriptionKey: "dialog.config.session.scrollbar.description",
    default: false,
    values: [false, true],
    labelKeys: ["common.off", "common.on"],
    keywords: ["scroll bar"],
  },
  {
    titleKey: "dialog.config.session.submit_scroll.title",
    categoryKey: "dialog.config.category.session",
    path: ["session", "submit_scroll"],
    descriptionKey: "dialog.config.session.submit_scroll.description",
    default: "bottom",
    values: ["bottom", "keep"],
    labelKeys: ["dialog.config.label.jumpToLatest", "dialog.config.label.keepPosition"],
    keywords: ["submit", "scroll position", "jump to latest", "follow"],
  },
  {
    titleKey: "dialog.config.session.thinking.title",
    categoryKey: "dialog.config.category.session",
    path: ["session", "thinking"],
    descriptionKey: "dialog.config.session.thinking.description",
    default: "hide",
    values: ["hide", "show"],
    keywords: ["reasoning", "chain of thought"],
  },
  {
    titleKey: "dialog.config.session.markdown.title",
    categoryKey: "dialog.config.category.session",
    path: ["session", "markdown"],
    descriptionKey: "dialog.config.session.markdown.description",
    default: "rendered",
    values: ["source", "rendered"],
    keywords: ["syntax", "concealment", "rendering"],
  },
  {
    titleKey: "dialog.config.session.grouping.title",
    categoryKey: "dialog.config.category.session",
    path: ["session", "grouping"],
    descriptionKey: "dialog.config.session.grouping.description",
    default: "auto",
    values: ["none", "auto"],
    keywords: ["transcript", "messages", "reads", "searches"],
  },
  {
    titleKey: "dialog.config.session.verbosity.title",
    categoryKey: "dialog.config.category.session",
    path: ["session", "verbosity"],
    descriptionKey: "dialog.config.session.verbosity.description",
    default: "medium",
    values: ["low", "medium", "high"],
    keywords: ["detail", "activity", "summary", "transcript"],
  },
  {
    titleKey: "dialog.config.session.image_preview.title",
    categoryKey: "dialog.config.category.session",
    path: ["session", "image_preview"],
    descriptionKey: "dialog.config.session.image_preview.description",
    default: false,
    values: [false, true],
    labelKeys: ["common.off", "common.on"],
    keywords: ["attachments", "images", "tool output"],
  },
  {
    titleKey: "dialog.config.session.tps.title",
    categoryKey: "dialog.config.category.session",
    path: ["session", "tps"],
    descriptionKey: "dialog.config.session.tps.description",
    default: true,
    values: [false, true],
    labelKeys: ["common.off", "common.on"],
    keywords: ["tokens per second", "throughput"],
  },
  {
    titleKey: "dialog.config.session.new_location.title",
    categoryKey: "dialog.config.category.session",
    path: ["session", "new_location"],
    descriptionKey: "dialog.config.session.new_location.description",
    default: "launch",
    values: ["launch", "inherit"],
    labelKeys: ["dialog.config.label.launchDirectory", "dialog.config.label.activeSession"],
    keywords: ["directory", "cwd", "inherit"],
  },
  {
    titleKey: "dialog.config.session.permissions.title",
    categoryKey: "dialog.config.category.session",
    path: ["session", "permissions"],
    descriptionKey: "dialog.config.session.permissions.description",
    default: "prompt",
    values: ["prompt", "autoaccept"],
    labelKeys: ["dialog.config.label.prompt", "dialog.config.label.autoAccept"],
    keywords: ["approve", "accept", "permission requests"],
  },
  {
    titleKey: "dialog.config.tabs.mode.title",
    categoryKey: "dialog.config.category.tabs",
    path: ["tabs", "mode"],
    descriptionKey: "dialog.config.tabs.mode.description",
    default: "auto",
    values: ["off", "on", "auto"],
  },
  {
    titleKey: "dialog.config.tabs.scope.title",
    categoryKey: "dialog.config.category.tabs",
    path: ["tabs", "scope"],
    descriptionKey: "dialog.config.tabs.scope.description",
    default: "cwd",
    values: ["cwd", "global"],
    labelKeys: ["dialog.config.label.currentDirectory", "dialog.config.label.global"],
  },
  {
    titleKey: "dialog.config.tabs.layout.title",
    categoryKey: "dialog.config.category.tabs",
    path: ["tabs", "layout"],
    descriptionKey: "dialog.config.tabs.layout.description",
    default: "horizontal",
    values: ["horizontal", "vertical"],
    keywords: ["sidebar", "orientation", "left"],
  },
  {
    titleKey: "dialog.config.tabs.indicators.title",
    categoryKey: "dialog.config.category.tabs",
    path: ["tabs", "indicators"],
    descriptionKey: "dialog.config.tabs.indicators.description",
    default: "status",
    values: ["status", "numbers"],
    labelKeys: ["dialog.config.label.statusIcons", "dialog.config.label.alwaysNumbers"],
    keywords: ["tab numbers", "number mode", "status icons"],
  },
  {
    titleKey: "dialog.config.diffs.view.title",
    categoryKey: "dialog.config.category.diffs",
    path: ["diffs", "view"],
    descriptionKey: "dialog.config.diffs.view.description",
    default: "auto",
    values: ["auto", "split", "unified"],
    keywords: ["diff layout", "split diff", "unified diff"],
  },
  {
    titleKey: "dialog.config.diffs.wrap.title",
    categoryKey: "dialog.config.category.diffs",
    path: ["diffs", "wrap"],
    descriptionKey: "dialog.config.diffs.wrap.description",
    default: "word",
    values: ["none", "word"],
    keywords: ["diff wrap", "word wrap", "line wrap"],
  },
  {
    titleKey: "dialog.config.diffs.tree.title",
    categoryKey: "dialog.config.category.diffs",
    path: ["diffs", "tree"],
    descriptionKey: "dialog.config.diffs.tree.description",
    default: true,
    values: [false, true],
    labelKeys: ["common.off", "common.on"],
    keywords: ["diff files"],
  },
  {
    titleKey: "dialog.config.diffs.single.title",
    categoryKey: "dialog.config.category.diffs",
    path: ["diffs", "single"],
    descriptionKey: "dialog.config.diffs.single.description",
    default: false,
    values: [false, true],
    labelKeys: ["common.off", "common.on"],
    keywords: ["one file", "selected file"],
  },
  {
    titleKey: "dialog.config.scroll.speed.title",
    categoryKey: "dialog.config.category.input",
    path: ["scroll", "speed"],
    descriptionKey: "dialog.config.scroll.speed.description",
    default: 3,
    step: 0.25,
    min: 0.25,
    max: 10,
    format: (value) => Number(value).toFixed(2),
    keywords: ["scrolling"],
  },
  {
    titleKey: "dialog.config.scroll.acceleration.title",
    categoryKey: "dialog.config.category.input",
    path: ["scroll", "acceleration"],
    descriptionKey: "dialog.config.scroll.acceleration.description",
    default: false,
    values: [false, true],
    labelKeys: ["common.off", "common.on"],
    keywords: ["scroll acceleration"],
  },
  {
    titleKey: "dialog.config.mouse.title",
    categoryKey: "dialog.config.category.input",
    path: ["mouse"],
    descriptionKey: "dialog.config.mouse.description",
    default: true,
    values: [false, true],
    labelKeys: ["common.off", "common.on"],
    keywords: ["mouse capture"],
  },
  {
    titleKey: "dialog.config.prompt.editor.title",
    categoryKey: "dialog.config.category.input",
    path: ["prompt", "editor"],
    descriptionKey: "dialog.config.prompt.editor.description",
    default: true,
    values: [false, true],
    labelKeys: ["common.off", "common.on"],
    keywords: ["file context", "prompt context", "editor selection"],
  },
  {
    titleKey: "dialog.config.prompt.paste.title",
    categoryKey: "dialog.config.category.input",
    path: ["prompt", "paste"],
    descriptionKey: "dialog.config.prompt.paste.description",
    default: "compact",
    values: ["compact", "full"],
    keywords: ["paste summary", "clipboard", "pasted content"],
  },
  {
    titleKey: "dialog.config.prompt.image_preview.title",
    categoryKey: "dialog.config.category.input",
    path: ["prompt", "image_preview"],
    descriptionKey: "dialog.config.prompt.image_preview.description",
    default: false,
    values: [false, true],
    labelKeys: ["common.off", "common.on"],
    keywords: ["attachments", "clipboard", "images", "prompt"],
  },
  {
    titleKey: "dialog.config.leader.timeout.title",
    categoryKey: "dialog.config.category.input",
    path: ["leader", "timeout"],
    descriptionKey: "dialog.config.leader.timeout.description",
    default: 2000,
    step: 250,
    min: 250,
    max: 10000,
    format: (value) => `${value} ms`,
    keywords: ["leader key", "shortcut timeout"],
  },
  {
    titleKey: "dialog.config.attention.notifications.title",
    categoryKey: "dialog.config.category.alerts",
    path: ["attention", "notifications"],
    descriptionKey: "dialog.config.attention.notifications.description",
    default: false,
    values: [false, true],
    labelKeys: ["common.off", "common.on"],
    keywords: ["system notifications", "desktop notifications", "alerts"],
  },
  {
    titleKey: "dialog.config.attention.sound.title",
    categoryKey: "dialog.config.category.alerts",
    path: ["attention", "sound"],
    descriptionKey: "dialog.config.attention.sound.description",
    default: false,
    values: [false, true],
    labelKeys: ["common.off", "common.on"],
    keywords: ["audio", "sound effects", "alerts"],
  },
  {
    titleKey: "dialog.config.attention.volume.title",
    categoryKey: "dialog.config.category.alerts",
    path: ["attention", "volume"],
    descriptionKey: "dialog.config.attention.volume.description",
    default: 0.4,
    step: 0.1,
    min: 0,
    max: 1,
    format: (value) => `${Math.round(Number(value) * 100)}%`,
    keywords: ["sound volume", "audio volume"],
  },
  {
    titleKey: "dialog.config.highlights.title",
    categoryKey: "dialog.config.category.alerts",
    path: ["highlights"],
    descriptionKey: "dialog.config.highlights.description",
    default: true,
    values: [false, true],
    labelKeys: ["common.off", "common.on"],
    keywords: ["what's new", "changelog", "release notes"],
  },
  {
    titleKey: "dialog.config.terminal.title.title",
    categoryKey: "dialog.config.category.terminal",
    path: ["terminal", "title"],
    descriptionKey: "dialog.config.terminal.title.description",
    default: true,
    values: [false, true],
    labelKeys: ["common.off", "common.on"],
    keywords: ["terminal title", "tab title"],
  },
  {
    titleKey: "dialog.config.terminal.copy.title",
    categoryKey: "dialog.config.category.terminal",
    path: ["terminal", "copy"],
    descriptionKey: "dialog.config.terminal.copy.description",
    default: process.platform === "win32" ? "manual" : "select",
    values: ["manual", "select"],
    keywords: ["selection", "clipboard"],
  },
  {
    titleKey: "dialog.config.debug.devtools.title",
    categoryKey: "dialog.config.category.debug",
    path: ["debug", "devtools"],
    descriptionKey: "dialog.config.debug.devtools.description",
    default: false,
    values: [false, true],
    labelKeys: ["common.off", "common.on"],
    keywords: ["debug bar", "developer tools"],
  },
]

export function settingID(setting: Setting) {
  return setting.path.join(".")
}

export function DialogConfig(props: { current?: string }) {
  const config = useConfig()
  const newDesigns = useNewDesigns()
  const dialog = useDialog()
  const toast = useToast()
  const themes = useThemes()
  const current = Math.max(
    0,
    settings.findIndex((setting) => settingID(setting) === props.current),
  )
  const [selected, setSelected] = createSignal(current)
  const [saving, setSaving] = createSignal(false)

  const value = (setting: Setting) => {
    const current = setting.path.reduce<unknown>((result, key) => {
      if (!result || typeof result !== "object") return undefined
      return (result as Record<string, unknown>)[key]
    }, config.data)
    if (setting.path.join(".") === "theme.name") return current ?? themes.selected
    return current ?? setting.default
  }
  const values = (setting: Setting) =>
    setting.path.join(".") === "theme.name"
      ? Object.keys(themes.all()).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }))
      : setting.values
  const display = (setting: Setting) => {
    const current = value(setting)
    if (setting.format) return setting.format(current)
    const index = setting.values?.indexOf(current)
    const labelKey = index === undefined || index < 0 ? undefined : setting.labelKeys?.[index]
    return labelKey ? t(labelKey) : String(current)
  }
  const options = createMemo(() =>
    settings.map((setting, index) => ({
      title: t(setting.titleKey),
      category: t(setting.categoryKey),
      searchText: setting.keywords?.join(" "),
      footer: newDesigns() ? (
        <DialogSelectChoice value={display(setting)} active={selected() === index} open={setting.open !== undefined} />
      ) : (
        display(setting)
      ),
      footerOverhang: newDesigns() ? 2 : undefined,
      detail: newDesigns() ? t(setting.descriptionKey) : undefined,
      value: index,
    })),
  )

  async function change(direction: number, index = selected()) {
    if (saving()) return
    const setting = settings[index]
    const current = value(setting)
    const choices = values(setting)
    const next = choices
      ? choices[(choices.indexOf(current) + direction + choices.length) % choices.length]
      : Math.min(setting.max!, Math.max(setting.min!, Number(current) + direction * setting.step!))
    if (next === current) return
    setSaving(true)
    await config
      .update((draft) => {
        const parent = setting.path.slice(0, -1).reduce<Record<string, unknown>>((result, key) => {
          if (!result[key] || typeof result[key] !== "object") result[key] = {}
          return result[key] as Record<string, unknown>
        }, draft)
        parent[setting.path.at(-1)!] = next
      })
      .catch(toast.error)
      .finally(() => setSaving(false))
  }

  return (
    <DialogSelect
      title={t("dialog.config.title")}
      searchInTitle
      titlePlaceholder={t("dialog.config.searchPlaceholder")}
      options={options()}
      // Under new designs the opening setting is focused without the current-item marker; changing a value keeps the
      // selection where it is.
      current={newDesigns() ? undefined : current}
      focusTarget={newDesigns() ? current : undefined}
      preserveSelection={newDesigns()}
      filterThreshold={0.7}
      onMove={(option) => setSelected(option.value)}
      onSelect={(option) => {
        const open = settings[option.value].open
        if (newDesigns() && open) return open(dialog)
        void change(1, option.value)
      }}
      footerHints={newDesigns() ? [] : [{ title: t("dialog.config.footer.change"), label: "←/→" }]}
      bindings={[
        {
          bind: "left",
          title: t("dialog.config.keymap.previousValue"),
          group: "Settings",
          run: () => void change(-1),
        },
        {
          bind: "right",
          title: t("dialog.config.keymap.nextValue"),
          group: "Settings",
          run: () => void change(1),
        },
      ]}
    />
  )
}
