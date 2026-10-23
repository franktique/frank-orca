import type { RunSensitiveValues } from '../../../shared/test-orchestrator/run-sensitive-values'
import type {
  QueryEvidence,
  TestPlanStep,
  VerificationQuery
} from '../../../shared/test-orchestrator/test-orchestrator-types'

export type QueryRunContext = {
  /** The query text after variable substitution; `query.sql` is the unresolved original. */
  sql: string
  step: Pick<TestPlanStep, 'stepId' | 'approvedDataChange'>
  side: 'before' | 'after'
  signal: AbortSignal
  masker: Pick<RunSensitiveValues, 'maskText'>
}

export type QueryRunnerPrepareResult = { ok: true } | { ok: false; message: string }

/** One implementation per database mode; a run prepares once, runs queries in order, then disposes. */
export type DatabaseQueryRunner = {
  prepare: () => Promise<QueryRunnerPrepareResult>
  /** Never throws: every failure comes back as evidence. */
  run: (query: VerificationQuery, context: QueryRunContext) => Promise<QueryEvidence>
  dispose: () => Promise<void>
}
