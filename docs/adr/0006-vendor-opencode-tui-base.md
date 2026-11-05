# ADR-0006: Vendor @opencode/tui as the TUI base layer (view layer v2)

Date: 2026-11-05
Status: accepted

## Context

The current view layer stands on OpenTUI 0.7.0, whose native renderer
has a diff-paint corruption under sustained streaming updates: long
turns tear the bottom region (transcript rows painted over the fixed
input box, rows going missing), the corruption survives the turn and is
not healed by full re-render or renderer recreation. Five client-side
fix paths were falsified with evidence — see
docs/upstream-opentui-paint-bug-draft.md (deterministic engine-only
repro, tmux capture-pane verified).

On top of that engine we accumulated a 0.7.0-era workaround layer:
bumpSoon ref-replacement, rowEqual diffing, a hand-rolled line window.
That layer is debt — it exists only to dodge engine bugs, it consumes
the frames the engine drops, and it is the first thing every new
rendering change trips over.

Meanwhile opencode — the founding reference this repo has always
followed — runs the same engine clean on 0.8.1 with their component
shape. A spike confirmed it empirically: 191 frames captured under a
long streaming turn, 0 tears, using scrollbox stickyScroll +
stickyStart="bottom" + keyed rows + native markdown.

The decision root is the founding rationale itself: standing on
opencode's shoulders, not reinventing. They maintain a battle-tested
TUI component library (@opencode/tui, MIT) against the engine version
that actually works; maintaining our own parallel stack against a
broken one does not.

## Decision

Vendor @opencode/tui@2.2.5 source (commit 893e8dc, MIT) into
`packages/tui-base` as the base layer the view is rebuilt on. Six
settled decisions:

1. **Vendor with dependency pruning**: of the 10 workspace:*
   siblings @opencode/tui ships with, only the theme/ui/util subset
   comes along; engines are pinned — @opentui/*@0.8.1,
   solid-js@1.9.17.
2. **Scope**: the view layer is rebuilt on the tui base; the client
   session layer (src/client/*) is untouched — ADR-0005's client
   architecture is orthogonal to the view swap.
3. **Big-bang cutover at the usable-chain bar**: boot / input /
   streaming transcript / approval / ask + core commands (/help /new
   /model /quit /sessions) + default theme + powerline/status bar +
   the sweep subset green — one switch, no parallel-run period. The
   old view layer (kit + ShellHost stack) is deleted in the cutover
   commit; no escape tag — git history is the archaeology record.
4. **Plugin mode migrates along**: the profile solid pin patch
   (patchedDependencies, commit a28d77d) is rewritten to 1.9.17 at
   cutover; both host-coupled modes land on the same base.
5. **Vendor governance**: pinned commit + on-demand re-vendor. No
   semver tracking, no long-lived fork; re-vendoring is a deliberate,
   reviewable snapshot bump.
6. **Post-cutover fill order**: btw / subagent panel / todo /
   ask-block / history fork / search / multi-theme / i18n — the
   usable-chain bar ships first, the feature tail follows.

## Consequences

Positive:

- The tear / stall / workaround-debt class dies: engine 0.8.1 plus a
  shape proven by the spike (191 frames, 0 tears), and the
  bumpSoon / rowEqual / line-window workaround layer is deleted
  rather than maintained.
- Markdown rendering, scroll behavior, and theme infrastructure come
  from a maintained upstream consumer instead of hand-rolled
  equivalents.

Negative / cost:

- Vendor tax: a private vendored package — no semver contract, no
  npm upgrades; every upstream advance means a new snapshot bump with
  a diff review.
- Context pruning is the main uncertainty: opencode's components
  assume @opencode context providers (client/session/plugin/theme
  context); those seams must be re-implemented or stubbed for dsh,
  and the real cost is only measurable during the rebuild.
- Two solid-js versions coexist transiently (1.9.12 old stack /
  1.9.17 base) until cutover resolves it.

Risks: entanglement of opencode's data/client/plugin/theme context
layers — pruning may cut deeper than the theme/ui/util subset if
components reach into context we did not carry over.

## Open questions

None. All six decision points were settled during design review
(grilling) before this ADR was recorded.
