/**
 * Composer key bindings derived from the vendored keybind config
 * (`config/keybind.ts`): `input.submit` (default "return") and
 * `input.newline` (default "shift+return,ctrl+return,alt+return,ctrl+j").
 *
 * The vendored app routes these through its keymap editor layer
 * (`context/keymap.tsx` reads `config.keybinds.get("input.submit" | ...)`).
 * The rebuilt composer has no Keymap context, so it maps the SAME config
 * values onto the native textarea's `keyBindings` prop. A host passing
 * resolved overrides (`keybinds` in tui config) changes both keys.
 *
 * `kpenter` (numpad enter) mirrors every `return` binding — a textarea-level
 * alias, not part of the config vocabulary (the pre-batch-6 literal list had
 * it; kept so numpad behavior does not regress).
 */
import { TuiKeybind } from "../../config/keybind"

export type ComposerAction = "submit" | "newline"

export type ComposerKeyBinding = {
	name: string
	ctrl?: boolean
	shift?: boolean
	meta?: boolean
	super?: boolean
	action: ComposerAction
}

type Stroke = Omit<ComposerKeyBinding, "action">

const MODIFIERS: Record<string, keyof Omit<Stroke, "name">> = {
	ctrl: "ctrl",
	shift: "shift",
	alt: "meta", // textarea/OpenTUI KeyEvent: alt arrives as meta
	meta: "meta",
	option: "meta",
	super: "super",
}

/** "alt+return" → { name: "return", meta: true }. Undefined for leader chords
 * and multi-key sequences ("<leader>x", "gg"), which a textarea cannot bind. */
export function parseStroke(spec: string): Stroke | undefined {
	const parts = spec.trim().toLowerCase().split("+")
	const name = parts.pop()
	if (!name || name.includes("<")) return undefined
	const stroke: Stroke = { name }
	for (const part of parts) {
		const flag = MODIFIERS[part]
		if (!flag) return undefined
		stroke[flag] = true
	}
	return stroke
}

/** Flatten one config value (string list / stroke / object / array / none). */
export function strokesOf(value: TuiKeybind.BindingValueSchema): Stroke[] {
	if (value === false || value === "none") return []
	const items = Array.isArray(value) ? value : [value]
	const out: Stroke[] = []
	for (const item of items) {
		if (typeof item === "string") {
			for (const spec of item.split(",")) {
				const stroke = parseStroke(spec)
				if (stroke) out.push(stroke)
			}
			continue
		}
		const key = "key" in item ? item.key : item
		if (typeof key === "string") {
			const stroke = parseStroke(key)
			if (stroke) out.push(stroke)
			continue
		}
		const { name, ctrl, shift, meta, super: sup } = key
		out.push({ name, ...(ctrl && { ctrl }), ...(shift && { shift }), ...(meta && { meta }), ...(sup && { super: sup }) })
	}
	return out
}

export type ComposerKeybindConfig = {
	"input.submit"?: TuiKeybind.BindingValueSchema
	"input.newline"?: TuiKeybind.BindingValueSchema
}

/** Textarea `keyBindings` for the composer; defaults = vendored config defaults. */
export function composerKeyBindings(config: ComposerKeybindConfig = {}): ComposerKeyBinding[] {
	const submit = config["input.submit"] ?? TuiKeybind.defaultValue("input.submit")
	const newline = config["input.newline"] ?? TuiKeybind.defaultValue("input.newline")
	const out: ComposerKeyBinding[] = []
	const push = (strokes: Stroke[], action: ComposerAction) => {
		for (const stroke of strokes) {
			out.push({ ...stroke, action })
			if (stroke.name === "return") out.push({ ...stroke, name: "kpenter", action })
		}
	}
	push(strokesOf(submit), "submit")
	push(strokesOf(newline), "newline")
	return out
}
