# DRAFT upstream bug report — OpenTUI diff-paint corruption under streaming updates

> DRAFT ONLY — not filed. Repo check: https://github.com/anomalyco/opentui has
> issues ENABLED (`has_issues: true`, 155 open issues), so file as a normal
> issue. The 3-line forum version at the bottom is a fallback only.

---

## Title

Diff-paint corrupts the screen under sustained streaming updates: rows go missing / stale regions persist, SIGWINCH full re-render does not heal (@opentui/solid 0.7.0 and 0.8.2)

## Versions

| Package | Versions tested | Result |
|---|---|---|
| @opentui/core | 0.7.0, 0.8.2 | corrupt on both, identical signature |
| @opentui/solid | 0.7.0, 0.8.2 | corrupt on both, identical signature |
| native renderer | @opentui/core-darwin-arm64 (matched to core version) | — |
| runtime | bun 1.4.4 | — |
| OS | macOS, darwin-arm64 | — |
| terminals | Ghostty, and tmux 3.7c (capture-pane verified) | corrupt in both |

## Summary

Under a long-running turn that repaints continuously (~150 s, ~300 paint updates in the original app), the native renderer's diff paint leaves stale/broken regions on screen: transcript rows are painted over the fixed bottom input box (borders and placeholder), and rows go missing from the transcript region. The corruption persists after the turn ends. The process stays alive and keeps processing input correctly — only the screen is wrong. Sending SIGWINCH (full re-render) does NOT heal it. Destroying the renderer and mounting a brand-new CliRenderer + fresh solid tree does NOT heal it either (the fresh renderer's first stable paint is already torn — see the settle-swap test below). Upgrading to 0.8.2 shows the identical signature.

## Minimized engine-only repro (no app code, no network, deterministic)

~45-line @opentui/solid script: streams 250 numbered rows (one every 120 ms) into a full-height transcript region above a fixed 3-row bordered box. Run under tmux 120x34, poll `tmux capture-pane -p`.

```tsx
// repro.tsx — run with: bun repro.tsx   (cwd needs bunfig.toml: preload = ["@opentui/solid/preload"])
import { render } from "@opentui/solid"
import { createSignal, onMount, For } from "solid-js"

const TOTAL = Number(process.env.MINI_ROWS ?? 250)
const INTERVAL_MS = Number(process.env.MINI_INTERVAL_MS ?? 120)

const App = () => {
  const [rows, setRows] = createSignal<string[]>([])
  onMount(() => {
    let n = 0
    const t = setInterval(() => {
      n += 1
      setRows((prev) => [...prev, `${String(n).padStart(3, " ")} deterministic streaming payload row ${n}`])
      if (n >= TOTAL) {
        clearInterval(t)
        setTimeout(() => process.exit(0), 8000) // settle window, then quit
      }
    }, INTERVAL_MS)
  })
  return (
    <box style={{ flexDirection: "column", flexGrow: 1, width: "100%" }}>
      <box style={{ flexDirection: "column", flexGrow: 1, paddingTop: 1 }}>
        <For each={rows()}>{(r: string) => <text>{r}</text>}</For>
      </box>
      <box style={{ border: true, borderStyle: "rounded", borderColor: "yellow", width: "100%", height: 3 }}>
        <text fg="green">{"❯ input placeholder (fixed bottom box)"}</text>
      </box>
    </box>
  )
}

render(() => <App />)
```

Expected: the transcript region always shows a consecutive ascending run of rows ending at the newest row (e.g. `... 220 221 222`), and the bordered box stays intact at the bottom.

Actual (captured via `tmux capture-pane -p`, identical on 0.7.0 and 0.8.2): rows are missing from the transcript region — a stable frame mid-stream looks like this (rows 6, 17, 28 absent):

```
  1 deterministic streaming payload row 1
  2 deterministic streaming payload row 2
  3 deterministic streaming payload row 3
  4 deterministic streaming payload row 4
  5 deterministic streaming payload row 5
  7 deterministic streaming payload row 7
  8 deterministic streaming payload row 8
 ...
 16 deterministic streaming payload row 16
 18 deterministic streaming payload row 18
 ...
 27 deterministic streaming payload row 27
 29 deterministic streaming payload row 29
 30 deterministic streaming payload row 30
 31 deterministic streaming payload row 31
 32 deterministic streaming payload row 32
 33 deterministic streaming payload row 33
╭──────────────────────────────────────────────────────────────────────────────────────────────...─╮
│❯ input placeholder (fixed bottom box)                                                            │
╰──────────────────────────────────────────────────────────────────────────────────────────────...─╯
```

Measured: polling every 250 ms over one run, 114/125 sampled frames had row-number gaps (0.7.0); 113/125 on 0.8.2. Fully deterministic across runs and identical between the two versions.

SIGWINCH does not heal it. Mid-settle, `tmux resize-pane` (120→119→120) forces a full re-render; the frame right after is still corrupt — 29 gaps over the 34-row pane (0.7.0, 0.8.2 identical):

```
gap sequence after SIGWINCH: 5->13, 13->21, 21->30, 30->38, ..., 230->238, 238->246
```

Final frame after the stream ends (0.7.0 and 0.8.2 identical):

```
205 deterministic streaming payload row 205
213 deterministic streaming payload row 213
221 deterministic streaming payload row 221
230 deterministic streaming payload row 230
238 deterministic streaming payload row 238
246 deterministic streaming payload row 246
╭──────────────────────────────────────────────────────────────────────────────────────────────...─╮
│❯ input placeholder (fixed bottom box)                                                            │
╰──────────────────────────────────────────────────────────────────────────────────────────────...─╯
```

Note on scope: the minimized repro reliably reproduces the diff-paint corruption (stale/missing rows in the streaming region, persistent across SIGWINCH). The input-box-overwrite aspect of the app signature (next section) did not appear in the minimal layout — same engine failure mode, different collision surface. See the bottom-dock shapes below for how far that collision goes.

### Bottom-dock overwrite: shape sweep in the mini repro

The real client renders its transcript as a bottom-anchored window (`justifyContent: "flex-end"`, padding on all sides) of per-item nested blocks with a spacer row per item, where the LAST item mutates in place while streaming, above a taller fixed dock (input box + dim echo + hint strip + status line). Extending the mini repro toward that shape reproduces dock damage that the original flat layout never showed (250-row equivalent feed, 60 ms/line, tmux 120x34, 0.7.0):

- **Rich per-item shape** (flex-end transcript, per-item blocks + spacers, mutating tail item, 6-row fixed dock): the dock rows are wiped or torn in 73/78 polled frames. The damage lands on the rows around the input box: the hint strip below the box is erased, transcript rows paint right up to the border, and the status line below the box comes back interleaved — two paint generations merged into one line:
  ```
  ╭──────────────────────────────────────────────────────────────────────────────────────────────...──╮
  │❯ input placeholder (fixed bottom dock)                                                             │
  ╰──────────────────────────────────────────────────────────────────────────────────────────────...──╯
   ● last request echo (dim)
  ─emodelm─adsh ───────────────────────────────────── 12:00:00
  ```
  (`─ model ─ dsh ─` with the characters of two frames interleaved; the hint line between echo and status is gone entirely.)
- **Same shape with `<markdown>` finalized blocks**: additionally reproduces the app's interleaved-character signature on transcript rows — two rows merged into one line, 72/77 frames:
  ```
   10ddeterministicsstreamingppayloadlline710
   16ddeterministicsstreamingppayloadlline816
  ```
  (rows 7+10 and 8+16 painted into single lines, characters of both generations interleaved — same failure class as the app capture `The barometer·ishfalling,─soCrainCis coming`.)
- **Flattened plain-text line window** (the scrolled-back rendering path, stable 28-row window): no dock damage at all (0/78 frames), and much weaker transcript corruption (17/78 corrupt frames vs 74/78 rich) — a stable flat row window does not collide with the dock.

So the row-gap corruption needs only a streaming text feed, but the bottom-region collision needs the richer layout: bottom-anchored per-item blocks whose tail item mutates in place. What the mini repro still does NOT produce is the app's strongest form — payload rows painted INSIDE the input box and digits jammed into the border glyphs; the border lines themselves stayed intact in every mini-repro frame, with the damage landing on the dock text around the box. That final form remains quoted from the full app only (next section).

## Full-app signature (where this was found)

A terminal chat app built on @opentui/solid. During one long streaming turn (~150 s, ~300 paint updates), the bottom input-box region gets overwritten by transcript rows — numbered reply lines painted into the box, digits jammed into border glyphs, interleaved characters (two frames mixed in one line). Verbatim captures (`tmux capture-pane -p`, 120x34, tmux 3.7c):

During the turn (0.8.2):

```
╭30.─A─light─shower─passed─through─the─town.───────────────────────────────────────────────────────────────────────────╮
╰31. The barometer·ishfalling,─soCrainCis coming.──────────────────────────────────────────────────────────────────────╯
 32.tDustestorms/sweptracrossetheadesert./help commands · ctrl+c quit
```

299 torn frames were logged polling every 500 ms over that single turn. The corruption persists after the turn ends (same frame captured post-turn). Interleaved-character frames from the same app on 0.7.0:

```
╰31. The puddles frozeeover duringttheCnight.──────────────────────────────────────────────────────────────────────────╯
●3Writewacnumberedelistsofa60dshortoEnglishesentencesdabou...ather.iPlain text only, no markdown, one sentence per line.
```

## Why this is engine-level, not app-level

1. Engine-only repro: the corruption reproduces with zero app code — just @opentui/solid + a signal appending rows to a list of `<text>` nodes (script above). No network, no LLM, deterministic text feed.
2. Input path is healthy while the screen is corrupt. An env-gated per-key trace in the app logs every key event and every editor `contentChange` while the pane capture is torn. While the corruption was on screen, keystrokes were received and processed normally:
   ```
   {"t":...,"src":"key","name":"q","seq":"q","ctrl":false,"shift":false,"meta":false}
   {"t":...,"src":"key.pass","by":"editor","name":"q","row":0}
   {"t":...,"src":"contentChange","len":1}
   ```
   The pane kept showing the same torn frame through these events — model state advances, paint does not. Not a paste/key-handling bug.
3. SIGWINCH (full re-render) does not heal: in the minimized repro a forced resize re-render still produces a corrupt frame (gap sequence quoted above); in the app the torn bottom region survived a SIGWINCH.
4. Version-independent: 0.7.0 and 0.8.2 produce byte-identical corruption patterns in the minimized repro (same first-corrupt frame, same post-SIGWINCH gap sequence).
5. Renderer recreation does not heal (settle-swap test). Rows were moved into a module-level store that survives tree/renderer teardown. Renderer #1 was destroyed and a brand-new CliRenderer + fresh solid tree was mounted in the same process — deliberately ~5 s AFTER the stream had fully settled, so renderer #2's first paint laid out the complete final row list from scratch: no mid-update race, no inherited diff queue. Its first stable paint was already torn — the same corruption family as the post-SIGWINCH stride-8 gaps (transcript painted at ~1-in-8 row stride) — and it was never corrected: all 220 rows were in the fresh tree (31-row viewport should show the newest rows ending at 220; instead the pane shows the stride pattern through 217, with 218–220 missing), 38 of 39 post-swap polls carried the identical gap signature (the only clean poll caught the blank repaint between the two renderers), and the first stable post-swap frame equals the final frame ~10 s later:
   ```
     4 deterministic streaming payload row 4
    11 deterministic streaming payload row 11
    19 deterministic streaming payload row 19
    26 deterministic streaming payload row 26
    33 deterministic streaming payload row 33
    41 deterministic streaming payload row 41
      ...
   187 deterministic streaming payload row 187
   195 deterministic streaming payload row 195
   202 deterministic streaming payload row 202
   209 deterministic streaming payload row 209
   217 deterministic streaming payload row 217
   ╭──────────────────────────────────────────────────────────────────────...──╮
   │❯ input placeholder (fixed bottom box)                                     │
   ╰──────────────────────────────────────────────────────────────────────...──╯
   ```
   (All 220 rows are in the fresh tree; 31-row viewport; rows 218–220 never appear, and since the stream was settled there were no pending updates — the renderer simply never corrects the tear.) Renderer #1's frame buffer was destroyed before renderer #2 ever painted, so the corruption re-materializes in a fresh renderer on its very first full paint — the defect lives in the content model / process-global native renderer state, not in one renderer instance's lifecycle.

## Workaround status

None found. Upgrade to 0.8.2 confirmed NOT a fix (verified in the full app: identical tear signature, 299 torn frames in one turn, torn after the turn; and in the minimized repro: 113/125 corrupt frames on 0.8.2 vs 114/125 on 0.7.0). `renderer.suspend()` / `resume()` (park the renderer for the turn, repaint once at the end) is NOT a workaround either — falsified in-app: suspending/resuming around the turn freezes the client, the screen stops advancing. Full renderer recreation is not a workaround (settle-swap test above: fresh renderer repaints the tear as its first stable output). Reducing update rate and remounting the streaming region were not systematically explored; process restart is the only reliable recovery observed.

---

## Fallback: 3-line forum-post version (if filing as discussion instead)

Diff-paint corruption in @opentui/core native renderer (0.7.0 AND 0.8.2, darwin-arm64, bun 1.4.4): under sustained streaming updates a ~45-line engine-only @opentui/solid repro (250 rows streamed above a fixed bordered box) deterministically leaves stale/missing rows on screen, 114/125 sampled frames corrupt. Screen-only damage — input keeps processing (trace-verified), SIGWINCH full re-render does not heal. In a real chat app the same bug paints transcript rows over the input box (299 torn frames in one ~150 s turn); happy to share the repro script and captures.
