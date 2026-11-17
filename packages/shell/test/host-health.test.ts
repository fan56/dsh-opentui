// Injectable host health validation (ADR-0009 decision 5 / readiness gate).
// All probes are faked: no socket is opened and no real host is started.
import { describe, expect, test } from 'bun:test'
import {
  authorityPort,
  checkHostHealth,
  isHealthyStatus,
  type HealthProbes,
} from '../src/client/host-health.ts'

function probes(opts: { tcp?: boolean; status?: number | null; tcpThrow?: boolean; httpThrow?: boolean } = {}): {
  probes: HealthProbes
  tcpCalls: string[]
  httpCalls: { authority: string; cookie: string }[]
} {
  const tcpCalls: string[] = []
  const httpCalls: { authority: string; cookie: string }[] = []
  return {
    tcpCalls,
    httpCalls,
    probes: {
      async connectTcp(authority) {
        tcpCalls.push(authority)
        if (opts.tcpThrow) throw new Error('tcp boom')
        return opts.tcp ?? true
      },
      async requestStatus(authority, cookieHeader) {
        httpCalls.push({ authority, cookie: cookieHeader })
        if (opts.httpThrow) throw new Error('http boom')
        return opts.status === undefined ? 200 : opts.status
      },
    },
  }
}

const TARGET = { authority: '127.0.0.1:61234', cookieHeader: 'FakeCookie owner' }

describe('isHealthyStatus', () => {
  test('2xx/3xx healthy, everything else not', () => {
    expect(isHealthyStatus(199)).toBe(false)
    expect(isHealthyStatus(200)).toBe(true)
    expect(isHealthyStatus(204)).toBe(true)
    expect(isHealthyStatus(302)).toBe(true)
    expect(isHealthyStatus(399)).toBe(true)
    expect(isHealthyStatus(400)).toBe(false)
    expect(isHealthyStatus(401)).toBe(false)
    expect(isHealthyStatus(500)).toBe(false)
    expect(isHealthyStatus(null)).toBe(false)
  })
})

describe('authorityPort', () => {
  test('parses IPv4 and bracketed IPv6 authorities', () => {
    expect(authorityPort('127.0.0.1:60000')).toBe(60000)
    expect(authorityPort('localhost:8080')).toBe(8080)
    expect(authorityPort('[::1]:60001')).toBe(60001)
  })

  test('rejects malformed authorities', () => {
    expect(authorityPort('')).toBeNull()
    expect(authorityPort('127.0.0.1')).toBeNull()
    expect(authorityPort('host:notaport')).toBeNull()
    expect(authorityPort('host:0')).toBeNull()
    expect(authorityPort('host:70000')).toBeNull()
  })
})

describe('checkHostHealth', () => {
  test('healthy when TCP connects and GET / answers 200', async () => {
    const f = probes({ tcp: true, status: 200 })
    const result = await checkHostHealth(TARGET, f.probes)
    expect(result).toEqual({ healthy: true, tcp: true, httpStatus: 200, reason: 'ok' })
    expect(f.tcpCalls).toEqual([TARGET.authority])
    expect(f.httpCalls).toEqual([{ authority: TARGET.authority, cookie: TARGET.cookieHeader }])
  })

  test('3xx redirect counts as healthy', async () => {
    const f = probes({ tcp: true, status: 302 })
    expect((await checkHostHealth(TARGET, f.probes)).healthy).toBe(true)
  })

  test('TCP failure short-circuits: HTTP probe is never called', async () => {
    const f = probes({ tcp: false, status: 200 })
    const result = await checkHostHealth(TARGET, f.probes)
    expect(result).toEqual({ healthy: false, tcp: false, httpStatus: null, reason: 'tcp-failed' })
    expect(f.tcpCalls).toEqual([TARGET.authority])
    expect(f.httpCalls).toEqual([])
  })

  test('401 (foreign host / rejected cookie) is unhealthy with the status reported', async () => {
    const f = probes({ tcp: true, status: 401 })
    const result = await checkHostHealth(TARGET, f.probes)
    expect(result).toEqual({ healthy: false, tcp: true, httpStatus: 401, reason: 'http-unhealthy-status' })
  })

  test('no HTTP response (null status) is unhealthy', async () => {
    const f = probes({ tcp: true, status: null })
    const result = await checkHostHealth(TARGET, f.probes)
    expect(result).toEqual({ healthy: false, tcp: true, httpStatus: null, reason: 'http-no-response' })
  })

  test('a throwing probe degrades to false instead of propagating', async () => {
    const tcpThrow = probes({ tcpThrow: true })
    expect((await checkHostHealth(TARGET, tcpThrow.probes)).reason).toBe('tcp-failed')

    const httpThrow = probes({ tcp: true, httpThrow: true })
    expect((await checkHostHealth(TARGET, httpThrow.probes)).reason).toBe('http-no-response')
  })
})
