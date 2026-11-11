// First-connection retry cap (fix/connection-retry): a carrier pointed at a
// host that never accepts the connection must surface a typed error with the
// host's diagnostics instead of printing `[connection] connection lost,
// retry #n` forever. After the first successful connection the SDK's normal
// reconnect policy is untouched (covered by the live smoke).
//
// The SDK (`@deepseek-ai/dsh-client-connection/client`) is faked with
// `mock.module` so the test is deterministic in EVERY environment: CI only
// carries a resolution-only stub whose `installConnection` throws on
// invocation, while local runs may have the real global-dsh closure behind a
// manual symlink. The fake handle replays exactly the dead-host cycle the
// real ConnectionController runs — every generation's socket is lost before
// the `$events` stream opens, the source rejects, the loop schedules the next
// generation — so transport.ts's REAL retry-cap path is what fails (attempt
// counting, ConnectionRetryExhaustedError, the host stderr tail). No real
// network, no SDK install, no symlink required.
import { afterAll, describe, expect, mock, test } from 'bun:test'
import { createServer } from 'node:net'
import { ClientConnection, ConnectionRetryExhaustedError } from '../src/client/transport.ts'
import { FakeMuxSocket } from './client-fakes.ts'

/** The SDK entry transport.ts lazy-imports on the connect path. */
const SDK_MODULE = '@deepseek-ai/dsh-client-connection/client'

/** The original module (real closure or CI stub), captured before mocking so
 * it can be re-registered after the file (bun module mocks are process-global
 * and never reset between files). */
const originalSdk: Record<string, unknown> | undefined = await import(SDK_MODULE).catch(() => undefined)

/** The generation-source shape transport.ts registers (structural — the SDK
 * is only a type dependency here and must not be imported for real). */
type GenerationSource = (signal: AbortSignal, ready: (host: { home: string }) => void) => Promise<void>

interface ConnectionSinks {
	onConnected(): void
	onStateChange(state: string): void
}

/**
 * The `ctx.connection` handle surface transport.ts drives, with the real
 * controller's dead-host loop semantics: `openWebSocket` hands out a socket
 * that is torn down before the `$events` stream opens (the pump then rejects
 * with a socket loss), and the loop schedules the next generation — forever,
 * until `stop()` (transport's retry cap or `close()` stops it).
 */
class FakeConnectionHandle {
	#source: GenerationSource | undefined
	#socket: FakeMuxSocket | undefined

	registerGenerationSource(source: GenerationSource): () => void {
		this.#source = source
		return () => {
			this.#source = undefined
		}
	}

	openWebSocket(): FakeMuxSocket {
		this.#socket = new FakeMuxSocket()
		return this.#socket
	}

	start(sinks: ConnectionSinks): { stop(): void } {
		let stopped = false
		let timer: ReturnType<typeof setTimeout> | undefined
		let controller: AbortController | undefined
		const tick = (): void => {
			const source = this.#source
			if (stopped || !source) return
			controller = new AbortController()
			// A failed generation settles the source; the real controller then
			// reconnects — replayed here by the tiny tick timer.
			void source(controller.signal, () => sinks.onConnected())
				.catch(() => {
					/* failed generation: the loop retries */
				})
				.then(() => {
					if (!stopped) timer = setTimeout(tick, 1)
				})
			// `openWebSocket` ran inside `source`'s synchronous prologue (the pump
			// attaches its listeners before the first await), so closing the socket
			// now fails the generation deterministically — the "host never accepts
			// the connection" shape, without any real network.
			this.#socket?.close()
		}
		tick()
		return {
			stop(): void {
				stopped = true
				if (timer !== undefined) clearTimeout(timer)
				controller?.abort()
			},
		}
	}
}

const handle = new FakeConnectionHandle()

// Swap the SDK for the fake before any connect() runs. `installConnection`
// mirrors the real plugin's registration: provide the handle as the
// `connection` service so transport's `ctx.get("connection")` finds it.
mock.module(SDK_MODULE, () => ({
	installConnection: (ctx: { provide(name: string, value: unknown): unknown }) => {
		ctx.provide('connection', handle)
	},
}))

afterAll(() => {
	if (originalSdk) mock.module(SDK_MODULE, () => originalSdk)
})

/** A loopback port that is (almost surely) not listening. */
async function closedPort(): Promise<number> {
	const server = createServer()
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
	const address = server.address()
	const port = typeof address === 'object' && address !== null ? address.port : 0
	await new Promise<void>((resolve) => server.close(() => resolve()))
	return port
}

describe('ClientConnection — first-connection retry cap', () => {
	test('retry cap rejects with the host diagnostics tail', async () => {
		const port = await closedPort()
		const connection = new ClientConnection({
			authority: `127.0.0.1:${port}`,
			cookieHeader: 'dsh-auth-test=v1.body.sig',
			maxConnectAttempts: 2,
			connectBudgetMs: 10_000,
			recovery: { backoffBaseMs: 30, backoffMaxMs: 60, generationReadyTimeoutMs: 500 },
			diagnostics: () => '--- dsh host output (last 1 lines) ---\nplugin failed to load: boom',
		})
		try {
			const error = await connection.connect().then(
				() => undefined,
				(reason: unknown) => reason,
			)
			expect(error instanceof ConnectionRetryExhaustedError).toBe(true)
			const exhausted = error as ConnectionRetryExhaustedError
			expect(exhausted.attempts).toBe(2)
			expect(exhausted.authority).toBe(`127.0.0.1:${port}`)
			expect(exhausted.message).toContain('after 2 retries')
			expect(exhausted.message).toContain('plugin failed to load: boom')
		} finally {
			await connection.close()
		}
	})
})
