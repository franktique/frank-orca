import { BrowserWindow, dialog, ipcMain } from 'electron'
import type { z } from 'zod'
import {
  cancelParamsSchema,
  clearRunParamsSchema,
  getLatestRunParamsSchema,
  startRunParamsSchema,
  stopRunParamsSchema,
  envOpParamsSchema,
  exportParamsSchema,
  getLatestResultParamsSchema,
  getSnapshotParamsSchema,
  importFileParamsSchema,
  saveEnvironmentParamsSchema,
  saveRequestParamsSchema,
  sendParamsSchema,
  setActiveEnvironmentParamsSchema,
  treeOpParamsSchema,
  worktreeOnlyParamsSchema,
  type ApiClientFailure
} from '../../../shared/api-client/api-client-ipc-schemas'
import { exportPostmanFile } from '../../api-client/api-client-export'
import { importPostmanContent, readPostmanFile } from '../../api-client/api-client-import'
import { envOp, saveEnvironment, saveRequest, treeOp } from '../../api-client/api-client-operations'
import { readLatestResult, readLatestRun } from '../../api-client/api-client-results'
import { getApiClientService, initApiClientService } from '../../api-client/api-client-service'
import type { ApiClientServiceDeps } from '../../api-client/api-client-service'

export const API_CLIENT_CHANNELS = {
  changed: 'apiClient:changed',
  executionFinished: 'apiClient:executionFinished',
  consoleAppended: 'apiClient:consoleAppended',
  runProgress: 'apiClient:runProgress',
  runFinished: 'apiClient:runFinished'
} as const

function invalid(error: z.ZodError): ApiClientFailure {
  return {
    ok: false,
    code: 'invalid-request',
    message: error.issues[0]?.message ?? 'Invalid request'
  }
}

/**
 * Validates the payload, enforces the local-workspace rule, then runs `handler`.
 * Renderer payloads are untrusted, so nothing reaches the store unparsed.
 */
function handle<S extends z.ZodType<{ worktreeId: string }>, R>(
  channel: string,
  schema: S,
  handler: (params: z.output<S>) => Promise<R> | R
): void {
  ipcMain.handle(channel, async (_event, raw: unknown) => {
    const parsed = schema.safeParse(raw)
    if (!parsed.success) {
      return invalid(parsed.error)
    }
    const guard = getApiClientService().assertLocal(parsed.data.worktreeId)
    if (!guard.ok) {
      return guard
    }
    return handler(parsed.data)
  })
}

function broadcast(channel: string, payload: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send(channel, payload)
    }
  }
}

const SHOW_REPLY_TIMEOUT_MS = 5000
const pendingShowReplies = new Map<
  string,
  (reply: { ok: true; tabId: string } | { ok: false; message: string }) => void
>()

/** Asks the renderer to show a request and waits for the tab id it answers with. */
function requestShowInRenderer(
  replyId: string,
  worktreeId: string,
  requestId: string
): Promise<{ ok: true; tabId: string } | { ok: false; message: string }> {
  const window = BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed())
  if (!window) {
    return Promise.resolve({ ok: false, message: 'No Orca window is open.' })
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pendingShowReplies.delete(replyId)
      resolve({ ok: false, message: 'The Orca window did not answer in time.' })
    }, SHOW_REPLY_TIMEOUT_MS)
    pendingShowReplies.set(replyId, (reply) => {
      clearTimeout(timer)
      pendingShowReplies.delete(replyId)
      resolve(reply)
    })
    // Why a plain send: this never focuses or raises the window (the user's desktop stays put).
    window.webContents.send('apiClient:show', { replyId, worktreeId, requestId })
  })
}

export function registerApiClientHandlers(orcaStore: ApiClientServiceDeps['orcaStore']): void {
  const service = initApiClientService({ orcaStore })
  service.onEvent((event) => broadcast(API_CLIENT_CHANNELS[event.channel], event.payload))
  service.setShowHandler((worktreeId, requestId) =>
    requestShowInRenderer(service.store.newId(), worktreeId, requestId)
  )
  ipcMain.on(
    'apiClient:showReply',
    (_event, reply: { replyId: string; tabId?: string; error?: string }) => {
      const resolve = pendingShowReplies.get(reply.replyId)
      if (!resolve) {
        return
      }
      resolve(
        reply.tabId
          ? { ok: true, tabId: reply.tabId }
          : { ok: false, message: reply.error ?? 'The request could not be shown.' }
      )
    }
  )

  handle('apiClient:getSnapshot', getSnapshotParamsSchema, async (params) => {
    const { secretProtection, ...data } = await service.store.getSnapshot(params.worktreeId, {
      revealSecrets: params.revealSecrets
    })
    return { ok: true as const, data, ...(secretProtection ? { secretProtection } : {}) }
  })

  handle('apiClient:setActiveEnvironment', setActiveEnvironmentParamsSchema, (params) =>
    service.store.setActiveEnvironment(params.worktreeId, params.environmentId)
  )

  handle('apiClient:importFile', importFileParamsSchema, async (params) => {
    const loaded = await readPostmanFile(params.filePath)
    if (!loaded.ok) {
      return loaded
    }
    return importPostmanContent(service.store, params.worktreeId, loaded.json, params.onDuplicate)
  })

  handle('apiClient:export', exportParamsSchema, (params) =>
    exportPostmanFile(service.store, params)
  )

  handle('apiClient:treeOp', treeOpParamsSchema, (params) => treeOp(service.store, params))

  handle('apiClient:saveRequest', saveRequestParamsSchema, (params) =>
    saveRequest(service.store, params)
  )

  handle('apiClient:envOp', envOpParamsSchema, (params) => envOp(service.store, params))

  handle('apiClient:saveEnvironment', saveEnvironmentParamsSchema, (params) =>
    saveEnvironment(service.store, params)
  )

  handle('apiClient:send', sendParamsSchema, (params) => service.startSend(params))

  handle('apiClient:cancel', cancelParamsSchema, (params) => ({
    ok: true as const,
    cancelled: service.cancel(params.executionId)
  }))

  handle('apiClient:getLatestResult', getLatestResultParamsSchema, async (params) => ({
    ok: true as const,
    result: await readLatestResult(service.store, params.worktreeId, params.requestId)
  }))

  handle('apiClient:getLatestRun', getLatestRunParamsSchema, async (params) => ({
    ok: true as const,
    run: await readLatestRun(service.store, params.worktreeId, params.scopeId)
  }))

  handle('apiClient:startRun', startRunParamsSchema, async (params) => {
    const started = await service.runner.start({ ...params, origin: 'manual' })
    return started.ok ? { ok: true as const, runId: started.runId } : started
  })

  handle('apiClient:stopRun', stopRunParamsSchema, (params) => ({
    ok: true as const,
    stopped: service.runner.stop(params.runId)
  }))

  handle('apiClient:clearRun', clearRunParamsSchema, async (params) => {
    await service.runner.clear(params.worktreeId, params.scopeId)
    return { ok: true as const }
  })

  handle('apiClient:getConsole', worktreeOnlyParamsSchema, (params) => ({
    ok: true as const,
    entries: service.console.list(params.worktreeId)
  }))

  handle('apiClient:clearConsole', worktreeOnlyParamsSchema, (params) => {
    service.console.clear(params.worktreeId)
    return { ok: true as const }
  })

  // Why here and not in the shell bridge: the dialog is part of this feature's JSON-only contract.
  ipcMain.handle('apiClient:pickImportFile', async (event): Promise<string | null> => {
    const owner = BrowserWindow.fromWebContents(event.sender)
    const options: Electron.OpenDialogOptions = {
      properties: ['openFile'],
      filters: [{ name: 'Postman JSON', extensions: ['json'] }]
    }
    const result = owner
      ? await dialog.showOpenDialog(owner, options)
      : await dialog.showOpenDialog(options)
    return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0]
  })

  ipcMain.handle('apiClient:pickExportFile', async (event, defaultName: unknown) => {
    const owner = BrowserWindow.fromWebContents(event.sender)
    const options: Electron.SaveDialogOptions = {
      defaultPath: typeof defaultName === 'string' ? defaultName : 'postman.json',
      filters: [{ name: 'Postman JSON', extensions: ['json'] }]
    }
    const result = owner
      ? await dialog.showSaveDialog(owner, options)
      : await dialog.showSaveDialog(options)
    return result.canceled || !result.filePath ? null : result.filePath
  })
}
