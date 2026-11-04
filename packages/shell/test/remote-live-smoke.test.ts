// Live smoke for the client-mode wave-1 core — env-gated, NEVER part of the
// default suite:
//
//   DSH_REMOTE_SMOKE=1 bun test test/remote-live-smoke.test.ts
//
// Boots a REAL `dsh --profile web` host through lifecycle.ts ensureHost,
// drives RemoteHostSession over P1's ClientConnection (session/create +
// session/prompt + session/follow), waits for the first assistant chunk,
// cancels the turn, then disposes everything (no listeners, no host left).
//
// Model-call caveat: the tiny prompt rides the profile's routable provider.
// If the host's model credentials are stale (provider auth 401), the turn
// settles with the durable error turn/end INSTEAD of text deltas — the smoke
// still passes (every wire path is exercised: create, follow snapshot +
// frames, prompt accept, durable turn/end mapping, cancel, dispose) and
// prints `MODEL_CALL blocked: <error>` as evidence; with valid credentials
// it prints `MODEL_CALL ok` after a real text delta.
import { describe, expect, test } from "bun:test"
import { ensureHost } from "../src/client/lifecycle.ts"
import { ClientConnection } from "../src/client/transport.ts"
import { RemoteHostSession } from "../src/client/remote-host-session.ts"

const RUN = process.env.DSH_REMOTE_SMOKE === "1"

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe("remote live smoke", () => {
	test.skipIf(!RUN)(
		"web host boot + session/create + tiny prompt + follow + cancel",
		async () => {
			const events: string[] = []
			const errors: string[] = []
			let sawChunk = false
			let settled = false
			let host: Awaited<ReturnType<typeof ensureHost>> | undefined
			try {
				host = await ensureHost({ profile: "web", idleExitSec: 0 })
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
})
