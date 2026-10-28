# ADR-0002: Two integration channels, no compatibility shim

Date: 2026-10-28
Status: accepted

## Context

dsh plugins today surface UI through ad-hoc file seams (widget `.lines`
files polled by tui-pi, overlay manifests dynamically imported). Forcing
every plugin onto a Solid build step would fight the existing
zero-build, zero-framework-coupling ecosystem.

## Decision

Two channels, both first-class:

1. **Layer 1 — in-process component contract**: Shell and plugins that
   pay the build cost write Solid components against Kit; the Runtime
   provides mount points and context injection.
2. **Layer 2 — declarative surface protocol**: the Runtime registers the
   `surface` cordis service; plugins `inject: ["surface"]` and receive a
   typed handle (`declare`/`retract`/`onEvent`). Protocol types are
   devDependency-only — zero runtime deps for consumers.

No compatibility shim for the old `.lines`/manifest formats: adaptation
means re-expressing the UI layer. `hasSurface(ctx)` is the degradation
probe; a missing service suspends the plugin silently (verified in M0),
never crashes the host.

## Consequences

- Existing plugins migrate at their own pace; tui-pi keeps running them.
- The protocol's primitive set (widget/panel/overlay, text parts) is
  intentionally minimal and grows only when an adaptation needs it.
- Layer-2 expressiveness is bounded by the protocol; when it pinches,
  the plugin graduates to layer 1.
