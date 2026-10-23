import { describe, expect, it } from 'vitest'
import { createRunSensitiveValues } from '../../shared/test-orchestrator/run-sensitive-values'
import type { StepResult } from '../../shared/test-orchestrator/test-orchestrator-types'
import { createRunVariableScope } from './run-variable-scope'
import { brokenLinkStepResult, executeStep, type StepExecutorDeps } from './test-run-step-executor'
import { createFakeSender, fakePlanStep, type FakeReply } from './test-support/test-run-fakes'

function setup(replies: Record<string, FakeReply>, overrides: Partial<StepExecutorDeps> = {}) {
  const sensitive = createRunSensitiveValues()
  const appended: string[] = []
  const scope = createRunVariableScope({
    runId: 'r',
    worktreeId: 'w',
    collectionId: 'col',
    environment: null,
    collectionVariables: [],
    inputs: [{ name: 'userToken', value: 'tok-secret-123', secret: true }],
    sensitive,
    ledger: { append: async (_w, _c, v) => void appended.push(v.variable) }
  })
  const sender = createFakeSender(replies)
  const deps: StepExecutorDeps = {
    sendRequest: sender.sendRequest,
    scope,
    sensitive,
    worktreeId: 'w',
    collectionId: 'col',
    environmentId: null,
    runId: 'r',
    signal: new AbortController().signal,
    pause: async () => {
      throw new Error('unexpected pause')
    },
    inputs: [],
    requestStop: () => {},
    ...overrides
  }
  return { deps, sender, scope, appended }
}

const priorFail: StepResult = {
  stepId: 'S-1',
  title: 't',
  phase: 'setup',
  result: 'fail',
  dependencyFailed: [],
  expectedText: '',
  actualText: '',
  before: [],
  after: [],
  exchanges: [],
  durationMs: 0
}

describe('executeStep', () => {
  it('passes a 2xx step and records a masked exchange', async () => {
    const { deps } = setup({ 'req-S-2': { body: '{"echo":"tok-secret-123"}' } })
    const result = await executeStep(deps, fakePlanStep('S-2', 'setup', 0), [])
    expect(result.result).toBe('pass')
    expect(JSON.stringify(result.exchanges)).not.toContain('tok-secret-123')
  })

  it('fails with the expectation text when the status differs', async () => {
    const { deps } = setup({ 'req-SC-1': { status: 500 } })
    const step = fakePlanStep('SC-1', 'scenario', 0, { entry: { expect: { status: 422 } } })
    const result = await executeStep(deps, step, [])
    expect(result).toMatchObject({ result: 'fail', expectedText: '422', actualText: '500' })
    expect(result.reason).toContain('Expected status 422')
  })

  it('blocks without sending when a required capture is missing', async () => {
    const { deps, sender } = setup({})
    const step = fakePlanStep('SC-1', 'scenario', 1, { requiredVariables: ['caseId'] })
    const result = await executeStep(deps, step, [priorFail])
    expect(result).toMatchObject({ result: 'blocked', reason: 'blocked by setup step S-1' })
    expect(sender.calls).toHaveLength(0)
  })

  it('sends once the required value is captured', async () => {
    const { deps, scope } = setup({})
    await scope.capture('S-1', 'caseId', 'AM1')
    const step = fakePlanStep('SC-1', 'scenario', 1, { requiredVariables: ['caseId'] })
    expect((await executeStep(deps, step, [])).result).toBe('pass')
  })

  it('applies test-map captures and fails when the path is missing', async () => {
    const { deps, scope, appended } = setup({ 'req-S-1': { body: '{"id":"A7"}' } })
    const ok = fakePlanStep('S-1', 'setup', 0, {
      entry: { captures: [{ variable: 'caseId', from: 'id' }] }
    })
    expect((await executeStep(deps, ok, [])).result).toBe('pass')
    expect(scope.resolve('{{caseId}}').text).toBe('A7')
    expect(appended).toContain('caseId')

    const bad = fakePlanStep('S-2', 'setup', 1, {
      entry: { captures: [{ variable: 'other', from: 'nope' }] }
    })
    const failed = await executeStep(deps, bad, [])
    expect(failed).toMatchObject({
      result: 'fail',
      reason: 'could not capture other from response'
    })
  })

  it('flags failed dependencies without blocking the step', async () => {
    const { deps } = setup({})
    const step = fakePlanStep('SC-2', 'scenario', 1, { entry: { dependsOn: ['S-1'] } })
    const result = await executeStep(deps, step, [priorFail])
    expect(result.result).toBe('pass')
    expect(result.dependencyFailed).toEqual(['S-1'])
  })

  it('fails on a transport error and reports it', async () => {
    const { deps } = setup({ 'req-S-1': { error: 'ECONNREFUSED' } })
    const result = await executeStep(deps, fakePlanStep('S-1', 'setup', 0), [])
    expect(result).toMatchObject({ result: 'fail', reason: 'ECONNREFUSED' })
  })

  it('blocks on a failed precondition query without sending, and runs after hooks', async () => {
    const blocked = setup(
      {},
      { hooks: { runBefore: async () => ({ evidence: [], preconditionFailure: 'no row' }) } }
    )
    const step = fakePlanStep('SC-1', 'scenario', 0)
    const result = await executeStep(blocked.deps, step, [])
    expect(result).toMatchObject({ result: 'blocked', reason: 'precondition failed: no row' })
    expect(blocked.sender.calls).toHaveLength(0)

    const order: string[] = []
    const ran = setup(
      {},
      {
        hooks: {
          runBefore: async () => (order.push('before'), { evidence: [] }),
          runAfter: async () => (order.push('after'), [])
        }
      }
    )
    await executeStep(ran.deps, step, [])
    expect(order).toEqual(['before', 'after'])
  })

  it('passes the run AbortSignal and reports a stopped step as skipped', async () => {
    const abort = new AbortController()
    const { deps, sender } = setup({}, { signal: abort.signal })
    abort.abort()
    const result = await executeStep(deps, fakePlanStep('S-1', 'setup', 0), [])
    expect(sender.calls[0].signal).toBe(abort.signal)
    expect(result).toMatchObject({ result: 'skipped', reason: 'skipped — run stopped' })
  })
})

describe('brokenLinkStepResult', () => {
  it('lists the entry as skipped', () => {
    const result = brokenLinkStepResult(
      {
        ref: { path: ['Folder', 'Gone'] },
        link: { state: 'broken', lastRequestId: 'x' },
        stepId: 'SC-9',
        phase: 'scenario',
        before: [],
        after: []
      },
      'fallback'
    )
    expect(result).toMatchObject({
      stepId: 'SC-9',
      title: 'Gone',
      result: 'skipped',
      reason: 'skipped — broken test-map link'
    })
  })
})
