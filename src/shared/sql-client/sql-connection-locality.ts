import path from 'node:path'
import { isLocalHost } from '../host-locality'
import type { SqlAgentAccess } from './sql-client-types'

/** `full` only for hosts that are this machine; everything else is read-only for agents (FR-032a). */
export function getSqlAgentAccess(host: string): SqlAgentAccess {
  const trimmed = host.trim()
  // A wildcard bind address is not a server this machine is known to host (SQL keeps it read-only).
  if (trimmed !== '0.0.0.0' && isLocalHost(trimmed)) {
    return 'full'
  }
  // Unix-socket hosts exist on macOS/Linux only; a Windows drive path is not a socket.
  if (path.posix.isAbsolute(trimmed)) {
    return 'full'
  }
  return 'read-only'
}
