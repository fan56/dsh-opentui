# dsh-opentui — glossary

The controlled vocabulary of this repo. Keep `CONTEXT.md` a glossary only;
decisions live in `docs/adr/`.

## Runtime

The Solid host plus plugin mount points plus host-seam bridging — the
"architecture" deliverable. Owns the OpenTUI renderer lifecycle, the
surface service, and stdout capture. Package: `@dsh-opentui/runtime`.

## Shell

The minimal TUI this repo ships to prove the architecture runs —
transcript, input line, status bar. Deliberately small; it is a consumer
of Runtime, not a container for features. Package:
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

## Tui base

The vendored, dependency-pruned @opencode/tui snapshot (packages/tui-base)
that renders the UI — the base layer the view is rebuilt on (ADR-006).
_Avoid_: library fork (vendored snapshot, not a fork), engine (the engine is
OpenTUI underneath).

## Custom layer

dsh-specific panels and wiring built on the tui base: powerline, dock
widgets, approval/ask surfaces. _Avoid_: theme (theme is base-provided).

## Session layer

The engine-agnostic Remote session facade (host-session /
remote-host-session surface). Unaffected by view-layer swaps. _Avoid_: host
(the dsh host is the process it connects to).

## Test tiers

The repo's four-tier test split — unit, ft, ui, e2e — selected and run by
the tier runner. A test's tier is decided by its filename and imports, not
by directory. _Avoid_: unit/integration/e2e generics when naming the tiers
(the repo names are unit/ft/ui/e2e).

## ft

The tier that runs against a real renderer: tests importing
`@opentui/core/testing` (`testRender`/`createTestRenderer`). _Avoid_:
calling it "unit tests with rendering" (if it renders, it is ft).

## False green

A test that passes without exercising the guarded behavior — it looks green
while the protection it claims to provide does not exist. _Avoid_: flaky
(a false green is consistently wrong, not intermittently failing).

## Canary test

A test that fails when the harness itself stops exercising the real runtime
— it guards against the fixture layer silently bypassing real code.
_Avoid_: smoke test (a canary guards the harness, not the happy path).

## Real-client gate

The verification lane that boots the actual terminal client on a real
machine (the self-hosted `real-client` job), as opposed to hosted CI where
the client connection is stubbed. _Avoid_: e2e (the tiers' e2e is a
separate container/local-flow lane).
