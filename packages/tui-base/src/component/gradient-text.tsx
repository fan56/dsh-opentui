/**
 * GradientAsciiText — per-CELL colored ASCII-font big text (skin contract §1
 * "欢迎页大字"). The engine's ASCIIFontRenderable color array maps to the
 * font's built-in color slots (`colors[segment.colorIndex]`), NOT per
 * character, so a horizontal identity-gradient wordmark must be self-drawn:
 * this Renderable renders the cfonts glyph grid cell by cell, sampling
 * `skin/identity.ts` at each cell's horizontal position.
 *
 * Static by design: no `animationFps` (the shared animation clock never
 * ticks it), it repaints only on mount and when text/font/mode change —
 * the caller re-picks the font on terminal resize (see GradientAsciiText).
 *
 * Layout mirrors the engine's `measureText` exactly (line-0 cell count per
 * letter, `letterspace_size` between letters), so the measured width used
 * for the fallback decision matches what is drawn.
 *
 * Usage:
 *   <GradientAsciiText text="DSH OPENTUI" mode="dark" maxWidth={() => cols} />
 * or the raw renderable (registered as `gradient_text`):
 *   <gradient_text text="…" font="block" mode="dark" />
 */
import {
	fonts,
	measureText,
	parseColor,
	Renderable,
	type ASCIIFontName,
	type OptimizedBuffer,
	type RenderableOptions,
	type RenderContext,
} from "@opentui/core"
import { extend, useTerminalDimensions } from "@opentui/solid"
import type { JSX } from "solid-js"
import { identityHexAt, type SkinColorMode } from "../skin/identity"

/**
 * Strip cfonts color-slot markup (`<c1>…</c1>`) from a raw font line —
 * per-cell coloring applies the identity gradient instead of the font slots.
 */
export function stripFontTags(line: string): string {
	return line.replace(/<\/?c\d+>/g, "")
}

/**
 * Font fallback rule (skin contract §1): keep the preferred big font while
 * its measured width fits `availableCols`, else fall back to `fallback`
 * (tiny). Pure and unit-testable.
 */
export function pickAsciiFont(
	text: string,
	availableCols: number,
	preferred: ASCIIFontName = "block",
	fallback: ASCIIFontName = "tiny",
): ASCIIFontName {
	if (measureText({ text, font: preferred }).width <= availableCols) return preferred
	return fallback
}

/** One laid-out letter: the tag-stripped glyph rows plus its column offset. */
interface GradientGlyph {
	lines: string[]
	offset: number
	width: number
}

export type GradientTextOptions = RenderableOptions<GradientTextRenderable> & {
	/** Plain text (uppercased like the engine's ASCIIFontRenderable). */
	text: string
	/** Built-in cfonts font; big wordmarks use "block" (fallback "tiny"). */
	font?: ASCIIFontName
	/** Which identity ramp to sample (skin/identity.ts). */
	mode?: SkinColorMode
}

export class GradientTextRenderable extends Renderable {
	private glyphRows: GradientGlyph[] = []
	private totalWidth = 0
	private totalHeight = 1
	private _text: string
	private _font: ASCIIFontName
	private _mode: SkinColorMode

	constructor(ctx: RenderContext, options: GradientTextOptions = {} as GradientTextOptions) {
		super(ctx, options)
		this._text = options.text ?? ""
		this._font = options.font ?? "block"
		this._mode = options.mode ?? "dark"
		this.setMeasureProvider(() => ({ width: this.totalWidth, height: this.totalHeight }))
		this.rebuild()
	}

	set text(value: string) {
		if (value === this._text) return
		this._text = value
		this.rebuild()
	}

	set font(value: ASCIIFontName) {
		if (value === this._font) return
		this._font = value
		this.rebuild()
	}

	set mode(value: SkinColorMode) {
		if (value === this._mode) return
		this._mode = value
		this.requestRender()
	}

	get text(): string {
		return this._text
	}

	get font(): ASCIIFontName {
		return this._font
	}

	get mode(): SkinColorMode {
		return this._mode
	}

	/**
	 * Lay out the glyph grid with the same rule as the engine's measureText:
	 * letter width = line-0 cell count, letterspace between letters, height =
	 * font.lines. Width/height changes go through the measure provider.
	 */
	private rebuild() {
		const fontDef = fonts[this._font]
		const text = this._text.toUpperCase()
		const glyphs: GradientGlyph[] = []
		let x = 0
		for (let i = 0; i < text.length; i++) {
			const charDef = fontDef.chars[text[i]!] ?? fontDef.chars[" "]
			const lines = (charDef ?? []).map(stripFontTags)
			const width = lines[0]?.length ?? 1
			glyphs.push({ lines, offset: x, width })
			x += width
			if (i < text.length - 1) x += fontDef.letterspace_size
		}
		this.glyphRows = glyphs
		this.totalWidth = x
		this.totalHeight = fontDef.lines
		this.invalidateIntrinsicSize()
		this.requestRender()
	}

	/** Identity color for the cell at absolute column `col` (center sampling). */
	private colorAt(col: number): ReturnType<typeof parseColor> {
		const t = this.totalWidth > 0 ? (col + 0.5) / this.totalWidth : 0
		return parseColor(identityHexAt(t, this._mode))
	}

	protected override renderSelf(buffer: OptimizedBuffer): void {
		if (!this.visible || this.isDestroyed || this.totalWidth <= 0) return
		const bg = parseColor("transparent")
		for (const glyph of this.glyphRows) {
			for (let line = 0; line < glyph.lines.length; line++) {
				const row = glyph.lines[line]!
				const y = this.screenY + line
				let col = glyph.offset
				for (const cell of row) {
					if (cell !== " ") buffer.drawText(cell, this.screenX + col, y, this.colorAt(col), bg)
					col += 1
				}
			}
		}
	}
}

extend({ gradient_text: GradientTextRenderable })

declare module "@opentui/solid" {
	interface OpenTUIComponents {
		gradient_text: typeof GradientTextRenderable
	}
}

/**
 * Solid wrapper: picks the font at mount and on every terminal resize
 * (block while the measured width fits `maxWidth`, else tiny) — the only
 * reactive inputs, so the big text stays static between resizes.
 */
export function GradientAsciiText(props: {
	text: string
	/** Color mode for the identity ramp; dark default. */
	mode?: SkinColorMode
	/** Available columns; defaults to terminal width minus the 1-col padding. */
	maxWidth?: () => number
}): JSX.Element {
	const dims = useTerminalDimensions()
	const available = () => props.maxWidth?.() ?? Math.max(1, dims().width - 2)
	const font = () => pickAsciiFont(props.text, available())
	return (
		<gradient_text
			text={props.text}
			font={font()}
			mode={props.mode ?? "dark"}
		/>
	)
}
