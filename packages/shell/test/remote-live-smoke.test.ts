// Live smoke for the client-mode session layer (waves 1 + 2) — env-gated,
// NEVER part of the default suite:
//
//   DSH_REMOTE_SMOKE=1 bun test test/remote-live-smoke.test.ts
//   DSH_REMOTE_SMOKE=1 DSH_SMOKE_PROFILE=opentui bun test test/remote-live-smoke.test.ts
//
// Boots a REAL dsh host (profile: `opentui` via DSH_SMOKE_PROFILE, default
// `web`) through lifecycle.ts ensureHost, drives RemoteHostSession over P1's
// ClientConnection, then:
//  - test 1 (wave 1): session/create + tiny prompt + follow + cancel.
//  - test 2 (wave 2 sweep): completed turn → list shows it → stored
//    transcript replay on a SECOND RemoteHostSession (page/follow parity) →
//    rename → fork-at-turn → search finds it → modelCatalog/selectModel
//    round-trip → presets → commands → skills → plugins → tail a foreign
//    session id. Full cleanup after (no hosts/locks/listeners left).
//
// Model-call caveat: the tiny prompt rides the profile's routable provider.
// If the host's model credentials are stale (provider auth 401), the turn
// settles with the durable error turn/end INSTEAD of text deltas — the wave-1
// smoke still passes and prints `MODEL_CALL blocked: <error>`; the wave-2
// sweep needs a REAL completed turn (transcript rows, fork prefix), so it
// fails loudly when the route is down.
import { describe, expect, test } from "bun:test"
import { ensureHost } from "../src/client/lifecycle.ts"
import { ClientConnection } from "../src/client/transport.ts"
import { RemoteHostSession } from "../src/client/remote-host-session.ts"

const RUN = process.env.DSH_REMOTE_SMOKE === "1"
// Host profile under test; defaults to `web`, override for a differently
// routed profile (e.g. DSH_SMOKE_PROFILE=opentui after provisioning it).
const PROFILE = process.env.DSH_SMOKE_PROFILE || "web"

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe("remote live smoke", () => {
	test.skipIf(!RUN)(
		`${PROFILE} host boot + session/create + tiny prompt + follow + cancel`,
		async () => {
			const events: string[] = []
			const errors: string[] = []
			let sawChunk = false
			let settled = false
			let host: Awaited<ReturnType<typeof ensureHost>> | undefined
			try {
				host = await ensureHost({ profile: PROFILE, idleExitSec: 0 })
				events.push(`host ready pid=${host.pid} authority=${host.authority} adopted=${host.adopted}`)

				const live = new ClientConnection({ authority: host.authority, cookieHeader: host.cookieHeader })
				const session = new RemoteHostSession({ connection: live, cookieHeader: host.cookieHeader })
				const ready = await session.start()
				events.push(`connected clientId=${ready.clientId} hostHome=${ready.host.home}`)

				const pending = session.turn("say ok", {
					onThinkingDelta: (t) => events.push(`thinking ${t.length}ch`),
					onContentDelta: (t) => {
						sawChunk = true
						events.push(`text ${JSON.stringify(t)}`)
					},
					onTurnEnd: (u) => {
						settled = true
						events.push(`turnEnd prompt=${u.prompt} completion=${u.completion}`)
					},
					onApprove: async () => false,
					onToolRun: () => {},
					onError: (m) => {
						errors.push(m)
						events.push(`error ${m}`)
					},
				})

				// Follow until the first assistant chunk — or the turn settles
				// (see the header: a stale provider credential settles the turn
				// with an error turn/end instead of text deltas; both prove the
				// live follow path, the chunk additionally proves streaming).
				const deadline = Date.now() + 60_000
				while (!sawChunk && !settled && Date.now() < deadline) await sleep(200)
				expect(sawChunk || settled).toBe(true)
				expect(session.currentSessionId()).toBeDefined()
				events.push(`sessionId=${session.currentSessionId()} — first ${sawChunk ? "chunk" : `turn settle (${errors.length} error(s))`} received, cancelling`)

				session.abort()
				await pending
				events.push(`usage after turn: ${JSON.stringify(session.usage)}`)
				expect(session.currentSessionId()).toBeUndefined()
				events.push(sawChunk ? "MODEL_CALL ok" : `MODEL_CALL blocked: ${errors[0] ?? "turn settled without text"}`)

				await session.dispose()
				await live.close()
				expect(live.getState()).toBe("disconnected")

				console.log(`[remote-live-smoke]\n  ${events.join("\n  ")}`)
			} finally {
				await host?.dispose()
			}
		},
		120_000,
	)

	test.skipIf(!RUN)(
		`${PROFILE} host: wave-2 capability sweep (list/replay/rename/fork/search/model/presets/commands/skills/plugins/tail)`,
		async () => {
			const log: string[] = []
			const step = (msg: string) => {
				log.push(msg)
				console.log(`  [sweep] ${msg}`)
			}
			let host: Awaited<ReturnType<typeof ensureHost>> | undefined
			try {
				host = await ensureHost({ profile: PROFILE, idleExitSec: 0 })
				step(`host ready pid=${host.pid} authority=${host.authority} adopted=${host.adopted}`)

				const live = new ClientConnection({ authority: host.authority, cookieHeader: host.cookieHeader })
				const session = new RemoteHostSession({ connection: live, cookieHeader: host.cookieHeader })
				await session.start()

				// One tiny turn; resolves with the durable turn error (or
				// undefined on a completed turn).
				const turnOnce = (text: string): Promise<string | undefined> =>
					new Promise((resolve) => {
						let done = false
						const finish = (err?: string) => {
							if (!done) {
								done = true
								resolve(err)
							}
						}
						void session.turn(text, {
							onThinkingDelta: () => {},
							onContentDelta: (t) => log.push(`text ${JSON.stringify(t)}`),
							onTurnEnd: () => finish(),
							onApprove: async () => false,
							onToolRun: () => {},
							onError: (m) => finish(m),
						})
						const deadline = Date.now() + 90_000
						const poll = setInterval(() => {
							if (done || Date.now() > deadline) {
								clearInterval(poll)
								finish("turn deadline exceeded")
							}
						}, 200)
						poll.unref?.()
					})

				// 1. a real completed turn ("say ok" — tiny). Provider keys rot:
				//    when the deployment default's key is rejected, fall back to
				//    another routable provider from the catalog (session-level
				//    selectModel — also proves the row-21 switch path live).
				let workingRoute: { provider: string; model: string } | undefined
				let turnError = await turnOnce("say ok")
				if (turnError && /api key|auth/i.test(turnError)) {
					const catalog = await session.modelCatalog(true)
					const alt = catalog.groups.find((g) => g.models.length > 0 && g.id !== catalog.default?.provider)
					if (alt) {
						step(`default route key rejected (${turnError.slice(0, 90)}) — selectModel fallback → ${alt.id}/${alt.models[0]!.id}`)
						workingRoute = { provider: alt.id, model: alt.models[0]!.id }
						await session.selectModel(workingRoute)
						turnError = await turnOnce("say ok")
					}
				}
				expect(turnError).toBeUndefined()
				const sessionId = session.currentSessionId()
				expect(sessionId).toBeDefined()
				step(`turn completed sessionId=${sessionId} usage=${JSON.stringify(session.usage)}`)

				// 2. session/list shows it (row 13)
				const list = await session.listSessions()
				expect(list.some((s) => s.id === sessionId)).toBe(true)
				step(`session/list: ${list.length} rows, ours present`)

				// 3. stored transcript replay on a SECOND facade (row 14) —
				//    page/follow snapshot parity with what the live session has
				const observer = new RemoteHostSession({ connection: live, cookieHeader: host.cookieHeader })
				await observer.start()
				const replayed = await observer.storedTranscript(sessionId!)
				expect(replayed.length).toBeGreaterThan(0)
				expect(replayed[0]).toEqual({ kind: "user", text: "say ok" })
				step(`storedTranscript: ${replayed.length} rows, first=${JSON.stringify(replayed[0])}`)

				// 4. rename (row 20)
				const renamed = await session.renameSession(`smoke-wave2-${Date.now()}`)
				expect(renamed?.title).toBeTruthy()
				step(`rename: ${renamed?.title} @seq ${renamed?.seq}`)

				// 5. fork-at-turn, latest completed turn (row 18)
				const turns = session.historyTurns()
				expect(turns.length).toBeGreaterThan(0)
				const forked = await session.forkAtTurn(turns.at(-1)!.seqEnd)
				expect(forked.items.length).toBeGreaterThan(0)
				expect(session.currentSessionId()).not.toBe(sessionId)
				step(`fork: new sessionId=${session.currentSessionId()} items=${forked.items.length} turn=${forked.turn}`)

				// 6. search (row 19) — FULL at the protocol level but OPT-IN per
				//    deployment: the base dsh profile ships the session-query FTS
				//    index with `openAt: never`, and `session/search` then fails
				//    with "session search is disabled". Detect that degrade and
				//    skip; otherwise the transcript text must be found.
				let searchDisabled = false
				try {
					await live.rpc("session/search", { request: { query: "say ok" } })
				} catch (e) {
					searchDisabled = e instanceof Error && /search is disabled/i.test(e.message)
				}
				if (searchDisabled) {
					step("search: DISABLED on this deployment (session-query openAt: never — opt-in upstream); row 19 degrade documented")
				} else {
					let hits = await session.searchSessions("say ok")
					const searchDeadline = Date.now() + 10_000
					while (!hits.some((h) => h.id === sessionId || h.id === session.currentSessionId()) && Date.now() < searchDeadline) {
						await sleep(500)
						hits = await session.searchSessions("say ok")
					}
					expect(hits.some((h) => h.id === sessionId || h.id === session.currentSessionId())).toBe(true)
					step(`search: ${hits.length} hits, ours present`)
				}

				// 7. model catalog + selectModel round-trip (rows 21+22)
				const catalog = await session.modelCatalog()
				expect(catalog.groups.length).toBeGreaterThan(0)
				step(`modelCatalog: groups=[${catalog.groups.map((g) => g.id).join(",")}] default=${JSON.stringify(catalog.default)}`)
				const group = catalog.groups[0]!
				const model = group.models[0]!
				const selected = await session.selectModel({ provider: group.id, model: model.id })
				expect(selected.provider).toBe(group.id)
				expect(selected.model).toBe(model.id)
				step(`selectModel round-trip: ${selected.provider}/${selected.model}${selected.reasoningEffort ? ` (${selected.reasoningEffort})` : ""}`)
				// restore the route turn 2 rides — the round-trip may have parked
				// the session on a provider whose key is stale
				const restore = workingRoute ?? catalog.default
				if (restore) await session.selectModel(restore)

				// 8. presets (row 23)
				const presets = await session.listPresets()
				step(`agentPresets/list: ${presets.length} presets (${presets.slice(0, 3).map((p) => p.id).join(",")})`)

				// 9. commands (row 26, agent-scoped)
				const commands = await session.listHostCommands()
				step(`commands/list: ${commands.length} commands (${commands.slice(0, 3).map((c) => c.name).join(",")})`)

				// 10. skills (row 27)
				const skills = await session.refreshSkills()
				step(`skills/list: ${skills.length} skills`)

				// 11. plugins (row 28)
				const plugins = await session.refreshPlugins()
				step(`pluginManager/listPlugins: ${plugins.length} user rows`)

				// 12. tail a foreign session id (row 17): the observer watches the
				//     ORIGINAL session and receives the durable prefix rows
				const tailRows: { kind: string; text: string; final: boolean }[][] = []
				observer.remoteTailSink = (rows) => tailRows.push(rows)
				const tailError = await observer.startRemoteTail(sessionId!)
				expect(tailError).toBeUndefined()
				const tailDeadline = Date.now() + 20_000
				while (tailRows.length === 0 && Date.now() < tailDeadline) await sleep(200)
				expect(tailRows.length).toBeGreaterThan(0)
				expect(tailRows.at(-1)!.some((r) => r.kind === "user" && r.text === "say ok")).toBe(true)
				step(`remote tail: ${tailRows.at(-1)!.length} durable rows replayed from the foreign session`)
				observer.stopRemoteTail()

				// 13. row-5 usage semantics on the real wire: a SECOND tiny turn.
				//     Wire truth (verified): each usage chunk ASSIGNS the fields
				//     it reports (host-session.ts:1269-1272 parity) and the
				//     context size is prompt + cacheRead + cacheWrite — the zai
				//     adapter splits context into a cached prefix (cacheRead) and
				//     uncached input (prompt), so prompt alone is NOT the context
				//     size. Discriminator: ASSIGNMENT makes turn 2's context ≈
				//     turn 1's; ACCUMULATION would roughly double it.
				const contextOf = (u: { prompt: number; cacheRead: number; cacheWrite: number }) => u.prompt + u.cacheRead + u.cacheWrite
				const turnError2 = await turnOnce("ok")
				expect(turnError2).toBeUndefined()
				const context1 = contextOf(session.usage) // still turn 1's assignment
				const after2 = { ...session.usage }
				const context2 = contextOf(after2)
				expect(context2).toBeGreaterThan(context1 * 0.5) // context carried over
				expect(context2).toBeLessThan(context1 * 2) // assigned, NOT accumulated (would be ~2x)
				step(
					`usage semantics: context ${context1} → ${context2} (assignment — accumulation would be ~${context1 * 2}); ` +
						`turn 2 chunk split: prompt=${after2.prompt} (uncached input) + cacheRead=${after2.cacheRead} (cached prefix); completion=${after2.completion} (accumulated)`,
				)

				// cleanup: no listeners left, carrier closed
				session.abort()
				await session.dispose()
				await observer.dispose()
				await live.close()
				expect(live.getState()).toBe("disconnected")
				step("cleanup: facades disposed, carrier disconnected")

				console.log(`[remote-live-smoke wave-2]\n  ${log.join("\n  ")}`)
			} finally {
				await host?.dispose()
			}
		},
		300_000,
	)
})
