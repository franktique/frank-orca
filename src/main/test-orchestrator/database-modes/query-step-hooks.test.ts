import { describe, expect, it } from 'vitest'
import { createRunSensitiveValues } from '../../../shared/test-orchestrator/run-sensitive-values'
import type {
  QueryEvidence,
  VerificationQuery
} from '../../../shared/test-orchestrator/test-orchestrator-types'
import { createRunVariableScope } from '../run-variable-scope'
import type { StepHookContext } from '../test-run-step-executor'
import { fakePlanStep } from '../test-support/test-run-fakes'
import type { DatabaseQueryRunner } from './database-query-runner'
import { createQueryStepHooks } from './query-step-hooks'

const query = (id: string, sql: string, precondition = false): VerificationQuery => ({
  id,
  sql,
  precondition,
  changesData: false
})

function evidence(overrides: Partial<QueryEvidence>): QueryEvidence {
  return {
    queryId: 'q',
    sqlResolved: 'select 1',
    how: 'automatic',
    result: { columns: ['a'], rows: [['1']], totalRows: 1, truncated: false },
    partial: false,
    screenshot: null,
    ...overrides
  }
}

function setup(
  run: DatabaseQueryRunner['run'],
  before: VerificationQuery[],
  after: VerificationQuery[] = []
) {
  const sensitive = createRunSensitiveValues()
  const scope = createRunVariableScope({
    runId: 'r',
    worktreeId: 'w',
    collectionId: 'c',
    environment: null,
    collectionVariables: [{ key: 'caseId', value: 'c-123', enabled: true }],
    inputs: [],
    sensitive,
    ledger: { append: async () => undefined }
  })
  const context: StepHookContext = {
    runId: 'r',
    signal: new AbortController().signal,
    scope,
    sensitive,
    pause: async () => {
      throw new Error('unexpected pause')
    }
  }
  const step = fakePlanStep('SC-1', 'scenario', 0, { entry: { before, after } })
  const runner: DatabaseQueryRunner = {
    prepare: async () => ({ ok: true }),
    run,
    dispose: async () => undefined
  }
  return { step, context, runner }
}

describe('createQueryStepHooks', () => {
  it('resolves variables and blocks on a failed precondition', async () => {
    const seen: string[] = []
    const { step, context, runner } = setup(
      async (q, ctx) => {
        seen.push(ctx.sql)
        return evidence({ queryId: q.id, how: 'failed', result: null, error: 'no row' })
      },
      [query('a', "select '{{caseId}}'", true), query('b', 'select 2')]
    )
    const result = await createQueryStepHooks({ runner }).runBefore?.(step, context)
    expect(seen).toEqual(["select 'c-123'"])
    expect(result?.preconditionFailure).toBe('no row')
    expect(result?.evidence).toHaveLength(1)
  })

  it('records a non-precondition failure and keeps going', async () => {
    const { step, context, runner } = setup(
      async (q) =>
        q.id === 'a'
          ? evidence({ queryId: 'a', how: 'failed', result: null, error: 'boom' })
          : evidence({ queryId: q.id }),
      [query('a', 'select 1'), query('b', 'select 2')]
    )
    const result = await createQueryStepHooks({ runner }).runBefore?.(step, context)
    expect(result?.preconditionFailure).toBeUndefined()
    expect(result?.evidence.map((item) => item.how)).toEqual(['failed', 'automatic'])
  })

  it('fails a query with an unresolved variable without running it', async () => {
    let ran = false
    const { step, context, runner } = setup(
      async () => ((ran = true), evidence({})),
      [query('a', 'select {{nope}}')]
    )
    const result = await createQueryStepHooks({ runner }).runBefore?.(step, context)
    expect(ran).toBe(false)
    expect(result?.evidence[0].error).toContain('nope')
  })

  it('caps rows at 200 and writes a before-K screenshot when capture is on', async () => {
    const rows = Array.from({ length: 250 }, (_, i) => [String(i)])
    const written: unknown[] = []
    const { step, context, runner } = setup(
      async () => evidence({ result: { columns: ['a'], rows, totalRows: 250, truncated: false } }),
      [query('a', 'select 1')]
    )
    const hooks = createQueryStepHooks({
      runner,
      capture: {
        renderer: { render: async () => new Uint8Array([1]) },
        writeImage: async (_step, role) => (written.push(role), 'images/x.png')
      }
    })
    const result = await hooks.runBefore?.(step, context)
    expect(result?.evidence[0].result?.rows).toHaveLength(200)
    expect(result?.evidence[0].result?.truncated).toBe(true)
    expect(result?.evidence[0].screenshot).toBe('images/x.png')
    expect(written).toEqual([{ kind: 'before', queryIndex: 1 }])
  })
})
