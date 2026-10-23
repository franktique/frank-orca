// Production wiring for test runs: real request sender, window broadcasts, evidence session.
import { app } from 'electron'
import { parseWorkspaceKey } from '../../shared/workspace-scope'
import type { ApiClientService } from '../api-client/api-client-service'
import { executeRequest } from '../api-client/request-execution'
import { broadcastTestRunEvent } from '../ipc/test-orchestrator/test-run-ipc'
import { testSqlConnection } from '../sql-client/sql-connection-test'
import { getSqlClientService } from '../sql-client/sql-client-service'
import { createRunEvidenceSession } from './run-evidence-session'
import { buildQueryHooks, checkDatabaseMode, type DatabaseModeDeps } from './test-run-query-hooks'
import type { TestRunRuntime } from './test-run-service-types'

// Why: the SQL service starts after this runtime is built, so it is looked up per call.
function createSqlAccess(): DatabaseModeDeps['sql'] {
  return {
    getConnectionForRun: (projectKey, id) =>
      getSqlClientService().store.getConnectionForRun(projectKey, id),
    testConnection: async (projectKey, id) => {
      const tested = await testSqlConnection(getSqlClientService().store, projectKey, { id })
      return tested.ok ? { ok: true } : { ok: false, message: tested.message }
    }
  }
}

export function createTestRunRuntime(
  apiClient: Pick<ApiClientService, 'executionDeps'>,
  browserBridge: DatabaseModeDeps['browserBridge']
): TestRunRuntime {
  const modeDeps: DatabaseModeDeps = { sql: createSqlAccess(), browserBridge }
  return {
    createQueryHooks: (request) => buildQueryHooks(modeDeps, request),
    testDatabase: (params) => checkDatabaseMode(modeDeps, params),
    sendRequest: (input) => executeRequest(apiClient.executionDeps(), input),
    emit: {
      changed: (event) => broadcastTestRunEvent('testRun:changed', event),
      paused: (event) => broadcastTestRunEvent('testRun:paused', event),
      finished: (event) => broadcastTestRunEvent('testRun:finished', event)
    },
    openEvidence: (run, input) =>
      createRunEvidenceSession({
        worktreeId: input.worktreeId,
        planName: input.planName ?? run.collectionId,
        isFolderWorkspace: parseWorkspaceKey(input.worktreeId)?.type === 'folder',
        orcaVersion: app.getVersion()
      })(run)
  }
}
