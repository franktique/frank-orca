import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PreparedRequest } from '../../shared/api-client/request-preparation'
import { HttpRequestSender, type FetchFunction } from './http-request-sender'
import { startLocalEchoServer, type LocalEchoServer } from './test-support/local-echo-server'

let server: LocalEchoServer

beforeAll(async () => {
  server = await startLocalEchoServer()
})

afterAll(async () => {
  await server.close()
})

const nodeFetch: FetchFunction = (url, init) => fetch(url, init)
const sender = new HttpRequestSender(() => nodeFetch)

function prepared(path: string, overrides: Partial<PreparedRequest> = {}): PreparedRequest {
  return {
    method: 'GET',
    url: `${server.baseUrl}${path}`,
    headers: [],
    body: { kind: 'none' },
    unresolved: [],
    ...overrides
  }
}

const send = (request: PreparedRequest, extra: Partial<Parameters<typeof sender.send>[0]> = {}) =>
  sender.send({
    prepared: request,
    verifySsl: true,
    followRedirects: true,
    timeoutMs: 5000,
    ...extra
  })

describe('HttpRequestSender', () => {
  it('sends the resolved request and reads a JSON response', async () => {
    const result = await send(
      prepared('/echo', {
        method: 'POST',
        headers: [
          ['X-Custom', 'yes'],
          ['Content-Type', 'application/json']
        ],
        body: { kind: 'text', text: '{"a":1}' }
      })
    )
    if (!result.ok) {
      throw new Error(result.message)
    }
    expect(result.response.status).toBe(200)
    expect(result.response.body.encoding).toBe('utf8')
    const echoed = JSON.parse(result.response.body.text ?? '{}')
    expect(echoed).toMatchObject({ method: 'POST', body: '{"a":1}' })
    expect(echoed.headers['x-custom']).toBe('yes')
    expect(result.ttfbMs).not.toBeNull()
  })

  it('follows redirects manually and records every hop', async () => {
    const result = await send(prepared('/redirect/3'))
    if (!result.ok) {
      throw new Error(result.message)
    }
    expect(result.response.status).toBe(200)
    expect(result.response.redirects.map((hop) => hop.status)).toEqual([302, 302, 302])
  })

  it('stops after 10 redirects', async () => {
    const result = await send(prepared('/redirect/12'))
    expect(result).toMatchObject({ ok: false, code: 'network' })
    if (!result.ok) {
      expect(result.message).toContain('10 redirects')
    }
  })

  it('returns the redirect itself when following is turned off', async () => {
    const result = await send(prepared('/redirect/2'), { followRedirects: false })
    if (!result.ok) {
      throw new Error(result.message)
    }
    expect(result.response.status).toBe(302)
    expect(result.response.redirects).toEqual([])
  })

  it('caps the body at 10 MB and flags truncation', async () => {
    const result = await send(prepared('/large/12'))
    if (!result.ok) {
      throw new Error(result.message)
    }
    expect(result.response.body.truncated).toBe(true)
    expect(result.response.body.text?.length).toBe(10 * 1024 * 1024)
  })

  it('detects binary bodies', async () => {
    const result = await send(prepared('/binary'))
    if (!result.ok) {
      throw new Error(result.message)
    }
    expect(result.response.body.encoding).toBe('base64')
    expect(Buffer.from(result.response.body.text ?? '', 'base64')).toEqual(
      Buffer.from([0xff, 0xfe, 0x00, 0x01, 0x80, 0x81])
    )
  })

  it('reports a cancelled request', async () => {
    const controller = new AbortController()
    const pending = send(prepared('/delay/2000'), { signal: controller.signal })
    setTimeout(() => controller.abort(), 50)
    expect(await pending).toMatchObject({ ok: false, code: 'cancelled' })
  })

  it('reports a timeout', async () => {
    expect(await send(prepared('/delay/1000'), { timeoutMs: 50 })).toMatchObject({
      ok: false,
      code: 'timeout'
    })
  })

  it('reports a closed port as a network error', async () => {
    const other = await startLocalEchoServer()
    const url = `${other.baseUrl}/echo`
    await other.close()
    expect(await send(prepared('', { url }))).toMatchObject({ ok: false, code: 'network' })
  })

  it('maps certificate failures and points at the SSL switch', async () => {
    const failing = new HttpRequestSender(() => () => {
      throw new Error('net::ERR_CERT_AUTHORITY_INVALID')
    })
    const result = await failing.send({
      prepared: prepared('/echo'),
      verifySsl: true,
      followRedirects: true,
      timeoutMs: 1000
    })
    expect(result).toMatchObject({ ok: false, code: 'certificate' })
    if (!result.ok) {
      expect(result.message).toContain('SSL')
    }
  })

  it('maps name resolution failures', async () => {
    const failing = new HttpRequestSender(() => () => {
      throw new Error('net::ERR_NAME_NOT_RESOLVED')
    })
    expect(
      await failing.send({
        prepared: prepared('/echo'),
        verifySsl: true,
        followRedirects: true,
        timeoutMs: 1000
      })
    ).toMatchObject({ ok: false, code: 'dns' })
  })

  it('drops headers Chromium forbids and says so', async () => {
    const result = await send(
      prepared('/echo', {
        headers: [
          ['Host', 'evil'],
          ['Content-Length', '3'],
          ['X-Ok', '1']
        ]
      })
    )
    if (!result.ok) {
      throw new Error(result.message)
    }
    expect(result.droppedHeaders).toEqual(['Host', 'Content-Length'])
    const echoed = JSON.parse(result.response.body.text ?? '{}')
    expect(echoed.headers['x-ok']).toBe('1')
    expect(echoed.headers.host).not.toBe('evil')
  })

  it('rejects URLs that are not http(s)', async () => {
    expect(await send(prepared('', { url: 'not a url' }))).toMatchObject({
      ok: false,
      code: 'invalid-url'
    })
    expect(await send(prepared('', { url: 'ftp://example.com/x' }))).toMatchObject({
      ok: false,
      code: 'invalid-url'
    })
  })
})
