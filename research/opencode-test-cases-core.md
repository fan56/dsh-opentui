# opencode Non-UI Test Case Survey

Source: `~/Downloads/opencode-survey` (read-only reuse of a shared clone; shallow, single commit on `dev` line). Language distribution verified: **0 Go tests**; all tests are TypeScript using `bun:test` (`*.test.ts`). UI packages (`packages/tui`, `packages/app`, `packages/session-ui`, `packages/ui`, `packages/desktop`, `packages/gui-plugins`) are excluded here — see the sibling UI survey.

## Scope & file inventory (measured)

Non-UI packages surveyed, `*.test.ts` file counts and `it/test[.variant](` call counts (grep-verified):

| Package | Test files | Test functions | Content |
|---|---|---|---|
| packages/core | 322 | 3,299 | the agent core: session, bus, tools, permission, config, model, plugin, shell, pty, effect infra |
| packages/ai | 168 | 1,449 | LLM protocol layer: streaming, timeouts, providers, compaction |
| packages/cli | 57 | 271 | CLI commands, auth flows, service lifecycle, mini host |
| packages/server | 46 | 118 | HTTP server endpoints, SSE event feed, auth/cors, schema errors |
| packages/util | 21 | 67 | retry, abort, paths, timeouts, process signals |
| packages/schema | 18 | 85 | wire schemas, legacy/compatibility, event contracts |
| packages/http-recorder | 4 | 51 | cassette-based HTTP record/replay (the "fake LLM" infra) |
| packages/plugin | 4 | 27 | plugin host loading |
| packages/sdk | 11 | 37 | client SDK transports, instances lifecycle |
| packages/protocol | 5 | 15 | OpenAPI/event protocol stabilization |
| packages/patchmark | 4 | 23 | markdown/patch parsing, differential fuzzing |

**Total surveyed: ~660 files / ~5,442 test functions.** Style is overwhelmingly flat `it.effect("...", ...)` inside `describe` blocks (bun test runner); almost no table-driven loops except fuzz/oracle suites (shell-scan/generated, patchmark fuzz).

The single most important infrastructure fact: tests are **Effect-based DI graphs**. `packages/core/test/lib/effect.ts` builds a `testEffect(layer)` harness that (a) runs each test inside the declared service Layer, (b) replaces `fetch` with a **network-refusing client** that records and fails the test on any non-loopback request ("test attempted network request: ..."), and (c) merges in Effect `TestClock` / `TestConsole`. Dependencies are swapped per test with `LayerNode.replace(SomeService.node.replace(mock))`. This is the injection mechanism that makes all the domains below testable offline.

```ts
// packages/core/test/lib/effect.ts (abridged)
const loopback = new Set(["127.0.0.1", "localhost", "[::1]"])
export const refuseNetwork = (violations: string[]): typeof fetch =>
  Object.assign((input, init) => {
    if (loopback.has(new URL(url).hostname)) return fetch(input, init)
    violations.push(`test attempted network request: ${method} ${url} — provide an explicit HttpClient`)
    return Promise.reject(new Error(message))
  }, ...)
```

## Case catalog by domain

### 1. Session lifecycle & persistence

Files: `packages/core/test/session-create.test.ts` (20 cases), `session-remove`, `session-archive`, `session-move`, `session-list`, `session-owned`, `server/test/session-create|update|import|instances`.

Setup: a full Effect app graph (`AppNodeBuilder.build(LayerNode.group([Database.node, Bus.node, SessionProjector.node, SessionStore.node, Session.node, ...]))`) over an in-memory/workerd SQLite (`sqliteLayer`, `makeDurableObjectStorage` fixture), temp dirs via `tmpdirScoped`, `initGit` fixture for project repos, `offlineModels` to disable models.dev refresh. Actions call the session service directly and assert DB rows plus projected listings.

Cases: persists missing title until generated; ID-retry returns the original session (idempotency); trailing-slash directory normalization; child creation rejects nonexistent parent; fork replays durable fork event into copied rows; "does not copy a running assistant into a fork"; "copies only settled shell messages into forks"; pagination by "latest prompt" ordering; remove cascades to children and "removes unloaded sessions ... without initializing an instance"; archive is one durable event each.

```ts
// packages/core/test/session-create.test.ts
it.effect("rejects child creation when the parent does not exist", ...)
it.effect("does not copy a running assistant into a fork", ...)
// packages/core/test/session-store.test.ts
it.effect("pages messages by durable sequence, not timestamp or ID, and scopes cursor lookup", ...)
it.effect("lastAssistantAfter returns undefined without a qualifying assistant after the boundary", ...)
```

Assertion style: expected values built by a helper library `test/lib/session-message.ts` (`Expected.*`), compared against DB rows (drizzle `and/asc/eq`) and service returns. Boundary values: 20+ incomplete assistant messages paged past, empty-session fork rejection, two-item exclusive pages in either direction.

### 2. Event bus / event stream / replay

Files: `packages/core/test/bus.test.ts` (~60 cases), `bus-session-routing`, `bus-unpersisted`, `event-logger`, `state-replay`; server side `packages/server/test/event-feed.test.ts`, `sse-failure.test.ts`.

Setup: Bus node with `Bus.configured({ persist: true })` over the SQLite event table; subscriber fibers; `Deferred` primitives to stall/pause subscribers mid-flight.

Cases (this is opencode's densest correctness area): atomic durable batches ("rolls back every batch event when a projector fails"), per-aggregate sequence increment, **replay handoff races** ("catches durable aggregate events published during replay handoff", "retains a durable wake committed while historical replay is paused", "coalesces durable aggregate wakes while draining"), replay owner fencing/claims, stale-replay rejection ("rejects divergent stale replay without publishing it"), ID reuse at another aggregate position, observer defect isolation after commit, live-only events excluded from durable streams, synced-marker semantics at the replay-to-live boundary. Routing: fork events routed through parent before child exists; deletion routed before projector removes ownership; batch that moves and deletes in one transaction.

```ts
// packages/core/test/bus.test.ts
it.effect("rolls back the durable event and projector when the local commit fails", ...)
it.effect("catches durable aggregate events published during replay handoff", ...)
it.effect("rejects divergent stale replay without publishing it", ...)
// packages/server/test/event-feed.test.ts
it.effect("fails only the subscriber that exceeds its lag capacity", ...)
it.effect("disconnects current subscribers after an encoding failure and continues for later subscribers", ...)
// packages/server/test/sse-failure.test.ts
it.live("encodes a mid-stream session log failure as the reserved SSE failure event", ...)
```

Assertions: event sequences received by subscribers (order-sensitive arrays), DB durable event rows/seq, error types. SSE failure uses a *reserved failure event* so a mid-stream defect is observable by clients — directly relevant to a protocol client like dsh-opentui.

### 3. Message/event streaming generation

Files: `packages/core/test/session-generate.test.ts`, `session-runner.test.ts`, `session-runner-message`, `session-runner-tool-events`, `session-step`, `session-wait`, `session-usage`, `session-stats`; `packages/ai/test/generation.test.ts`, `error-partial.test.ts`, `http-timeout.test.ts`.

Setup: fake LLM via one of two techniques — (a) **recorded HTTP cassette**: `HttpRecorder.layerFetch("...")` replays recorded provider responses through the real HTTP transport path (`session-runner-recorded.test.ts` boots the *entire* app node against it); (b) **injected `LLMClient` layer**: `LayerNodePlatform.llmClient.replace(llmClient)` with a scripted client exposing `wait(n)` / `Deferred` gates to interleave steps.

Cases: "generates from fresh settled Session context and records only its usage" (events `Step.Started`, `Text.Started`, `InboxEnqueued/Delivered` published by hand to pre-seed durable state, then asserted the runner builds context from settled rows, not live state); "regenerates a failed partial answer without mutating Session history" (`llm.wait(1)` to hold the stream, then assert history untouched); tool-event snapshots on interruption ("interrupted progress metadata remains in the terminal failure snapshot", "interrupted subagent failures expose their existing child session to the model", "interrupted non-subagent failures do not expose their progress session IDs"); media base64 serialized exactly once ("serialized.split(base64)).toHaveLength(2)" — count occurrences, not equality).

```ts
// packages/core/test/session-runner-tool-events.test.ts
test("local tool success serializes media base64 once through canonical content", async () => {
  ...
  expect(serialized.split(base64)).toHaveLength(2)
})
it("interrupted progress metadata remains in the terminal failure snapshot", ...)
```

### 4. Tool calls & results

Files: `packages/core/test/tool-*.test.ts` (25+ files: edit, write, read, patch, shell, webfetch, todo, question, subagent, registry, schema, output...), `server/test/message.test.ts`.

Setup: `tmpdirScoped` temp projects, `FileMutation` service, real filesystem; permission service injected with scripted rules (`test/lib/permission.ts`); tool-executed effect asserts on returned tool result *and* on-disk file state.

Cases (tool-edit is exemplary, 22 cases): register/replace once; rejects no-op/empty/missing/ambiguous replacements with pointed errors ("points a missed oldString at the closest lines, or at newString already applied"); external path approval gating ("does not write when external_directory or edit approval is denied", "denied edit does not disclose whether oldString matches" — an information-leak negative test); line-ending/BOM/Unicode tolerance (CRLF, mixed endings, typography normalization only after exact match fails); "fails instead of reporting success when the edit leaves the file unchanged"; concurrent transaction serialization. tool-patch: add/update/delete hunks, file↔directory replacement, case-only renames, symlink moves, deleted-line counting with/without trailing newline. tool-execute: progress throttling ("sends at most one progress update per 100 ms with the latest rows", "interrupted execute sends its latest progress rows before it settles").

```ts
// packages/core/test/tool-edit.test.ts
it.live("does not write when external_directory or edit approval is denied", ...)
it.live("denied edit does not disclose whether oldString matches", ...)
it.live("serializes concurrent edit transactions", ...)
// packages/core/test/tool-execute.test.ts
it.effect("execute sends at most one progress update per 100 ms with the latest rows", ...)
```

### 5. Permission / approval

Files: `packages/core/test/permission.test.ts` (16 cases), `server/test/permission-saved.test.ts`, `plugin/permission-assert`, `session-model-request-hooks`.

Setup: Permission service node with agent/config rule layers; saved-approval store in DB; explicit rule fixtures.

Cases: rule precedence — "merges session rules after agent rules and before saved approvals", "uses saved bash approvals while preserving configured deny precedence" (deny always wins); ask flow — "resolves an asked permission once", "defects when an asked permission is declined" (decline is an error path, not a false); rule evaluation without prompting ("allows and denies from explicit rules without asking", "checks for a deny without asking"); metadata JSON encodability ("drops undefined metadata values so pending requests encode as JSON"); saved approval CRUD round-trips and edit enforcement.

```ts
// packages/core/test/permission.test.ts
it.effect("merges session rules after agent rules and before saved approvals", ...)
it.effect("uses saved bash approvals while preserving configured deny precedence", ...)
it.effect("defects when an asked permission is declined", ...)
```

### 6. Config load / merge / validate / watch

Files: `packages/core/test/config/config.test.ts` (~30 cases), `config/normalization`, `config/discovery`, `config/reload`, `config/watch`, `config/policy`, `config/model`, `config/snapshot`; `packages/schema/test/config.test.ts`; `packages/cli/test/config.test.ts`.

Setup: layered temp directory trees (global/project/system/integration config files, JSON+JSONC), file watchers enabled, `it.live` (real clock) for watcher cases, symlinked roots, wellknown-auth stubs.

Cases: priority layering ("loads opencode JSON and JSONC files from lowest to highest priority", "loads system configuration at highest priority"); discovery edge cases ("excludes home-level claude and agents directories when global is disabled", "deduplicates global ecosystem directories found during upward discovery", "does not recursively watch ecosystem config roots"); reload on change ("keeps watching a deleted config file so recreating it reloads", "reloads file substitutions when their source changes"); resilience ("tolerates unavailable authenticated wellknown config and reloads it later", "keeps the last resolved wellknown config across failures and restarts while a credential exists", "ignores an invalid file while loading valid config values" — invalid file does not poison valid ones); env substitution; legacy/v1 migration ("migrates v1 configuration when a v1-only key is present", "does not load legacy config.json files"); schema tests assert round-trip encode/decode and rejection of unsupported spellings ("round-trips tool.use and rejects unsupported action spellings", "omits undefined optional properties while encoding").

```ts
// packages/core/test/config/config.test.ts
it.live("keeps watching a deleted config file so recreating it reloads", ...)
it.live("ignores an invalid file while loading valid config values", ...)
it.live("keeps the last resolved wellknown config across failures and restarts while a credential exists", ...)
```

### 7. Provider / model selection & credentials

Files: `packages/core/test/model-resolver.test.ts` (35+), `model.test.ts`, `models.test.ts`, `model-free`, `provider.test.ts`, `credential.test.ts`, `credential-refresh`; 28 `plugin/provider-*.test.ts` files per vendor.

Setup: `offlineModels` fixture (`ModelsDev.configured({ fetch: false })`) — catalog served offline; env-var injection; injected package loaders; credential store in DB.

Cases: request-shaping per provider (Azure deployment IDs, Bedrock region endpoints, OpenAI API modelID vs catalog ID, variant overlays for reasoning effort); credential precedence ("prefers stored credentials over configured auth"); secret hygiene — **negative assertions on payload contents**: "keeps catalog apiKey credentials out of provider JSON", "does not project API key metadata into settings or the request body", "treats an empty configured API key as omitted", "rejects unresolved variables in constructed provider routes"; fallback routing ("never loads the AI SDK for packages with native implementations").

```ts
// packages/core/test/model-resolver.test.ts
it.effect("keeps catalog apiKey credentials out of provider JSON", ...)
it.effect("treats an empty configured API key as omitted", ...)
it.effect("rejects unresolved variables in constructed provider routes", ...)
```

### 8. Client–server protocol & serialization

Files: `packages/server/test/*` (all endpoints tested through a real in-process `ServerFetch.make({ database: { path: ":memory:" } })` handler invoked with plain `Request` objects — no socket), `packages/sdk/test/transport|embedded|instances-lifecycle`, `packages/protocol/test/event|openapi-stabilize|session-cursor`, `packages/schema/test/legacy-event|event-manifest|compatibility`.

Setup: server built as an Effect service whose `handler(new Request(...))` is called directly; responses decoded with the *published* schema (`Schema.decodeUnknownSync(SessionResponse)`) — i.e., the wire contract is the assertion target.

Cases: session CRUD + import through HTTP with schema validation of the encoded response; auth ("session tokens expire, resist tampering, and are revoked by changing the password" — splits the token on "." and checks parts); CORS allowlist ("custom origins extend the defaults without allowing other origins"); schema-error contract ("reports response encoding failures as server errors and request decoding failures as bad requests" — the asymmetry is the case); OpenAPI stability ("openapi-patterns", "openapi-stabilize" — snapshot/golden assertions on the generated spec so the protocol cannot drift silently); legacy event schema ownership tests that enumerate exact event-type arrays (contract pinning).

```ts
// packages/server/test/session-create.test.ts
const handler = yield* ServerFetch.make({ app: { version: "test" }, database: { path: ":memory:" }, fs: { filewatcher: false } })
const parent = yield* create({ title: "Parent" })
const child = yield* create({ parentID: parent.id, title: "Child", location: { directory: "/unused" } })
```

### 9. Errors / retry / timeout / cancel

Files: `packages/core/test/session-runner-retry.test.ts`, `packages/util/src/retry.test.ts`, `abort.test.ts`, `no-timeout-fetch.test.ts`, `packages/ai/test/http-timeout.test.ts`, `packages/core/test/sqlite-interrupt.test.ts`, `session-error.test.ts`, `schema/test/session-error.test.ts`.

Setup: retry policy tested **purely** — errors are constructed literals (timeout, internal, DNS ENOTFOUND, ECONNREFUSED) fed N times into the policy under `TestClock`, so delay accounting is exact and instant. `ai/http-timeout` uses a real local stall server with `Deferred` gates (`yield* Deferred.await(server.stalled)`).

Cases: per-cause budgets — "stops retrying transport timeouts after three attempts" (`[true,true,true,false]`), "keeps the general allowance for other transient failures" (10 attempts), "keeps retrying an unreachable host for an hour with gaps of at most 30 seconds" (assert the recorded `delay` array), "doesn't spend the general allowance on an unreachable host", "doesn't replay a call whose response was cut off by the network going down" (no blind replay of ambiguous requests); timeout matrix — header timeout 5 min, body stall 15 min, whole-request timeout while streaming, disable flags, merge precedence; abort — "still honours an abort signal".

```ts
// packages/core/test/session-runner-retry.test.ts
const decisions = (cause: AIError, count: number) => Effect.gen(function* () {
  const policy = yield* SessionRunnerRetry.policy(SessionSchema.ID.make("ses_retry"))
  const results: boolean[] = []
  for (let i = 0; i < count; i++) results.push((yield* policy(input(cause))).retry)
  return results
})
it.effect("stops retrying transport timeouts after three attempts", () =>
  Effect.gen(function* () { expect(yield* decisions(timeout, 4)).toEqual([true, true, true, false]) }))
```

### 10. Concurrency & races

Files: `packages/core/test/session-run-coordinator.test.ts` (37 cases), `effect/keyed-mutex.test.ts`, `util/flock.test.ts`, `effect-flock-worker`, `tool-edit/tool-patch` concurrency cases, `bus.test.ts` interleaving cases.

Setup: `Deferred`/`Fiber` choreography — hold an effect at a gate, trigger the competing path, release, then assert final state; `TestClock` removes timing flake.

Cases: keyed serialization ("serializes effects with the same key", "allows different keys to proceed independently", "removes an interrupted waiter without dropping the holder lock" — interrupted-waiter must not corrupt the holder); run coordinator lifecycle around interruption: "joins concurrent resumes for one key", "coalesces wakes received during active execution", "does not cancel execution when a joined waiter is interrupted", "does not attach a late interrupt reason after terminal settlement starts", "runs a wake registered during interruption cleanup", "an interrupt during terminal settlement claims the recorded wake"; cleanup-path races ("preserves settlement hook defects while releasing ownership").

```ts
// packages/core/test/effect/keyed-mutex.test.ts
it.effect("removes an interrupted waiter without dropping the holder lock", ...)
// packages/core/test/session-run-coordinator.test.ts
it.effect("does not cancel execution when a joined waiter is interrupted", ...)
it.effect("runs a wake registered during interruption cleanup", ...)
```

### 11. Filesystem / paths / patch-diff

Files: `packages/core/test/file-access.test.ts`, `file-access-path`, `file-mutation`, `filesystem/*.test.ts` (watch, search, watcher), `patch.test.ts`, `tool-patch`, `packages/patchmark/*`, `packages/util/src/path.test.ts`.

Setup: temp dirs with pre-built trees, symlink fixtures, git repos via `initGit`, watcher-enabled location nodes.

Cases: path containment (access checks reject escapes, allow approved external dirs); watcher lifecycle (create/rename/delete events, "keeps watching a deleted config file so recreating it reloads"); patch application incl. moves and case-collisions (macOS-insensitive FS is a fixture concern, asserted explicitly); patchmark uses **differential fuzzing with seeded RNG** — 5,000 generated+mutated cases diffed against commonmark reference, known divergences explicitly allow-listed via `isKnownGfmDivergence`, plus `slow-inputs.test.ts` for pathological inputs.

```ts
// packages/patchmark/test/fuzz-differential.test.ts
test("zero core CommonMark diffs across 5,000 seeded generated + spec-mutated cases", () => {
  const r = rng(0xc0ffeed0)
  for (let i = 0; i < 5_000; i++) {
    const md = i % 2 === 0 ? generate(r, false) : mutate(r)
    ...
    expect({ case: i, md, got }).toEqual({ case: i, md, got: want })
  }
})
```

### 12. Snapshot / rollback / revert

Files: `packages/core/test/snapshot.test.ts`, `session-revert.test.ts`, `session-diff.test.ts`, `config/snapshot.test.ts`.

Setup: temp git project (`initGit(project)`), instrumented service double spread over the real implementation (`Git.Service.of({ ...git, repo: { ...git.repo, discover: counter } })`) to count calls while keeping real behavior.

Cases: revert semantics across message boundaries; diff generation; lazy repo discovery under interruption ("keeps lazy repository discovery after the first caller is interrupted" — counts `discoveries`/`creations` to assert caching behavior when the first caller is cancelled); `Snapshot.noopLayer` used by other tests to disable snapshotting as a controlled dependency.

```ts
// packages/core/test/snapshot.test.ts
const instrumented = Git.Service.of({
  ...git,
  repo: { ...git.repo, discover: (input) => { discoveries++; return git.repo.discover(input) } },
})
```

### 13. Plugin / extension loading

Files: `packages/core/test/plugin.test.ts`, `plugin-failure.test.ts`, `plugin/module|supervisor|supervisor-reload|command|identity|optimize`, `packages/plugin/test/host.test.ts`.

Setup: plugin supervisor node; scripts on disk; `Deferred` gates on plugin lifecycle hooks; scenario arrays looped into `it.effect(scenario.name, ...)` (the one systematic table-driven block).

Cases: healthy-plugin isolation — "reports a failed plugin without blocking a healthy plugin", "removes a failed plugin's hooks and RPC handlers without affecting healthy plugins", "attributes replay failure to the broken plugin rather than a later plugin reading the registry" (error attribution), "disables a plugin whose transform fails after setup without publishing its partial edits" (no partial publish), reload semantics — "disables plugins after runtime reload failures without retrying an unchanged generation", cleanup ordering — "does not join queued failed-plugin cleanup during {boundary}", "settles readiness before shutdown joins a disabled plugin's finalizers".

```ts
// packages/core/test/plugin.test.ts
it.effect("reports a failed plugin without blocking a healthy plugin", ...)
it.effect("disables a plugin whose transform fails after setup without publishing its partial edits", ...)
// packages/core/test/plugin-failure.test.ts
it.live(`does not join queued failed-plugin cleanup during ${boundary}`, ...)
```

### 14. CLI arguments & command behavior

Files: `packages/cli/test/*` (57 files, 271 cases): `flag.test.ts`, `auth.test.ts`, `auth-login-choices`, `config.test.ts`, `env.test.ts`, `service-lifecycle`, `server-connection`, `debug-paths`, `import-export`, `mcp-auth-choices`, `pair-remote-consent`, subdirs `acp/`, `run/`.

Setup: spawns CLI as subprocess against temp dirs and a local server fixture (`packages/cli/test/fixture`); asserts on stdout/exit codes and side effects on disk; interactive flows tested via scripted choice inputs (`auth-login-choices`, `mcp-auth-choices`, `pair-remote-consent` — consent is an explicit test case).

### 15. The AI/LLM protocol layer (`packages/ai`, for completeness)

1,449 cases across streaming generation, compaction, error-partial handling, endpoint/auth resolution, embedding, cache policy. Notably `error-partial.test.ts` (stream dies mid-response → what is salvageable) and `compaction-http.test.ts`. The `http-recorder` package (cassette record/replay with redaction tests — `redaction.test.ts` verifies secrets never land in cassettes) is the reusable fake-provider mechanism.

## Basic case checklist (any agent client should have these)

| Basic case | opencode coverage | How it is judged |
|---|---|---|
| Empty session / no messages | Yes — session-create, fork | "rejects forking an empty session"; returns structured empty listings, paged |
| Read failure must not be treated as empty data | Yes — config | "ignores an invalid file while loading valid config values"; "tolerates unavailable authenticated wellknown config and reloads it later" (explicit reload, not silent empty) |
| Event out-of-order / duplicate | Yes — bus replay | stale-replay rejection, divergent replay rejection, ID-reuse rejection, sequence fencing |
| Stream disconnect mid-flow | Yes — SSE + AI | "encodes a mid-stream session log failure as the reserved SSE failure event"; ai `error-partial.test.ts`; "doesn't replay a call whose response was cut off by the network going down" |
| Cancellation leaves consistent state | Yes — extensively | interrupted-fiber snapshots ("interrupted progress metadata remains in the terminal failure snapshot"), interrupted-waiter mutex safety, "does not attach a late interrupt reason after terminal settlement starts" |
| Config missing field / invalid value | Yes | schema round-trip + rejection tests; "treats an empty configured API key as omitted"; invalid-file isolation |
| Concurrent writes to same session | Yes | keyed mutex, run coordinator joins/coalesces, serialized edit/patch transactions |
| Retry budget per failure class | Yes | exact boolean decision arrays under TestClock (`[true,true,true,false]`) |
| Permission deny precedence & leak-free errors | Yes | "preserving configured deny precedence"; "denied edit does not disclose whether oldString matches" |
| Secrets never serialized | Yes | negative payload assertions ("keeps catalog apiKey credentials out of provider JSON"), cassette redaction tests |
| Slow/laggy subscriber isolation | Yes | event-feed: "fails only the subscriber that exceeds its lag capacity", encoding-failure disconnect isolation |
| Malicious/pathological input | Yes | patchmark fuzz (5,000 seeded cases) + `slow-inputs.test.ts`; shell-scan `adversarial.test.ts` |
| Recording does not leak network calls | Yes (unique) | harness *refuses* any non-loopback fetch and fails the test — coverage of accidental network use is automatic |

## Setup & assertion techniques summary

1. **Effect Layer DI + per-test node replacement** — the app graph is built per describe-block with `LayerNode.group([...]).replace(...)` overrides; every boundary (clock, console, fetch, LLM client, models catalog, permission, snapshot, plugins) is a swappable node. This is the dominant technique and what makes 3,299 core cases feasible.
2. **Network-refusing fetch** baked into the harness — accidental outbound calls fail the test with a diagnostic, instead of relying on each test to mock.
3. **TestClock/TestConsole** — retry delays, throttles (100 ms progress), and watcher timing are asserted exactly without sleeping.
4. **Deferred/Fiber gates** — deterministic interleaving for races: hold at a gate, run the competitor, release, assert.
5. **Recorded HTTP cassettes** (`packages/http-recorder`) — real provider wire format replayed, with in-order replay and exhaustion errors; a full app boot (`session-runner-recorded`) runs against it, so the test exercises the real request path.
6. **In-process server handler** — no sockets: `ServerFetch.make(...)` + plain `Request` objects; wire schemas (`Schema.decodeUnknownSync`) are the assertion.
7. **Temp dir + `Symbol.asyncDispose` / Effect acquireRelease** — uniform teardown; git fixtures (`initGit`) for VCS cases.
8. **Instrumented real services** — spread the real implementation and override one method to count calls, keeping real behavior while asserting caching/single-flight.
9. **Golden/contract pinning** — enumerated event-type arrays and OpenAPI spec stability tests prevent silent protocol drift.
10. **Negative-information assertions** — tests assert that errors *do not leak* (edit miss disclosure, credential projection), not just that happy paths return data.
11. **Seeded differential fuzzing** with explicit known-divergence allow-lists.
12. **`eventually`/`waitUntil` helper** — bounded real-time polling (10 s deadline, 1 ms sleeps) for genuinely asynchronous boundaries, used sparingly.

## Gaps noticed in opencode's own coverage

- **No Go tests at all** and no table-driven style generally; scenario duplication relies on copy-paste Effect blocks (e.g., `plugin-failure.test.ts` repeats a near-identical block for each boundary).
- **Reconnect/resume of the *client* is thin**: the server tests cover SSE failure encoding, and the bus covers replay fencing, but there is no end-to-end "client disconnects, reconnects, resumes from cursor without duplicates" test at the SDK level (`sdk/test/transport` covers transport isolation only).
- **Live `it.live` watcher tests** depend on real filesystem events; they use `eventually` but are the flake-prone minority.
- **Permission UI-less flows** are well covered, but there is no test of permission prompt *timeout* behavior (asked permission that is never answered).
- **Concurrency tests** focus on single-process Effect fibers; multi-process contention (two CLI instances on one session DB) appears only indirectly (`session-owned`, flock tests) and not as a systematic suite.
- **Streaming delta ordering** (`message.part.delta`) is pinned at the schema level (legacy-event ownership lists) but there is no core test asserting delta *sequence integrity* across a partially-failed stream beyond `packages/ai/error-partial`.
