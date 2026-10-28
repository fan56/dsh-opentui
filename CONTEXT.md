# dsh-opentui — glossary

The controlled vocabulary of this repo. Keep `CONTEXT.md` a glossary only;
decisions live in `docs/adr/`.

## Runtime

The Solid host plus plugin mount points plus host-seam bridging — the
"architecture" deliverable. Owns the OpenTUI renderer lifecycle, the
surface service, and stdout capture. Package: `@dsh-opentui/runtime`.

## Kit

The prewritten component library (theme tokens, i18n seam, status bar,
panels, transcript, editors). Shared by the Shell and by plugins that take
the layer-1 (Solid component) path. Package: `@dsh-opentui/kit`.

## Shell

The minimal TUI this repo ships to prove the architecture runs —
transcript, input line, status bar. Deliberately small; it is a consumer
of Runtime + Kit, not a container for features. Package:
`@dsh-opentui/shell`.

## Starter

The copyable template for new plugins (`starter/`): consumes the surface
protocol with zero build step, degrades headless when no surface service
exists. Doubles as the integration-test fixture.

## Adaptation

The act of porting an existing dsh plugin (from the tui-pi file-seam era)
onto this architecture: headless logic is reused, the UI layer is
re-expressed as surface declarations or Solid components. Old widget
`.lines` / overlay-manifest formats are NOT carried over (ADR-002).
