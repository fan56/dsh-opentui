/**
 * AutoScroll — thin wrapper over the native OpenTUI <scrollbox> intrinsic
 * that keeps its content pinned to the bottom while new children stream
 * in (chat transcripts, tails of logs). Layout (flexGrow / maxHeight)
 * rides in `style` like any other box; the scrolling behavior flags are
 * passed as DIRECT props — ScrollBoxOptions exposes stickyScroll/scrollY
 * as first-class options and @opentui/solid types them as top-level
 * props on <scrollbox>, so they must not go through style.
 */
import type { JSX } from "solid-js"

export function AutoScroll(props: { children: JSX.Element; maxHeight?: number; ref?: (el: any) => void; sticky?: boolean }): JSX.Element {
  return (
    <scrollbox stickyScroll={props.sticky ?? true} scrollY={true} style={{ flexGrow: 1, maxHeight: props.maxHeight }} ref={props.ref}>
      {props.children}
    </scrollbox>
  )
}
