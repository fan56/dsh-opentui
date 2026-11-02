/**
 * Kit — the shared component library. Shell and plugins build on these;
 * the Shell eats its own dog food (nothing ships in Kit that the Shell
 * does not use). Components are Solid + OpenTUI intrinsics.
 */
export { createI18n, type I18n, type Locale } from "./i18n.ts"
export { defaultTheme, catppuccinMocha, themes, getTheme, themeNames, type Theme, type ThemeTokens } from "./theme.ts"
export { Panel, Line, renderParts } from "./components.tsx"
export { type TranscriptItem, Transcript, TranscriptWindow, InputLine, FooterHints } from "./shell-parts.tsx"
export { type PickerItem, Picker, Dialog, ApprovalCard } from "./overlays.tsx"
export { type ToolPanelEntry, ToolPanel, ThinkPanel } from "./panels.tsx"


export { type TableColumn, Table } from "./table.tsx"

export { type PowerlineSegment, PowerlineFooter, POWERLINE_COLORS, speedSegment } from "./powerline.tsx"
export { WelcomeBanner } from "./welcome.tsx"
export { DAILY_QUOTES, pickDailyQuote } from "./quotes.ts"
export { type ThinkWidgetState, type ToolWidgetEntry, ThinkWidget, ToolWidget } from "./dock-widgets.tsx"
export { type SubagentEntry, SubagentWidget } from "./subagent-widget.tsx"
export { AutoScroll } from "./scroll.tsx"
export { type SelectItem, Select } from "./select.tsx"
export { type TodoItem, TodosWidget } from "./todos.tsx"
export { WidgetFrame, dimColor, widgetRows } from "./widget-frame.tsx"
export { StatusBar, type StatusPhase } from "./status-bar.tsx"
export { FlowBar } from "./flow-bar.tsx"
