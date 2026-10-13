import { createServer } from 'node:https'
import {
  LOCAL_HTTPS_TEST_CERTIFICATE,
  LOCAL_HTTPS_TEST_PRIVATE_KEY
} from '../../browser/browser-local-https-test-certificate'

export type LocalSelfSignedHttpsServer = {
  baseUrl: string
  close: () => Promise<void>
}

/** Serves 127.0.0.1 with a certificate no store trusts, so verification must fail. */
export async function startLocalSelfSignedHttpsServer(): Promise<LocalSelfSignedHttpsServer> {
  const server = createServer(
    { key: LOCAL_HTTPS_TEST_PRIVATE_KEY, cert: LOCAL_HTTPS_TEST_CERTIFICATE },
    (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end('{"secure":true}')
    }
  )
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') {
    throw new Error('server did not report a TCP address')
  }
  return {
    baseUrl: `https://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve()))
  }
}
