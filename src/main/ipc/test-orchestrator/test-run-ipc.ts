import { BrowserWindow, dialog, ipcMain } from 'electron'
import type { z } from 'zod'
import {
  answerPauseParamsSchema,
  clearRememberedSecretsParamsSchema,
  exportTestMapParamsSchema,
  forgetCapturesParamsSchema,
  getRunParamsSchema,
  getStepDetailParamsSchema,
  getTestMapParamsSchema,
  listConsoleTabsParamsSchema,
  loadTestMapParamsSchema,
  pickExportFileParamsSchema,
  pickTestMapFileParamsSchema,
  prepareParamsSchema,
  removeTestMapParamsSchema,
  resolveTargetsParamsSchema,
  saveQueriesParamsSchema,
  startRunParamsSchema,
  stopRunParamsSchema,
  testDatabaseParamsSchema,
  type TestRunErrorCode
} from '../../../shared/test-orchestrator/test-orchestrator-ipc-schemas'
import {
  getTestOrchestratorService,
  type TestOrchestratorService,
  type TestRunFailure
} from '../../test-orchestrator/test-orchestrator-service'
import {
  assertLocalWorkspace,
  type WorkspaceHostGuardStore
} from '../../workspace-local-host-guard'

export const TEST_RUN_EVENT_CHANNELS = {
  changed: 'testRun:changed',
  paused: 'testRun:paused',
  finished: 'testRun:finished',
  testMapChanged: 'testRun:testMapChanged'
} as const

export function broadcastTestRunEvent(
  channel: (typeof TEST_RUN_EVENT_CHANNELS)[keyof typeof TEST_RUN_EVENT_CHANNELS],
  payload: unknown
): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send(channel, payload)
    }
  }
}

function failure(code: TestRunErrorCode, message: string): TestRunFailure {
  return { ok: false, code, message }
}

function internalFailure(error: unknown): TestRunFailure {
  // Why: renderer-facing code set has no generic code; not-found is the closest non-retryable one.
  return failure('not-found', error instanceof Error ? error.message : 'Test run failed')
}

/** Parses the payload, rejects non-local workspaces, then runs `handler` (renderer input is untrusted). */
function handle<S extends z.ZodType<{ worktreeId: string }>, R>(
  orcaStore: WorkspaceHostGuardStore,
  channel: string,
  schema: S,
  handler: (params: z.output<S>, service: TestOrchestratorService) => Promise<R> | R
): void {
  ipcMain.handle(channel, async (_event, raw: unknown) => {
    const parsed = schema.safeParse(raw)
    if (!parsed.success) {
      return failure('invalid-test-map', parsed.error.issues[0]?.message ?? 'Invalid request')
    }
    const guard = assertLocalWorkspace(
      orcaStore,
      parsed.data.worktreeId,
      'The E2E test orchestrator'
    )
    if (!guard.ok) {
      return guard
    }
    try {
      return await handler(parsed.data, getTestOrchestratorService())
    } catch (error) {
      return internalFailure(error)
    }
  })
}

function owningWindow(): BrowserWindow | undefined {
  return BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
}

export function registerTestRunHandlers(orcaStore: WorkspaceHostGuardStore): void {
  // Why: the picker takes no worktreeId, so it validates {} and skips the host guard.
  ipcMain.handle('testRun:pickTestMapFile', async (_event, raw: unknown) => {
    if (!pickTestMapFileParamsSchema.safeParse(raw ?? {}).success) {
      return null
    }
    const options = {
      properties: ['openFile' as const],
      filters: [{ name: 'JSON', extensions: ['json'] }]
    }
    const owner = owningWindow()
    const result = owner
      ? await dialog.showOpenDialog(owner, options)
      : await dialog.showOpenDialog(options)
    const filePath = result.filePaths[0]
    return result.canceled || !filePath ? null : { filePath }
  })

  handle(orcaStore, 'testRun:pickExportFile', pickExportFileParamsSchema, async () => {
    const options = {
      defaultPath: 'test-map.json',
      filters: [{ name: 'JSON', extensions: ['json'] }]
    }
    const owner = owningWindow()
    const result = owner
      ? await dialog.showSaveDialog(owner, options)
      : await dialog.showSaveDialog(options)
    return result.canceled || !result.filePath ? null : { filePath: result.filePath }
  })

  handle(orcaStore, 'testRun:loadTestMap', loadTestMapParamsSchema, (p, s) => s.loadTestMap(p))
  handle(orcaStore, 'testRun:getTestMap', getTestMapParamsSchema, (p, s) => s.getTestMap(p))
  handle(orcaStore, 'testRun:saveQueries', saveQueriesParamsSchema, (p, s) => s.saveQueries(p))
  handle(orcaStore, 'testRun:exportTestMap', exportTestMapParamsSchema, (p, s) =>
    s.exportTestMap(p)
  )
  handle(orcaStore, 'testRun:removeTestMap', removeTestMapParamsSchema, (p, s) =>
    s.removeTestMap(p)
  )
  handle(orcaStore, 'testRun:prepare', prepareParamsSchema, (p, s) => s.prepare(p))
  handle(orcaStore, 'testRun:resolveTargets', resolveTargetsParamsSchema, (p, s) =>
    s.resolveTargets(p)
  )
  handle(orcaStore, 'testRun:testDatabase', testDatabaseParamsSchema, (p, s) => s.testDatabase(p))
  handle(orcaStore, 'testRun:listConsoleTabs', listConsoleTabsParamsSchema, (p, s) =>
    s.listConsoleTabs(p)
  )
  handle(orcaStore, 'testRun:clearRememberedSecrets', clearRememberedSecretsParamsSchema, (p, s) =>
    s.clearRememberedSecrets(p)
  )
  handle(orcaStore, 'testRun:start', startRunParamsSchema, (p, s) => s.start(p))
  handle(orcaStore, 'testRun:stop', stopRunParamsSchema, (p, s) => s.stop(p))
  handle(orcaStore, 'testRun:answerPause', answerPauseParamsSchema, (p, s) => s.answerPause(p))
  handle(orcaStore, 'testRun:getRun', getRunParamsSchema, (p, s) => s.getRun(p))
  handle(orcaStore, 'testRun:getStepDetail', getStepDetailParamsSchema, (p, s) =>
    s.getStepDetail(p)
  )
  handle(orcaStore, 'testRun:forgetCaptures', forgetCapturesParamsSchema, (p, s) =>
    s.forgetCaptures(p)
  )
}
