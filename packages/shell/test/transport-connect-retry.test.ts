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
	/** First N generations are dead; generation N+1 answers with a real ready
	 * frame. Infinity (default) keeps the legacy always-dead host. */
	#deadGenerations = Infinity
	#generation = 0

	/** Script a fresh fault-injection run. Callers always reset before connect. */
	reset(deadGenerations: number): void {
		this.#deadGenerations = deadGenerations
		this.#generation = 0
		this.#source = undefined
		this.#socket = undefined
	}

	/** Generations the SDK actually opened — the non-idle-spin probe count. */
	get generation(): number {
		return this.#generation
	}

	registerGenerationSource(source: GenerationSource): () => void {
		this.#source = source
		return () => {
			this.#source = undefined
		}
	}

	openWebSocket(): FakeMuxSocket {
		this.#generation += 1
		const socket = new FakeMuxSocket()
		this.#socket = socket
		if (this.#generation > this.#deadGenerations) {
			// Live generation: answer the `$events` open frame with the host's
			// generation-gate ready item so the pump reports ready and connect()
			// resolves. Microtask keeps the emit out of the pump's send stack.
			const send = socket.send.bind(socket)
			socket.send = (data: string): void => {
				send(data)
				if (data.includes('"type":"open"')) {
					queueMicrotask(() =>
						socket.item({ type: "ready", clientId: "w3-boot-probe", host: { home: "/tmp/w3-host" } }),
					)
				}
			}
		}
		return socket
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
			// reconnects — replayed here by the tiny tick timer. The real SDK emits
			// the `connected` state before the onConnected sink (connection.ts:254-257).
			void source(controller.signal, () => {
				sinks.onStateChange('connected')
				sinks.onConnected()
			})
				.catch(() => {
					/* failed generation: the loop retries */
				})
				.then(() => {
					if (!stopped) timer = setTimeout(tick, 1)
				})
			// Dead generations: `openWebSocket` ran inside `source`'s synchronous
			// prologue, so closing now fails the generation deterministically —
			// the "host never accepts the connection" shape, no real network.
			// Live generations stay open and answer via the ready item above.
			if (this.#generation <= this.#deadGenerations) this.#socket?.close()
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

// ---------------------------------------------------------------------------
// 025 wave3 batch1 — bounded boot poll (host-boot flake root-cause fix).
// Fault injection scripts a slow-booting host: the first SLOW_START_FAILURES
// generations are dead (cookie minted, listener not up), the next is live.
// The window/backoff come from constants injected through options — no fixed
// wall-clock sleep and no sampling of an intermediate frame.
// ---------------------------------------------------------------------------
const SLOW_START_FAILURES = 5
const BOOT_BUDGET_MS = 2_000
const DEAD_BOOT_BUDGET_MS = 300
const PROBE_BACKOFF = { backoffBaseMs: 5, backoffFactor: 2, backoffMaxMs: 20, generationReadyTimeoutMs: 200 }

describe('ClientConnection — bounded boot poll (025-w3-1)', () => {
	test('LEGACY fixed cap rejects a slow-boot host that comes up inside the budget', async () => {
		handle.reset(SLOW_START_FAILURES)
		const connection = new ClientConnection({
			authority: '127.0.0.1:1',
			cookieHeader: 'dsh-auth-test=v1.body.sig',
			maxConnectAttempts: 3, // explicit cap => legacy fixed-window behavior
			connectBudgetMs: BOOT_BUDGET_MS,
			recovery: PROBE_BACKOFF,
		})
		try {
			const error = await connection.connect().then(
				() => undefined,
				(reason: unknown) => reason,
			)
			expect(error instanceof ConnectionRetryExhaustedError).toBe(true)
			// Old law cuts off at attempt 5 — before the host's 6th (live) generation.
			expect(handle.generation).toBeLessThanOrEqual(SLOW_START_FAILURES)
		} finally {
			await connection.close()
		}
	})

	test('bounded poll accepts the SAME slow-boot host inside the budget', async () => {
		handle.reset(SLOW_START_FAILURES)
		const connection = new ClientConnection({
			authority: '127.0.0.1:1',
			cookieHeader: 'dsh-auth-test=v1.body.sig',
			// no explicit cap => bounded poll over connectBudgetMs (production path)
			connectBudgetMs: BOOT_BUDGET_MS,
			recovery: PROBE_BACKOFF,
		})
		try {
			const info = await connection.connect()
			expect(info.clientId).toBe('w3-boot-probe')
			// Non-idle-spin proof: the source really probed PAST the old fixed cap;
			// a no-op/wait-only fix would stall at 5 and never reach the live gen.
			expect(handle.generation).toBeGreaterThanOrEqual(SLOW_START_FAILURES + 1)
		} finally {
			await connection.close()
		}
	})

	test('bounded poll fails loud when the host never accepts inside the budget', async () => {
		handle.reset(Infinity)
		const connection = new ClientConnection({
			authority: '127.0.0.1:1',
			cookieHeader: 'dsh-auth-test=v1.body.sig',
			connectBudgetMs: DEAD_BOOT_BUDGET_MS,
			recovery: PROBE_BACKOFF,
			diagnostics: () => '--- host output ---\nboot stalled',
		})
		try {
			const error = await connection.connect().then(
				() => undefined,
				(reason: unknown) => reason,
			)
			expect(error instanceof ConnectionRetryExhaustedError).toBe(true)
			const exhausted = error as ConnectionRetryExhaustedError
			expect(exhausted.attempts).toBeGreaterThanOrEqual(1)
			expect(exhausted.authority).toBe('127.0.0.1:1')
			expect(exhausted.message).toContain('never accepted the client connection')
			expect(exhausted.message).toContain('boot stalled')
			expect(handle.generation).toBeGreaterThanOrEqual(1) // it really probed
		} finally {
			await connection.close()
		}
	})

	test('bounded poll leaves the first-generation success path unchanged', async () => {
		handle.reset(0) // live on the very first generation
		const connection = new ClientConnection({
			authority: '127.0.0.1:1',
			cookieHeader: 'dsh-auth-test=v1.body.sig',
			connectBudgetMs: BOOT_BUDGET_MS,
			recovery: PROBE_BACKOFF,
		})
		try {
			const info = await connection.connect()
			expect(info.clientId).toBe('w3-boot-probe')
			expect(handle.generation).toBe(1)
			expect(connection.getState()).toBe('connected')
		} finally {
			await connection.close()
		}
	})
})
