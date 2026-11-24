# ADR-0009: Server lifecycle redesign — deterministic singleton host, refcounted shutdown

Date: 2026-11-17
Status: Accepted
Update (2026-11-24): Historical only — the HTTP host is retired; decision 7's `--force`/`--yes` pairing requirement and SIGTERM → grace → SIGKILL shutdown sequence no longer apply to the in-process-only build.

## Context

Measured and audited in `DESIGN-redesign.md`:

- Cold start t0 → input median 4.54s, of which 3.41s (75%) is Host service
  bootstrap; opentui first frame is ~48ms. Warm attach is 892ms (~5.1x).
- 26 residual Host services were found in the field (each under a temp
  DSH_HOME, oldest ~3 days, each holding 58–61 EST connections). Root cause:
  the idle-5s timer, client exit not triggering shutdown, and connection
  leaks keeping the process "non-idle".
- Multi-client sharing of one Host service is already supported by the host
  core (second client adopts/joins, refcount +1, per-client `session/create`,
  host groups workspaces by directory). No host-core change is needed.
- Therefore redo only the launcher/client side: singleton discovery,
  lifecycle, startup progress, port derivation and registry. Config
  isolation (settings/tools/skills/model by cwd) is a phase-2 host plugin.

## Decision

1. **Reuse the host core; do not change it.** All work is launcher/client-side
   plus a phase-2 host plugin in the `opentui` profile. No new argv flag:
   dsh 0.18.4+ exits 2 on unknown flags, so the server is marked only by env
   `DSH_OPENTUI_SERVER=1`.

2. **Singleton keyed by `(DSH_HOME, profile)`**, not a global singleton.
   `DSH_HOME = env.DSH_HOME || ~/.dsh`; profile is fixed `opentui`.

3. **Deterministic port from the home path**: `base + hash(home, profile) % N`.
   Probe for conflict, then pin the chosen port into the registry so later
   launches reuse it.

4. **New registry schema** at `<DSH_HOME>/opentui-host.<profile>.json`:
   `version` (2), `profile`, `home`, `pid`, `port`,
   `phase` (`claim|booting|ready|stopping`), `startedAt`, `updatedAt`,
   `authority`, `clients` (`[{ id, pid, lastSeen }]`). Atomic write via temp
   file + `rename`; claim via `link(2)`/`O_EXCL`. First run of the new version
   cleans up old-schema registries safely (see decision 8).

5. **Launcher startup progress + 5m timeout.** While booting, render
   `phase(spawn → booting → ready) + elapsed` in the terminal, refreshed
   every 100–200ms, before the client enters the alternate screen. Readiness
   needs three signals: registry `phase=ready` and `port>0`, TCP connect,
   and `GET /` with the user's cookie. A 5-minute timeout identifies and
   kills only this spawn's Host service, clears the registry, reports the
   error and the log path, and retries from a fresh claim on attach failure.

6. **Lifecycle: refcount + heartbeat + last-one grace.** On attach,
   `clients+1` (atomic/file-locked write) and a heartbeat every 3s updating
   `lastSeen`; a heartbeat older than the 15s TTL marks the client dead and
   removes it. On normal exit, `clients-1`; when it reaches zero, after a
   2s grace the last exiting client sends a graceful shutdown (SIGTERM, so
   the host flushes/persists) and clears the registry.
   `DSH_OPENTUI_HOST_IDLE_MS` is retained but its meaning becomes "last-one
   grace override" (default 2000ms); `0` = resident (never auto-close, for
   background plugins). No more "5s idle → kill".

7. **`--force` requires `--yes` when multiple clients are online.** Act only
   on the Host service recorded in the registry and confirmed by decision 8.
   If other live clients exist (refcount > 0 or fresh heartbeat), `--force`
   must be paired with `--yes` or it refuses and prints "will disconnect N
   clients". With `--force --yes`: graceful stop (SIGTERM → grace → SIGKILL),
   clear registry, re-run the startup sequence.

8. **Process identification — three evidences, never a bare `dsh` match.**
   Only act on a process satisfying all three: (1) the `pid` in the registry;
   (2) `ps` cmdline containing `--profile opentui` and no other profile;
   (3) env `DSH_OPENTUI_SERVER=1` (via `ps eww` or the registry record).
   Never guess by the "dsh" substring or by port; never touch tui/web/other
   profiles or another user's dsh. `GET /` health checks carry the user's
   cookie/authority so we cannot attach to someone else's host.

9. **Config isolation via an opentui-profile host plugin, in two phases.**
   Phase 1 (this repo): decisions 2–8 on the client/launcher side. Phase 2
   (host plugin in the `opentui` profile): read `<workspace>/.dsh/config.yml`
   extended to settings/tools/skills/model and apply it per cwd to the
   session's `agentOptions`/`setup`; override chain cwd > home > profile,
   with sessions/history isolated by cwd. The client cannot inject
   settings/tools/skills through `session/create` (`typert.host.js:302-306`,
   `commands.ts:120-158`), hence the host plugin.

This amends ADR-0005 decisions 5 and 4 (修订 ADR-0005 决策 5/4): decision 5's
idle-5s lifecycle is replaced by refcount + last-one 2s grace graceful
shutdown; decision 4's workspace-local config (theme + model only) is
extended to settings/tools/skills/model in phase 2. It also adds startup
progress, deterministic porting, the new registry schema, `--force`, and
the decision-8 process-identification rule.

### Amendment (2026-11-17)

Phase 2 is deferred, not scheduled. A follow-up audit of the host core and
the client corrected the scope assumed in decision 9; this amendment
supersedes the phase-2 description there and in the ADR-0005 note above.

Scope correction — three of the four keys already resolve per session cwd:

- Skills are already per-cwd: the host-core `dsh-skill-filesystem` service
  exposes `roots(cwd)`, scanning `<projectRoot>/.dsh/skills` and
  `<projectRoot>/.agents/skills` and merging `$DSH_HOME/skills`. cwd flows
  from `session/create.cwd` through the session header to
  `workingDirectory.ensure(agent)`, and the cache is keyed by cwd.
- AGENTS.md is already per-cwd: the host-core `dsh-agent-instructions`
  service uses `workingDirectory.ensure(agent)` → `findProjectRoot(cwd)` to
  collect instructions directory by directory.
- Theme/model are already per-client-cwd: the client workspace-config layer
  ("the host has no workspace config layer (deliberate); this is a purely
  client-side mechanism") carries only theme/themeMode/model.

Only settings and tools remain profile/home scoped and fixed at boot:
`composeProfile()` in profile-boot assembles the whole Cordis config tree
once when the host boots, and the settings package has no cwd concept. The
`session/create` schema exposes only `workspaceId`, `cwd`, `sessionId`,
`agentPreset`, so it cannot inject settings/tools/skills/model.

The real phase-2 scope therefore narrows to settings/tools (plus optional
skills enable/disable). The only viable injection point is host-internal
`agentOptions`/`setup` on `AgentRegistry.create`; the wire protocol does not
carry these keys, so this repo cannot implement it without a host-core
change.

Workaround that works today: give each project its own `DSH_HOME`. The
singleton is already sharded by `(DSH_HOME, profile)`, so this needs no code.
If a need arises in the future for different projects under the same
`DSH_HOME` to use different tool sets or settings, revisit phase 2 with the
narrowed scope above.

## Considered Options

- Global singleton host — rejected: breaks per-DSH_HOME isolation.
- A new argv flag to mark the server process — rejected: dsh 0.18.4+ exits 2
  on unknown flags; use env `DSH_OPENTUI_SERVER=1` instead.
- Process lookup by "dsh" substring or by port — rejected: risks killing
  other dsh processes and other users' sessions.
- Keep the 5s idle timer — rejected: the direct cause of the 26 residual
  hosts; replace with explicit refcount and a last-one grace.

## Consequences

Positive:

- Subsequent launches collapse to warm-attach latency (~0.9s); the rare
  cold path shows visible progress.
- No host-core change; phase 1 is shippable from this repo.
- Refcount + heartbeats remove the idle-5s residual-host failure mode, and
  SIGTERM preserves host state on shutdown.

Negative / cost:

- The registry becomes stateful; concurrent cold starts need atomic claim
  plus adopt-wait, and every attach/exit writes state atomically.
- A 3s heartbeat and registry writes add overhead.
- Old-schema migration must stay conservative: leave unidentifiable hosts
  to stale cleanup rather than hard-kill them.
- The EST connection-leak root cause is still unconfirmed and needs real
  hardware verification (`DESIGN-redesign.md` §11).

References: `dst-bench-20261117/DESIGN-redesign.md`, ADR-0005.
