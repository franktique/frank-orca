import { session, type Session } from 'electron'
import type { FetchFunction } from './http-request-sender'

const VERIFIED_PARTITION = 'orca-api-client'
const UNVERIFIED_PARTITION = 'orca-api-client-insecure'

let verifiedSession: Session | null = null
let unverifiedSession: Session | null = null

// Why dedicated in-memory partitions: Chromium applies the OS proxy (including PAC) on its own, and
// API Client cookies stay out of the app's own sessions. `net.fetch` always uses the default session,
// so `ses.fetch` on a chosen partition is the only way to pick the certificate policy per request.
function getApiClientSession(verifySsl: boolean): Session {
  if (verifySsl) {
    verifiedSession ??= session.fromPartition(VERIFIED_PARTITION)
    return verifiedSession
  }
  if (!unverifiedSession) {
    unverifiedSession = session.fromPartition(UNVERIFIED_PARTITION)
    // 0 accepts the certificate without further checks.
    unverifiedSession.setCertificateVerifyProc((_request, callback) => callback(0))
  }
  return unverifiedSession
}

export function electronFetchFor(verifySsl: boolean): FetchFunction {
  const ses = getApiClientSession(verifySsl)
  return (url, init) => ses.fetch(url, init)
}
