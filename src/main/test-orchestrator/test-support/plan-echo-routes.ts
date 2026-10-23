import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'

export type PlanEchoServer = {
  baseUrl: string
  close: () => Promise<void>
}

const EXPIRED_TOKEN_KEY = 'expired'

function readBody(req: IncomingMessage): Promise<void> {
  return new Promise((resolve, reject) => {
    req.on('data', () => {})
    req.on('end', () => resolve())
    req.on('error', reject)
  })
}

function sendJson(res: ServerResponse, status: number, body?: unknown): void {
  if (body === undefined) {
    res.writeHead(status)
    res.end()
    return
  }
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

export async function startPlanEchoServer(): Promise<PlanEchoServer> {
  let nextCaseId = 1
  let raceCalls = 0
  let deleteFails = false
  // Token seen when /expire-token was called; later calls with it get 401 until a new value arrives.
  const state = new Map<string, string>()

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const path = url.pathname
    const method = req.method ?? 'GET'
    await readBody(req)

    if (path === '/expire-token') {
      state.set(EXPIRED_TOKEN_KEY, req.headers.authorization ?? '')
      sendJson(res, 200, { expired: true })
      return
    }
    if (path === '/delete-fails') {
      deleteFails = url.searchParams.get('on') !== 'false'
      sendJson(res, 200, { deleteFails })
      return
    }
    if (path === '/health') {
      sendJson(res, 200, { ok: true })
      return
    }
    if (path === '/reset') {
      nextCaseId = 1
      raceCalls = 0
      deleteFails = false
      state.clear()
      sendJson(res, 200, { reset: true })
      return
    }

    const expired = state.get(EXPIRED_TOKEN_KEY)
    if (expired !== undefined && req.headers.authorization === expired) {
      sendJson(res, 401, { code: 'UNAUTHORIZED' })
      return
    }

    if (method === 'POST' && path === '/cases') {
      sendJson(res, 200, { id: `case-${nextCaseId++}` })
    } else if (method === 'POST' && path === '/bulk') {
      sendJson(res, 201, { data: { requestId: 'req-1' } })
    } else if (method === 'POST' && path === '/duplicate') {
      sendJson(res, 422, { code: 'AM00109' })
    } else if (method === 'POST' && path === '/race') {
      // The first of each concurrent pair wins; the second conflicts.
      const first = raceCalls++ % 2 === 0
      sendJson(res, first ? 201 : 409, first ? { ok: true } : { code: 'AM00107' })
    } else if (method === 'DELETE' && path.startsWith('/cases/')) {
      sendJson(res, deleteFails ? 500 : 204)
    } else {
      sendJson(res, 404, { error: 'not found' })
    }
  }

  const server = createServer((req, res) => {
    handle(req, res).catch(() => {
      if (!res.headersSent) {
        sendJson(res, 500, { error: 'handler failed' })
      } else {
        res.destroy()
      }
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('plan echo server did not bind to a TCP port')
  }
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      })
  }
}
