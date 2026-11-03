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

## Workspace

The directory a TUI is launched in (cwd, canonicalized), backed by the host's
workspace registry record — delete + re-add yields a new identity (host
semantics). Its isolation scope is workspace-local config only; sessions stay
host-managed. _Avoid_: project, repo (a workspace is a directory, not a VCS
concept).

## Workspace-local config

Theme and model preferences stored in `<workspace>/.dsh/`, overriding global
defaults. Credentials and plugin installs never live here — they would leak
into version control. _Avoid_: settings (host "settings" are profile/home
scoped and have no workspace layer).

## Profile

The host's plugin composition under `~/.dsh/profiles/<name>`. This product's
profile is fixed as `opentui`: the entry command boots/attaches it, and users
install plugins into it. _Avoid_: exposing profile names in entry commands.

## Session

A host-global durable conversation log (event-sourced, `~/.dsh/sessions/`). A
TUI mounts one session per entry, defaulting to new; older ones are reached
through /history. _Avoid_: thread, chat, workspace-scoped session (a session
is not scoped by workspace).

## Host service

The resident dsh process (profile `opentui`) owning the agent loop and the
plugin stack; TUIs attach to it as clients. _Avoid_: server, daemon.

## Render surface

This repo's plugin UI seam: surface declarations / Solid components rendered
by Runtime. _Avoid_: "surface" alone — the host uses that word for product
entry variants (see Product surface).

## Product surface

A dsh product entry variant — web, headless, sdk, acp (host vocabulary). Not
this repo's render surface.

## Client mode

Architecture where the TUI is a thin rendering client attaching to a resident
host service over the host's Remote connection protocol. Contrast: plugin
mode (TUI in-process inside the host, today's shape).
