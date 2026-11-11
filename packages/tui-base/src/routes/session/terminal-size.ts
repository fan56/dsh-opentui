/**
 * Shared terminal-size accessor for the session page tree.
 *
 * `useTerminalDimensions()` from @opentui/solid registers ONE
 * `renderer.on("resize", …)` listener per mounted component. The session page
 * mounts ~10 such components, which crossed Node's default 10-listener cap and
 * printed `MaxListenersExceededWarning: 11 resize listeners added to
 * [CliRenderer]` on every boot. This module keeps ONE listener per renderer
 * (reference-counted) and hands every component the same reactive signal.
 *
 * Components outside the session tree keep using the vendored hook; anything
 * mounted inside the page should call `useTerminalSize()` instead.
 */
import { createSignal, onCleanup, onMount, type Accessor } from "solid-js"
import { useRenderer } from "@opentui/solid"

export interface TerminalSize {
	width: number
	height: number
}

interface Entry {
	size: Accessor<TerminalSize>
	setSize: (size: TerminalSize) => void
	onResize: (width: number, height: number) => void
	refs: number
	attached: boolean
}

const registry = new WeakMap<object, Entry>()

function entryFor(renderer: ReturnType<typeof useRenderer>): Entry {
	let entry = registry.get(renderer)
	if (!entry) {
		const [size, setSize] = createSignal<TerminalSize>({ width: renderer.width, height: renderer.height })
		const created: Entry = {
			size,
			setSize,
			onResize: (width, height) => setSize({ width, height }),
			refs: 0,
			attached: false,
		}
		registry.set(renderer, created)
		entry = created
	}
	return entry
}

/**
 * Reactive `{ width, height }` of the active renderer. One renderer listener
 * serves every mounted caller; the listener detaches when the last one
 * unmounts.
 */
export function useTerminalSize(): Accessor<TerminalSize> {
	const renderer = useRenderer()
	const entry = entryFor(renderer)
	onMount(() => {
		entry.refs++
		if (!entry.attached) {
			renderer.on("resize", entry.onResize)
			entry.attached = true
		}
	})
	onCleanup(() => {
		entry.refs = Math.max(0, entry.refs - 1)
		if (entry.refs === 0 && entry.attached) {
			renderer.off("resize", entry.onResize)
			entry.attached = false
		}
	})
	return entry.size
}
