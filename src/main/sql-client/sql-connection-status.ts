import type { SqlConnectionStatusEvent } from '../../shared/sql-client/sql-client-ipc-schemas'
import type { SqlConnectionStatus } from '../../shared/sql-client/sql-client-types'

const IDLE: SqlConnectionStatus = { state: 'idle' }

/** Live per-connection status; emits only when it actually changes. */
export class SqlConnectionStatusTracker {
  private readonly statuses = new Map<string, SqlConnectionStatus>()

  constructor(private readonly emit: (event: SqlConnectionStatusEvent) => void) {}

  get(connectionId: string): SqlConnectionStatus {
    return this.statuses.get(connectionId) ?? IDLE
  }

  set(projectKey: string, connectionId: string, status: SqlConnectionStatus): void {
    const current = this.get(connectionId)
    if (
      current.state === status.state &&
      !('message' in status && 'message' in current && status.message !== current.message)
    ) {
      return
    }
    this.statuses.set(connectionId, status)
    this.emit({
      projectKey,
      connectionId,
      status,
      ...(status.state === 'error'
        ? { error: { message: status.message, ...(status.code ? { code: status.code } : {}) } }
        : {})
    })
  }
}
