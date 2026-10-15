import { BrowserWindow, ipcMain } from 'electron'
import type { z } from 'zod'
import type { SqlClientFailure } from '../../../shared/sql-client/sql-client-ipc-schemas'
import { getSqlClientService } from '../../sql-client/sql-client-service'

export const SQL_CLIENT_CHANNELS = {
  changed: 'sqlClient:changed',
  connectionStatus: 'sqlClient:connectionStatus'
} as const

function invalid(error: z.ZodError): SqlClientFailure {
  return { ok: false, code: 'invalid', message: error.issues[0]?.message ?? 'Invalid request' }
}

/**
 * Validates the payload, rejects non-local workspaces, resolves the project key in main,
 * then runs `handler`. Renderer payloads are untrusted, so nothing reaches the store unparsed.
 */
export function handleSqlChannel<S extends z.ZodType<{ worktreeId: string }>, R>(
  channel: string,
  schema: S,
  handler: (params: z.output<S>, projectKey: string) => Promise<R> | R
): void {
  ipcMain.handle(channel, async (_event, raw: unknown) => {
    const parsed = schema.safeParse(raw)
    if (!parsed.success) {
      return invalid(parsed.error)
    }
    const project = getSqlClientService().resolveProject(parsed.data.worktreeId)
    if (!project.ok) {
      return project
    }
    return handler(parsed.data, project.projectKey)
  })
}

export function broadcastSqlEvent(channel: string, payload: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send(channel, payload)
    }
  }
}
