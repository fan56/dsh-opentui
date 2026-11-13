/**
 * Solid props-contract pin (A4 real-machine regression, 2026-11-15).
 *
 * The v2-entry pickOne wiring originally passed `options: () => rows` — a
 * function-VALUED prop — into the vendored DialogSelect. Solid's props
 * resolve ACCESSOR properties (`get options() { … }`, the shape JSX
 * compilation produces) on read, but hand function-valued props through
 * untouched, so DialogSelect's `props.options.filter(...)` received the
 * function itself and the /model picker died on open with
 * `props.options.filter is not a function` — while every bare unit test
 * stayed green (they mock pickOne; DialogSelect never rendered).
 *
 * These tests pin the two semantics so the wiring cannot regress to the
 * function-prop shape unnoticed.
 */
import { describe, expect, test } from "bun:test"
import { createComponent, createRoot } from "solid-js"

describe("solid props: accessor vs function-valued prop", () => {
	test("function-valued prop is passed through UNTOUCHED (the regression shape)", () => {
		createRoot((dispose) => {
			let received: unknown
			const Comp = (props: { options: unknown }) => {
				received = props.options
				return ""
			}
			createComponent(Comp, { options: () => [{ title: "a" }] })
			expect(typeof received).toBe("function")
			expect(Array.isArray(received)).toBe(false)
			dispose()
		})
	})

	test("accessor prop resolves to the array (the JSX-compiled shape the vendored dialogs require)", () => {
		createRoot((dispose) => {
			let received: unknown
			const Comp = (props: { options: unknown }) => {
				received = props.options
				return ""
			}
			createComponent(Comp, {
				get options() {
					return [{ title: "a" }]
				},
			})
			expect(Array.isArray(received)).toBe(true)
			dispose()
		})
	})

	// NOTE: the accessor's LIVE reactivity (reorder-on-press) cannot be
	// pinned here — bun's bare-test run loads the solid-js SERVER build,
	// where computations never re-run (the known "bare tests idle the
	// reactive system" ledger). That half is covered by the tmux
	// real-machine capture in the A4 fix report.
})
