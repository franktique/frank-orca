import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'

export type LocalEchoServer = {
  baseUrl: string
  close: () => Promise<void>
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const [, route = '', arg = ''] = url.pathname.split('/')

  switch (route) {
    case 'echo': {
      const body = await readBody(req)
      sendJson(res, 200, {
        method: req.method,
        url: req.url,
        headers: req.headers,
        body
      })
      return
    }
    case 'status': {
      const code = Number.parseInt(arg, 10)
      sendJson(res, Number.isInteger(code) ? code : 400, { status: code })
      return
    }
    case 'delay': {
      const ms = Number.parseInt(arg, 10) || 0
      const timer = setTimeout(() => sendJson(res, 200, { delayedMs: ms }), ms)
      res.on('close', () => clearTimeout(timer))
      return
    }
    case 'large': {
      const megabytes = Number.parseInt(arg, 10) || 1
      res.writeHead(200, { 'content-type': 'application/json' })
      const chunk = 'x'.repeat(1024 * 1024)
      res.write('{"data":"')
      for (let i = 0; i < megabytes; i++) {
        res.write(chunk)
      }
      res.end('"}')
      return
    }
    case 'binary': {
      res.writeHead(200, { 'content-type': 'application/octet-stream' })
      res.end(Buffer.from([0xff, 0xfe, 0x00, 0x01, 0x80, 0x81]))
      return
    }
    case 'redirect': {
      const remaining = Number.parseInt(arg, 10) || 0
      if (remaining <= 0) {
        sendJson(res, 200, { redirected: true })
        return
      }
      res.writeHead(302, { location: `/redirect/${remaining - 1}` })
      res.end()
      return
    }
    case 'token':
      sendJson(res, 200, { token: 'test-token-value' })
      return
    default:
      sendJson(res, 404, { error: 'not found' })
  }
}

export async function startLocalEchoServer(): Promise<LocalEchoServer> {
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
    throw new Error('echo server did not bind to a TCP port')
  }
  const { port } = address
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      })
  }
}
