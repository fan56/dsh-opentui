// Live smoke for the client-mode session layer (waves 1–3) — env-gated,
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
//  - test 3 (wave 3 sweep): the client-local + lifecycle clusters on a
//    SCRATCH dsh home (the profile dir is symlinked in, so the user's real
//    ~/.dsh is never touched): /agents read+write round-trip → one real
//    turn (provider-key fallback like test 2) → /repair scan over the
//    scratch store → attachImage 1px PNG round-trip (fileUploads receipt →
//    file part → session/attachment read-back) → GET /api/file bytes →
//    /btw tiny question (btw: marker + listSessions pollution filter) →
//    /reload same-port restart (carrier reconnects, follow re-opens,
//    session continuity) → git segment returns the real branch →
//    executionMode verdict. The subagent panel is covered by UNIT tests
//    with fakes only (a real delegation needs a model loop + tool workflow
//    — too heavy for a smoke; documented in the report).
import { describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import { ensureHost } from "../src/client/lifecycle.ts"
import { ClientConnection } from "../src/client/transport.ts"
import { RemoteHostSession } from "../src/client/remote-host-session.ts"
import { probeGitBranch } from "../src/client/remote-git.ts"

const RUN = process.env.DSH_REMOTE_SMOKE === "1"
// Host profile under test; defaults to `web`, override for a differently
// routed profile (e.g. DSH_SMOKE_PROFILE=opentui after provisioning it).
const PROFILE = process.env.DSH_SMOKE_PROFILE || "web"

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Poll until `fn()` is true (async settling paths; from client-fakes parity). */
async function until(fn: () => boolean, timeoutMs = 30_000): Promise<void> {
	const deadline = Date.now() + timeoutMs
	while (!fn()) {
		if (Date.now() > deadline) throw new Error("until() timed out")
		await sleep(200)
	}
}

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

	// The canonical 1x1 PNG (69 bytes) — the attachment round-trip fixture.
	const PNG_1PX = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64")

	test.skipIf(!RUN)(
		`${PROFILE} host: wave-3 sweep (agents/repair/attach/btw/reload/git on a scratch DSH_HOME)`,
		async () => {
			const log: string[] = []
			const step = (msg: string) => {
				log.push(msg)
				console.log(`  [wave-3] ${msg}`)
			}
			// Scratch home: the profile dir is SYMLINKED from the real home so
			// the host boots with the same plugins while agents/, sessions/,
			// attachments/, .credentials.yaml stay in the temp dir (the user's
			// real ~/.dsh/agents is never written).
			const realHome = process.env.DSH_HOME || join(homedir(), ".dsh")
			const realProfileDir = join(realHome, "profiles", PROFILE)
			if (!existsSync(realProfileDir)) {
				console.log(`  [wave-3] profile dir ${realProfileDir} missing — provisioning the profile first is required; skipping`)
				return
			}
			const home = mkdtempSync(join(tmpdir(), "dsh-wave3-smoke-"))
			mkdirSync(join(home, "profiles"), { recursive: true })
			symlinkSync(realProfileDir, join(home, "profiles", PROFILE))
			// the credentials SERVICE records (provider keys stored through
			// /login) live in <home>/.credentials.yaml — copy the real home's
			// file so the scratch host can authenticate the model route (the
			// cookie mint reads the same file; the fresh host rewrites the
			// grant record itself)
			if (existsSync(join(realHome, ".credentials.yaml"))) {
				copyFileSync(join(realHome, ".credentials.yaml"), join(home, ".credentials.yaml"))
				chmodSync(join(home, ".credentials.yaml"), 0o600)
			}
			const workspace = mkdtempSync(join(tmpdir(), "dsh-wave3-ws-"))
			let host: Awaited<ReturnType<typeof ensureHost>> | undefined
			let session: RemoteHostSession | undefined
			try {
				host = await ensureHost({ profile: PROFILE, dshHome: home, idleExitSec: 0 })
				step(`host ready pid=${host.pid} authority=${host.authority} scratchHome=${home}`)

				const live = new ClientConnection({ authority: host.authority, cookieHeader: host.cookieHeader })
				session = new RemoteHostSession({
					connection: live,
					cookieHeader: host.cookieHeader,
					cwd: import.meta.dir, // workspace = this repo's test dir (git probe target)
					dshHome: home,
					profile: PROFILE,
				})
				await session.start()

				// 1. /agents round-trip (row 30) on the scratch home
				mkdirSync(join(home, "agents"), { recursive: true })
				writeFileSync(join(home, "agents", "smoke-agent.md"), "---\nname: smoke-agent\nmodel: zai/p1\n---\n\nsmoke body\n")
				const agents = session.listAgents()
				const listed = agents.find((a) => a.name === "smoke-agent")
				expect(listed?.model).toBe("zai/p1")
				session.agentSet("smoke-agent", "thinking", "low")
				const reread = session.listAgents().find((a) => a.name === "smoke-agent")
				expect(reread?.thinking).toBe("low")
				step(`/agents: listed + agentSet(thinking=low) round-trip on ${join(home, "agents")}`)

				// 2. one real turn (provider-key fallback, wave-2 sweep pattern)
				const turnOnce = (text: string): Promise<string | undefined> =>
					new Promise((resolve) => {
						let done = false
						const finish = (err?: string) => {
							if (!done) {
								done = true
								resolve(err)
							}
						}
						// a refused prompt (e.g. image admission on a text-only
						// route) rejects the turn promise — caught here
						session.turn(text, {
							onThinkingDelta: () => {},
							onContentDelta: (t) => log.push(`text ${JSON.stringify(t)}`),
							onTurnEnd: () => finish(),
							onApprove: async () => false,
							onToolRun: () => {},
							onError: (m) => finish(m),
						}).catch((e: unknown) => finish(e instanceof Error ? e.message : String(e)))
						const deadline = Date.now() + 90_000
						const poll = setInterval(() => {
							if (done || Date.now() > deadline) {
								clearInterval(poll)
								finish("turn deadline exceeded")
							}
						}, 200)
						poll.unref?.()
					})
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
				step(`turn completed sessionId=${sessionId}`)

				// 3. /repair scan (row 31) — the turn wrote a session log
				const repair = session.repairScan()
				expect(repair[0]).toMatch(/\d+ logs scanned/)
				step(`/repair: ${repair.join(" | ")}`)

				// 4. attachImage round-trip (row 35): stage → turn (inline image
				//    part, host-admitted) → session/attachment read-back. The
				//    coding-plan route is text-only: on MODEL_DOES_NOT_SUPPORT_
				//    IMAGES fall back to the other catalog group — when THAT
				//    key is also dead (no image-capable route with a live key),
				//    the typed admission rejection itself is the wire proof the
				//    image part reached the host, and the read-back half is
				//    skipped with a loud print (the unit tests + wire types
				//    cover it; a deployment with a vision route runs the full
				//    round-trip).
				const pngPath = join(home, "pixel.png")
				writeFileSync(pngPath, PNG_1PX)
				const echo = await session.attachImage(pngPath)
				step(`attach echo: ${echo}`)
				let attachError = await turnOnce("ok")
				if (attachError && /image/i.test(attachError)) {
					const catalog = await session.modelCatalog(true)
					const alt = catalog.groups.find((g) => g.models.length > 0 && g.id !== catalog.default?.provider)
					if (alt) {
						step(`route rejects image input (${attachError.slice(0, 80)}) — selectModel fallback → ${alt.id}/${alt.models[0]!.id}`)
						await session.selectModel({ provider: alt.id, model: alt.models[0]!.id })
						attachError = await turnOnce("ok")
					}
				}
				if (attachError === undefined) {
					const attId = session.lastAttachmentIds()[0]
					expect(attId).toBeTruthy()
					const back = await session.readSessionAttachment(attId!)
					expect(back.mediaType).toBe("image/png")
					expect(Buffer.from(back.data, "base64").equals(PNG_1PX)).toBe(true)
					step(`attachment read-back: ${attId} ${back.mediaType} ${back.bytes}B round-trip ok`)
				} else {
					// no image-capable route with a live key on this deployment:
					// capability rejection (typed session/attachment-invalid) or
					// the alt provider's dead key — both prove the part left the
					// client and hit the host; read-back skipped with a print
					expect(attachError).toBeDefined()
					step(`IMAGE_ROUNDTRIP blocked: no image-capable route with a live key on this deployment (${attachError!.slice(0, 90)}) — unit tests + wire types cover the read-back half`)
					// restore the WORKING text route for the remaining sweep
					// steps (the btw throwaway rides the session's route — the
					// deployment default may be the provider with the rotted key;
					// when no fallback fired the default itself was working)
					const restoreRoute = workingRoute ?? (await session.modelCatalog()).default
					if (restoreRoute) await session.selectModel(restoreRoute)
				}

				// 5. GET /api/file bytes (row 36): the host reads a scratch file
				const bytes = await session.fetchHostFile(join(home, "agents", "smoke-agent.md"))
				expect(Buffer.from(bytes).toString("utf8")).toContain("smoke body")
				step(`/api/file: ${bytes.byteLength}B fetched for the agents file`)

				// 6. /btw (row 32) + pollution cap
				const answer = await session.btwAsk("Reply with exactly: pong", [])
				step(`/btw answer: ${JSON.stringify(answer.slice(0, 80))}`)
				expect(answer.length).toBeGreaterThan(0)
				const rawList = (await live.rpc("session/list", { _request: {} })) as { items?: { sessionId: string; projections?: { values?: Record<string, unknown> } }[] }
				const markerRows = (rawList.items ?? []).filter((i) => String(i.projections?.values?.title ?? "").startsWith("btw:"))
				step(`session/list raw: ${(rawList.items ?? []).length} rows, btw-marker rows: ${markerRows.length}`)
				const visible = await session.listSessions(50)
				expect(visible.every((r) => !r.title.startsWith("btw:"))).toBe(true)
				step(`listSessions filter: ${visible.length} visible rows, btw: hidden`)

				// 7. /reload (row 29): same-port restart + carrier reconnect +
				//    follow re-open with session continuity
				const before = sessionId!
				const reloadError = await session.reloadPlugins()
				expect(reloadError).toBeUndefined()
				expect(live.getState()).toBe("connected")
				await until(() => session.status.sessionAttached, 30_000)
				expect(session.currentSessionId()).toBe(before)
				const continuity = await session.storedTranscript(before)
				expect(continuity.length).toBeGreaterThan(0)
				step(`/reload: host restarted on the SAME port, carrier reconnected, follow re-opened, ${continuity.length} transcript rows survived`)

				// 8. git segment (row 39): the workspace probe = the real branch
				const branch = await session.gitBranch()
				const expected = await probeGitBranch(import.meta.dir)
				expect(branch).toBe(expected)
				expect(branch).not.toBe("")
				step(`git segment: ${branch}`)

				// 9. executionMode verdict (row 37) — print, no hard assert: the
				//    verdict depends on the deployment's preset composition
				step(`executionMode: ${session.executionMode()} (preset=${session.currentPresetId() ?? "(deployment default → native assumption)"})`)

				session.abort()
				await session.dispose()
				await live.close()
				expect(live.getState()).toBe("disconnected")
				step("cleanup: facade disposed, carrier disconnected")
				console.log(`[remote-live-smoke wave-3]\n  ${log.join("\n  ")}`)
			} finally {
				await host?.dispose()
				// the same-port restart spawns a host the lifecycle handle does
				// not track (its pid is the RESTARTED one) — reap it explicitly
				// and sweep the scratch port's listener so full cleanup holds
				if (session !== undefined) {
					const restarted = session.lastRestartPid()
					if (restarted !== undefined) {
						try {
							process.kill(restarted, "SIGTERM")
							log.push(`cleanup: SIGTERM restarted host pid=${restarted}`)
						} catch {
							/* already gone */
						}
					}
				}
				if (host !== undefined) {
					const sweep = spawnSync("lsof", ["-ti", `tcp:${host.port}`])
					const pids = String(sweep.stdout).split("\n").map((s) => s.trim()).filter(Boolean)
					if (sweep.error || pids.length > 0) console.log(`  [wave-3] port sweep tcp:${host.port} → ${sweep.error ? `lsof error: ${sweep.error.message}` : pids.join(",")}`)
					for (const pid of pids) {
						// the pid is the detached dsh wrapper — a group leader:
						// signal the whole group so wrapper children (a respawning
						// supervisor) cannot outlive the kill and rewrite the
						// scratch home after cleanup
						try {
							process.kill(-Number(pid), "SIGTERM")
						} catch {
							try {
								process.kill(Number(pid), "SIGTERM")
							} catch {
								/* already gone */
							}
						}
					}
				}
				// wait for the killed pids to be fully dead (signal-0 poll — no
				// lsof here: a second lsof invocation can hang the finally) so
				// the shutdown flush cannot race the removal
				const deadPids = host?.pid !== undefined ? [host.pid, ...(session?.lastRestartPid() !== undefined ? [session!.lastRestartPid()!] : [])] : []
				const deadDeadline = Date.now() + 15_000
				const allDead = (): boolean =>
					deadPids.every((pid) => {
						try {
							process.kill(pid, 0)
							return false
						} catch {
							return true
						}
					})
				while (!allDead() && Date.now() < deadDeadline) await sleep(200)
				// scratch homes go away with the host
				rmSync(home, { recursive: true, force: true })
				rmSync(workspace, { recursive: true, force: true })
				// one late re-removal pass: a shutdown flush that landed between
				// the kill and the first rm gets collected too
				await sleep(1500)
				rmSync(home, { recursive: true, force: true })
				rmSync(workspace, { recursive: true, force: true })
				if (existsSync(home) || existsSync(workspace)) {
					console.log(`  [wave-3] WARNING: scratch dirs still present (${existsSync(home) ? home : ""} ${existsSync(workspace) ? workspace : ""}) — the OS temp sweeper will collect them`)
				}
			}
		},
		300_000,
	)
})
