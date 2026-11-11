// First-connection retry cap (fix/connection-retry): a carrier pointed at a
// host that never accepts the connection must surface a typed error with the
// host's diagnostics instead of printing `[connection] connection lost,
// retry #n` forever. After the first successful connection the SDK's normal
// reconnect policy is untouched (covered by the live smoke).
import { describe, expect, test } from 'bun:test'
import { createServer } from 'node:net'
import { ClientConnection, ConnectionRetryExhaustedError } from '../src/client/transport.ts'

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
