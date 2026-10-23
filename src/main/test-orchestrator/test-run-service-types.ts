// Contracts between TestRunService and the runtime/database-mode seams that plug into it.
import type { z } from 'zod'
import type { ApiNodeId } from '../../shared/api-client/api-client-types'
import type {
  testDatabaseParamsSchema,
  TestRunErrorCode
} from '../../shared/test-orchestrator/test-orchestrator-ipc-schemas'
import type {
  DatabaseModeChoice,
  TestMap
} from '../../shared/test-orchestrator/test-orchestrator-types'
import type { TestMapStore } from './test-map-store'
import type { TestRunOrchestratorDeps } from './test-run-orchestrator-types'
import type { StepEvidenceCapture, StepQueryHooks } from './test-run-step-executor'
import type { PlanApiState, PlanContext } from './test-run-plan-context'

export type Failure = { ok: false; code: TestRunErrorCode; message: string; screenshot?: string }

export const failure = (code: TestRunErrorCode, message: string): Failure => ({
  ok: false,
  code,
  message
})

export type Params<S extends z.ZodType> = z.output<S>

/** What a database mode needs to build query hooks for one run (US3/US4 fill this in). */
export type QueryHooksRequest = {
  worktreeId: string
  collectionId: ApiNodeId
  context: PlanContext
  database: DatabaseModeChoice | null
  browserPageId?: string
  /** Late-bound to the run's evidence session; use it only while the run is active. */
  capture: StepEvidenceCapture
}

export type QueryHooksResult = {
  ok: true
  hooks?: StepQueryHooks
  /** Called once when the run ends or fails to start. */
  dispose?: () => Promise<void>
  /** Automatic mode: the connection's display name for the report. */
  connectionName?: string
}

export type TestRunRuntime = {
  sendRequest: TestRunOrchestratorDeps['sendRequest']
  emit: TestRunOrchestratorDeps['emit']
  openEvidence?: TestRunOrchestratorDeps['openEvidence']
  /** Seam for the database modes; absent means runs are request-only. */
  createQueryHooks?: (request: QueryHooksRequest) => Promise<QueryHooksResult | Failure>
  /** The "Test" button's check for a database mode. */
  testDatabase?: (
    params: Params<typeof testDatabaseParamsSchema>
  ) => Promise<{ ok: true } | Failure>
  now?: () => number
  changedThrottleMs?: number
}

export type TestRunServiceDeps = {
  store: TestMapStore
  apiClient: { store: { getState(worktreeId: string): Promise<PlanApiState> } }
  getTestMap: (worktreeId: string, collectionId: ApiNodeId) => Promise<TestMap | null>
  runtime?: TestRunRuntime
}
