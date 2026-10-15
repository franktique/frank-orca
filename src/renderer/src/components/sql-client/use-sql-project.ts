import { useAppStore } from '@/store'
import { sqlConnectionStatusKey } from '@/store/slices/sql-client'
import type { SqlSnapshot } from '../../../../shared/sql-client/sql-client-ipc-schemas'
import type {
  SqlConnectionStatus,
  SqlConnectionView
} from '../../../../shared/sql-client/sql-client-types'

/** The project's snapshot for the worktree, once it has been loaded. */
export function useSqlSnapshot(worktreeId: string): SqlSnapshot | undefined {
  return useAppStore((state) => {
    const projectKey = state.sqlProjectKeyByWorktree[worktreeId]
    return projectKey ? state.sqlSnapshotsByProject[projectKey] : undefined
  })
}

/** Live status wins over the status the snapshot carried when it was fetched. */
export function useSqlConnectionStatus(
  worktreeId: string,
  connection: SqlConnectionView
): SqlConnectionStatus {
  return useAppStore((state) => {
    const projectKey = state.sqlProjectKeyByWorktree[worktreeId]
    const live = projectKey
      ? state.sqlConnectionStatusByKey[sqlConnectionStatusKey(projectKey, connection.id)]
      : undefined
    return live ?? connection.status
  })
}
