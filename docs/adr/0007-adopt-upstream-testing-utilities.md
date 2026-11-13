# ADR-0007: Adopt upstream @opentui/core testing utilities instead of a bespoke test harness

Date: 2026-11-14
Status: Accepted (2026-11-14)

## Context

On 2026-11-13 the round decided (research/README.md, settled item 1) to
include a self-built harness in the reuse scope, on the premise that the
upstream had no ready-made test facilities. That premise has been
overturned by a path-backed verdict (research/oldfox-reuse-verdict.md,
2026-11-14):

- This repo already pins `@opentui/core` 0.8.1, which ships a complete
  `./testing` facade — `createTestRenderer`, `mockInput`,
  `captureCharFrame`, `waitForVisualIdle`, `testRender`. 27 existing
  `ft` test files in this repo already run on it.
- opencode's TS test suite (version 0.8.4 on its side) is built on the
  same API family. A hands-on API diff against our 0.8.1 shows the gap
  is a single method (`externalOutputQueue`), which is not needed for
  the first-phase cases.

Building a bespoke harness layer on top of what is already installed
and already in use would re-wrap the upstream facade for no gain, and
rushing an upgrade to 0.8.4 would couple the test-work round to the
known upstream diff-paint bug timeline (reproduced on 0.7.0 / 0.8.2).

## Decision

Adopt a hybrid route:

1. **Base = the upstream `@opentui/core` 0.8.1 built-in `./testing`
   facade.** It is the harness substrate; no bespoke harness layer is
   wrapped around it in the first phase.
2. **On top of it, build only the repo-specific fixture layer** —
   the pieces this repo's surfaces need that the facade does not
   provide.
3. **Do not upgrade `@opentui` in the first phase.** Staying on 0.8.1
   keeps the pilot decoupled from the upstream rendering bug.

This supersedes the 2026-11-13 "self-built harness" premise recorded
in research/README.md.

## Consequences

- Test cases ported from opencode 0.8.4 (e.g. the scrollback-class
  cases) must be re-expressed as `captureCharFrame` assertions —
  opencode's frame predicates do not transfer 1:1.
- While the upstream diff-paint dropped-lines bug (reproduced on
  0.7.0 and 0.8.2) remains unfixed, avoid long-streaming frame
  assertions; short, settled frames via `waitForVisualIdle` are the
  safe pattern.
- The decision to upgrade to 0.8.4 is deferred. Trigger conditions:
  a first-phase case actually needs `externalOutputQueue`, or the
  upstream diff-paint fix is confirmed in 0.8.4.
