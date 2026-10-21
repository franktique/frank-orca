import { describe, expect, it } from 'vitest'
import { createRunSensitiveValues } from '../../../shared/test-orchestrator/run-sensitive-values'
import type { PauseRequest } from '../../../shared/test-orchestrator/test-orchestrator-types'
import { createRunVariableScope } from '../run-variable-scope'
import { TestRunPauses } from '../test-run-pauses'
import { executeStep } from '../test-run-step-executor'
import { createFakeSender, fakePlanStep } from '../test-support/test-run-fakes'
import { createManualQueryHooks } from './manual-query-runner'

const QUERIES = {
  before: [{ id: 'b1', sql: 'select 1', precondition: true, changesData: false }],
  after: [
    {
      id: 'a1',
      sql: "select * from t where tok = '{{userToken}}'",
      precondition: false,
      changesData: false
    },
    { id: 'a2', sql: 'select 2', description: 'second', precondition: false, changesData: false }
  ]
}

function setup(
  answerFor: (request: PauseRequest) => Parameters<TestRunPauses['answer']>[1],
  pauseMs = 500
) {
  let t = 1000
  const pauses = new TestRunPauses(() => t)
  const raised: PauseRequest[] = []
  const sensitive = createRunSensitiveValues()
  const scope = createRunVariableScope({
    runId: 'r',
    worktreeId: 'w',
    collectionId: 'col',
    environment: null,
    collectionVariables: [],
    inputs: [{ name: 'userToken', value: 'tok-secret-123', secret: true }],
    sensitive,
    ledger: { append: async () => undefined }
  })
  const pause = (request: PauseRequest) => {
    raised.push(request)
    return pauses.raise(request, (id) => {
      t += pauseMs
      pauses.answer(id, answerFor(request))
    })
  }
  const run = () =>
    executeStep(
      {
        sendRequest: createFakeSender({}).sendRequest,
        scope,
        sensitive,
        worktreeId: 'w',
        collectionId: 'col',
        environmentId: null,
        runId: 'r',
        signal: new AbortController().signal,
        inputs: [],
        requestStop: () => {},
        pause,
        hooks: createManualQueryHooks(),
        pausedWithin: (s, e) => pauses.pausedWithin(s, e),
        now: () => t
      },
      fakePlanStep('S-1', 'scenario', 0, { entry: QUERIES }),
      []
    )
  return { run, raised }
}

describe('createManualQueryHooks', () => {
  it('pauses before and after with masked display copy and records pasted text', async () => {
    const { run, raised } = setup((request) => ({
      kind: 'manual-queries',
      action: 'continue',
      pasted:
        request.kind === 'manual-queries' && request.when === 'after'
          ? { a1: 'row tok-secret-123' }
          : {}
    }))
    const result = await run()
    expect(raised.map((r) => r.kind === 'manual-queries' && r.when)).toEqual(['before', 'after'])
    expect(
      JSON.stringify(
        raised.map((r) => r.kind === 'manual-queries' && r.queries.map((q) => q.sqlResolved))
      )
    ).not.toContain('tok-secret-123')
    expect(result.before[0]).toMatchObject({ queryId: 'b1', how: 'manual', screenshot: null })
    expect(result.before[0].pastedText).toBeUndefined()
    expect(result.after.map((q) => q.how)).toEqual(['manual', 'manual'])
    expect(result.after[0].pastedText).not.toContain('tok-secret-123')
    expect(result.after[0].pastedText).toContain('row')
  })

  it('marks skipped queries and does not block on a skipped precondition', async () => {
    const { run } = setup((request) => ({
      kind: 'manual-queries',
      action: 'skip',
      queryIds: request.kind === 'manual-queries' ? request.queries.map((q) => q.queryId) : []
    }))
    const result = await run()
    expect(result.result).toBe('pass')
    expect([...result.before, ...result.after].map((q) => q.how)).toEqual([
      'skipped-by-user',
      'skipped-by-user',
      'skipped-by-user'
    ])
  })

  it('excludes paused time from the step duration', async () => {
    const { run } = setup(() => ({ kind: 'manual-queries', action: 'continue' }), 500)
    const result = await run()
    expect(result.durationMs).toBe(0)
  })
})
