import path from 'node:path'
import type { SqlAgentAccess } from './sql-client-types'

const IPV4_LOOPBACK = /^127(?:\.\d{1,3}){3}$/

/** `full` only for hosts that are this machine; everything else is read-only for agents (FR-032a). */
export function getSqlAgentAccess(host: string): SqlAgentAccess {
  const trimmed = host.trim()
  const lower = trimmed.toLowerCase()
  if (lower === 'localhost' || lower === '::1' || lower === '[::1]') {
    return 'full'
  }
  if (IPV4_LOOPBACK.test(trimmed) && trimmed.split('.').every((part) => Number(part) <= 255)) {
    return 'full'
  }
  // Unix-socket hosts exist on macOS/Linux only; a Windows drive path is not a socket.
  if (path.posix.isAbsolute(trimmed)) {
    return 'full'
  }
  return 'read-only'
}
