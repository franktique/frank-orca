// Adapts a DatabaseQueryRunner to the step executor's before/after hooks (FR-014).
import { truncateRows } from '../../../shared/test-orchestrator/evidence-truncation'
import type {
  QueryEvidence,
  TestPlanStep,
  VerificationQuery
} from '../../../shared/test-orchestrator/test-orchestrator-types'
import type {
  BeforeQueriesResult,
  StepEvidenceCapture,
  StepHookContext,
  StepQueryHooks
} from '../test-run-step-executor'
import type { DatabaseQueryRunner, QueryRunnerPrepareResult } from './database-query-runner'

export type QueryStepHooksOptions = {
  runner: DatabaseQueryRunner
  /** Screenshots of each query card; pass only in Automatic mode. */
  capture?: StepEvidenceCapture
}

export type QueryStepHooks = StepQueryHooks & {
  /** Releases the runner; call once at run end, also after an error. */
  dispose: () => Promise<void>
}

type Side = 'before' | 'after'

function failedEvidence(
  query: VerificationQuery,
  sql: string,
  message: string,
  context: StepHookContext
): QueryEvidence {
  return {
    queryId: query.id,
    ...(query.description === undefined
      ? {}
      : { description: context.sensitive.maskText(query.description) }),
    sqlResolved: context.sensitive.maskText(sql),
    how: 'failed',
    result: null,
    partial: false,
    screenshot: null,
    error: context.sensitive.maskText(message)
  }
}

function capResultRows(evidence: QueryEvidence): QueryEvidence {
  const { result } = evidence
  if (!result) {
    return evidence
  }
  const capped = truncateRows(result.rows, result.totalRows)
  return {
    ...evidence,
    result: {
      ...result,
      rows: capped.rows,
      truncated: result.truncated || capped.note !== null
    }
  }
}

export function createQueryStepHooks(options: QueryStepHooksOptions): QueryStepHooks {
  const { runner, capture } = options
  let preparing: Promise<QueryRunnerPrepareResult> | null = null
  // Why: one lazy prepare per run, so a plan whose steps have no queries never opens a connection.
  const ensurePrepared = (): Promise<QueryRunnerPrepareResult> => {
    preparing ??= runner.prepare()
    return preparing
  }

  const photograph = async (
    step: TestPlanStep,
    side: Side,
    queryIndex: number,
    evidence: QueryEvidence
  ): Promise<string | null> => {
    if (!capture || (evidence.how !== 'automatic' && evidence.how !== 'failed')) {
      return null
    }
    // Why: a failed render or write only loses the image; the query result stands.
    try {
      const png = await capture.renderer.render({
        kind: 'query',
        title: `${step.stepId} · ${side} ${queryIndex}`,
        ...(evidence.description === undefined ? {} : { description: evidence.description }),
        sql: evidence.sqlResolved,
        result: evidence.result,
        ...(evidence.error === undefined ? {} : { error: evidence.error })
      })
      return await capture.writeImage(step.index + 1, step.stepId, { kind: side, queryIndex }, png)
    } catch {
      return null
    }
  }

  const runOne = async (
    step: TestPlanStep,
    side: Side,
    query: VerificationQuery,
    queryIndex: number,
    context: StepHookContext
  ): Promise<QueryEvidence> => {
    const resolved = context.scope.resolve(query.sql, step.requests[0]?.scope.folders)
    let evidence: QueryEvidence
    if (resolved.unresolved.length > 0) {
      const names = [...new Set(resolved.unresolved.map((span) => span.name))].join(', ')
      evidence = failedEvidence(query, query.sql, `Unresolved variable: ${names}`, context)
    } else {
      const prepared = await ensurePrepared()
      evidence = prepared.ok
        ? capResultRows(
            await runner.run(query, {
              sql: resolved.text,
              step,
              side,
              signal: context.signal,
              masker: context.sensitive
            })
          )
        : failedEvidence(query, resolved.text, prepared.message, context)
    }
    const screenshot = await photograph(step, side, queryIndex, evidence)
    return screenshot === null ? evidence : { ...evidence, screenshot }
  }

  return {
    async runBefore(step, context): Promise<BeforeQueriesResult> {
      const evidence: QueryEvidence[] = []
      for (const [position, query] of (step.entry?.before ?? []).entries()) {
        const item = await runOne(step, 'before', query, position + 1, context)
        evidence.push(item)
        if (query.precondition && item.how === 'failed') {
          return {
            evidence,
            preconditionFailure: item.error ?? 'precondition query failed'
          }
        }
      }
      return { evidence }
    },

    async runAfter(step, context) {
      const evidence: QueryEvidence[] = []
      for (const [position, query] of (step.entry?.after ?? []).entries()) {
        evidence.push(await runOne(step, 'after', query, position + 1, context))
      }
      return evidence
    },

    dispose: () => runner.dispose()
  }
}
