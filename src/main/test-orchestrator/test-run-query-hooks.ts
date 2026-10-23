// Builds the per-run database hooks and the "Test" check for each database mode (US3-US5, FR-006).
import type { SqlConnection } from '../../shared/sql-client/sql-client-types'
import type { TestRunErrorCode } from '../../shared/test-orchestrator/test-orchestrator-ipc-schemas'
import type { DatabaseModeChoice } from '../../shared/test-orchestrator/test-orchestrator-types'
import { createAutomaticQueryRunner } from './database-modes/automatic-query-runner'
import {
  createBrowserConsoleDriver,
  type BrowserConsoleBridge
} from './database-modes/browser-console-driver'
import { createBrowserQueryHooks } from './database-modes/browser-query-runner'
import { createManualQueryHooks } from './database-modes/manual-query-runner'
import { createQueryStepHooks } from './database-modes/query-step-hooks'
import type { QueryHooksRequest, QueryHooksResult } from './test-run-service-types'

type Failure = { ok: false; code: TestRunErrorCode; message: string; screenshot?: string }

export type DatabaseModeDeps = {
  sql: {
    /** `password: null` means the user must re-enter it in the SQL tab. */
    getConnectionForRun: (
      projectKey: string,
      connectionId: string
    ) => Promise<
      { connection: SqlConnection; password: string | null } | { ok: false; message: string }
    >
    testConnection: (
      projectKey: string,
      connectionId: string
    ) => Promise<{ ok: true } | { ok: false; message: string }>
  }
  browserBridge: BrowserConsoleBridge
}

const failure = (code: TestRunErrorCode, message: string, screenshot?: string): Failure => ({
  ok: false,
  code,
  message,
  ...(screenshot ? { screenshot } : {})
})

async function resolveConnection(
  deps: DatabaseModeDeps,
  choice: Extract<DatabaseModeChoice, { mode: 'automatic' }>
): Promise<{ ok: true; connection: SqlConnection; password: string } | Failure> {
  const found = await deps.sql.getConnectionForRun(choice.projectKey, choice.connectionId)
  if ('ok' in found) {
    return failure('connection-failed', found.message)
  }
  if (found.password === null) {
    return failure(
      'connection-failed',
      'The saved password for this connection cannot be read. Enter it again in the SQL tab.'
    )
  }
  return { ok: true, connection: found.connection, password: found.password }
}

async function automaticHooks(
  deps: DatabaseModeDeps,
  choice: Extract<DatabaseModeChoice, { mode: 'automatic' }>,
  request: QueryHooksRequest
): Promise<QueryHooksResult | Failure> {
  const resolved = await resolveConnection(deps, choice)
  if (!resolved.ok) {
    return resolved
  }
  const runner = createAutomaticQueryRunner({
    connection: resolved.connection,
    password: resolved.password,
    testConnection: () => deps.sql.testConnection(choice.projectKey, choice.connectionId)
  })
  const hooks = createQueryStepHooks({ runner, capture: request.capture })
  return { ok: true, hooks, dispose: hooks.dispose, connectionName: resolved.connection.name }
}

function browserHooks(
  deps: DatabaseModeDeps,
  request: QueryHooksRequest
): QueryHooksResult | Failure {
  const { browserPageId } = request
  if (!browserPageId) {
    return failure('console-not-found', 'Pick the browser tab that has your database console open.')
  }
  const createDriver = (pageId: string) =>
    createBrowserConsoleDriver({
      bridge: deps.browserBridge,
      worktreeId: request.worktreeId,
      browserPageId: pageId,
      hints: request.context.testMap?.databaseConsole
    })
  if (!createDriver(browserPageId).isTabOpen()) {
    return failure('console-not-found', 'The selected browser tab is no longer open.')
  }
  return {
    ok: true,
    hooks: createBrowserQueryHooks({ createDriver, browserPageId, capture: request.capture })
  }
}

export async function buildQueryHooks(
  deps: DatabaseModeDeps,
  request: QueryHooksRequest
): Promise<QueryHooksResult | Failure> {
  const choice = request.database
  switch (choice?.mode) {
    case 'automatic':
      return automaticHooks(deps, choice, request)
    case 'browser':
      return browserHooks(deps, request)
    case 'manual':
      return { ok: true, hooks: createManualQueryHooks() }
    case undefined:
      return { ok: true }
  }
}

async function screenshotDataUrl(
  deps: DatabaseModeDeps,
  worktreeId: string,
  browserPageId: string
): Promise<string | undefined> {
  try {
    const shot = await deps.browserBridge.screenshot('png', worktreeId, browserPageId)
    return `data:image/png;base64,${shot.data}`
  } catch {
    return undefined
  }
}

export async function checkDatabaseMode(
  deps: DatabaseModeDeps,
  params: { worktreeId: string; mode: DatabaseModeChoice; browserPageId?: string }
): Promise<{ ok: true } | Failure> {
  const { mode } = params
  if (mode.mode === 'manual') {
    return { ok: true }
  }
  if (mode.mode === 'automatic') {
    const resolved = await resolveConnection(deps, mode)
    if (!resolved.ok) {
      return resolved
    }
    const tested = await deps.sql.testConnection(mode.projectKey, mode.connectionId)
    return tested.ok ? { ok: true } : failure('connection-failed', tested.message)
  }
  const { browserPageId, worktreeId } = params
  if (!browserPageId) {
    return failure('console-not-found', 'Pick the browser tab that has your database console open.')
  }
  const driver = createBrowserConsoleDriver({
    bridge: deps.browserBridge,
    worktreeId,
    browserPageId
  })
  if (!driver.isTabOpen()) {
    return failure('console-not-found', 'The selected browser tab is no longer open.')
  }
  const located = await driver.locate()
  if (located.ok) {
    return { ok: true }
  }
  return failure(
    'console-not-found',
    located.message,
    await screenshotDataUrl(deps, worktreeId, browserPageId)
  )
}
