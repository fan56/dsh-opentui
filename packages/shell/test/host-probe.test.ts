// host-probe race regression.
//
// probeHostMux tears the socket down inside done() (timeout / error / close).
// removeAllListeners() drops the probe's own 'error' handler, and terminating a
// still-CONNECTING `ws` socket emits "closed before established" ASYNCHRONOUSLY
// afterwards — with no listener left that surfaces as an uncaught exception.
// The fix keeps a noop 'error' listener attached across teardown. This test
// injects a fake that reproduces that exact CONNECTING-close timing.
import { expect, test } from 'bun:test'
import type WS from 'ws'
import { probeHostMux } from '../src/client/host-probe.ts'

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

/** EventEmitter-style fake with manual delivery and ws-parity CONNECTING close. */
class ConnectingFakeWS {
  readyState = 0 // CONNECTING
  created = false
  terminated = false
  /** 'error' emissions that found NO listener — a real `ws` socket would
   * surface these as uncaught exceptions and crash the process. */
  readonly uncaughtErrors: unknown[] = []
  private listeners = new Map<string, Set<(...args: unknown[]) => void>>()

  on(event: string, listener: (...args: unknown[]) => void): this {
    const set = this.listeners.get(event) ?? new Set()
    set.add(listener)
    this.listeners.set(event, set)
    return this
  }

  removeAllListeners(): this {
    this.listeners.clear()
    return this
  }

  listenerCount(event: string): number {
    return this.listeners.get(event)?.size ?? 0
  }

  terminate(): void {
    this.terminated = true
    const wasConnecting = this.readyState === 0
    this.readyState = 3
    if (wasConnecting) {
      // ws parity: closing CONNECTING reports the error ASYNCHRONOUSLY, after
      // terminate() returned (i.e. after done() removed the probe listeners).
      setTimeout(() => this.emit('error', new Error('WebSocket was closed before the connection was established')), 0)
    }
  }

  fail(error: Error): void {
    this.emit('error', error)
  }

  private emit(event: string, ...args: unknown[]): void {
    const ls = [...(this.listeners.get(event) ?? [])]
    if (event === 'error' && ls.length === 0) this.uncaughtErrors.push(args[0])
    for (const listener of ls) listener(...args)
  }
}

test('CONNECTING-socket timeout: probe settles false, teardown error never uncaught', async () => {
  const socket = new ConnectingFakeWS()
  const result = await probeHostMux({
    authority: '127.0.0.1:9', // never actually dialed: the fake replaces the socket
    cookieHeader: 'FakeCookie test',
    timeoutMs: 20,
    socketFactory: () => {
      socket.created = true
      return socket as unknown as WS
    },
  })

  // The injected socket really drove the probe (seam engaged), and the
  // timeout path terminated it.
  expect(socket.created).toBe(true)
  expect(socket.terminated).toBe(true)
  expect(result).toBe(false)

  // Teardown removed the probe's own listeners and left exactly one noop
  // 'error' guard — this is the line that prevents the uncaught exception.
  expect(socket.listenerCount('error')).toBe(1)

  // Let the async CONNECTING-close error land on that guard: no uncaught
  // surface, process stays alive.
  await tick()
  await tick()
  expect(socket.uncaughtErrors).toHaveLength(0)

  // A late error after settlement is swallowed by the same guard.
  socket.fail(new Error('late close noise'))
  expect(socket.uncaughtErrors).toHaveLength(0)
})
