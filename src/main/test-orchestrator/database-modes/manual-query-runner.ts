import type {
  PauseAnswer,
  PauseQuery,
  QueryEvidence,
  TestPlanStep,
  VerificationQuery
} from '../../../shared/test-orchestrator/test-orchestrator-types'
import type {
  BeforeQueriesResult,
  StepHookContext,
  StepQueryHooks
} from '../test-run-step-executor'

type Side = 'before' | 'after'

// Why: one pause per step side (not per query) so the user pastes all results in one visit.
async function runManualSide(
  step: TestPlanStep,
  side: Side,
  queries: readonly VerificationQuery[],
  context: StepHookContext
): Promise<QueryEvidence[]> {
  if (queries.length === 0) {
    return []
  }
  const { scope, sensitive } = context
  const resolved = queries.map((query) => ({ query, sql: scope.resolve(query.sql).text }))
  const pauseQueries: PauseQuery[] = resolved.map(({ query, sql }) => ({
    queryId: query.id,
    sqlResolved: sensitive.maskText(sql),
    sqlRaw: sql,
    ...(query.description === undefined
      ? {}
      : { description: sensitive.maskText(query.description) })
  }))

  const answer: PauseAnswer = await context.pause({
    kind: 'manual-queries',
    stepId: step.stepId,
    when: side,
    queries: pauseQueries
  })
  if (answer.kind !== 'manual-queries') {
    throw new Error(`Unexpected ${answer.kind} answer to a manual-queries pause.`)
  }
  const skipped = new Set(answer.action === 'skip' ? answer.queryIds : [])
  const pasted = answer.action === 'continue' ? (answer.pasted ?? {}) : {}

  return resolved.map(({ query }, index): QueryEvidence => {
    const base = {
      queryId: query.id,
      sqlResolved: pauseQueries[index].sqlResolved,
      ...(pauseQueries[index].description === undefined
        ? {}
        : { description: pauseQueries[index].description }),
      result: null,
      partial: false,
      screenshot: null
    }
    if (skipped.has(query.id)) {
      return { ...base, how: 'skipped-by-user' }
    }
    const text = pasted[query.id]
    return {
      ...base,
      how: 'manual',
      ...(text === undefined || text === '' ? {} : { pastedText: sensitive.maskText(text) })
    }
  })
}

/** Manual database mode (FR-006c): the user runs each step side's queries themselves. */
export function createManualQueryHooks(): StepQueryHooks {
  return {
    // Manual answers never fail a precondition; the user sees the queries and decides.
    runBefore: async (step, context): Promise<BeforeQueriesResult> => ({
      evidence: await runManualSide(step, 'before', step.entry?.before ?? [], context)
    }),
    runAfter: (step, context) => runManualSide(step, 'after', step.entry?.after ?? [], context)
  }
}
