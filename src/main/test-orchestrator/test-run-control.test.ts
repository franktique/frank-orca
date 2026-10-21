import { describe, expect, it } from 'vitest'
import type { PauseAnswer, TestRun } from '../../shared/test-orchestrator/test-orchestrator-types'
import { TestRunOrchestrator, type StartRunInput } from './test-run-orchestrator'
import type { TestRunOrchestratorDeps } from './test-run-orchestrator-types'
import {
  createFakeSender,
  createMemoryLedger,
  fakePlanStep,
  type FakeReply
} from './test-support/test-run-fakes'

const capturing = { captures: [{ variable: 'caseId', from: 'id' }] }

function input(steps: StartRunInput['steps'], extra: Partial<StartRunInput> = {}): StartRunInput {
  return {
    worktreeId: 'w',
    collectionId: 'col',
    environmentId: null,
    steps,
    testMap: null,
    environment: null,
    collectionVariables: [],
    inputs: [{ name: 'userToken', value: 'old-token', secret: true }],
    targetHosts: [],
    databaseMode: { mode: 'none' },
    ...extra
  }
}

function build(
  replies: Record<string, FakeReply>,
  answer: (pause: { kind: string }) => PauseAnswer,
  wrap?: (
    send: ReturnType<typeof createFakeSender>['sendRequest']
  ) => TestRunOrchestratorDeps['sendRequest']
) {
  const sender = createFakeSender(replies)
  const ledger = createMemoryLedger()
  const pauses: string[] = []
  const orchestrator: TestRunOrchestrator = new TestRunOrchestrator({
    sendRequest: wrap ? wrap(sender.sendRequest) : sender.sendRequest,
    store: { saveRun: async () => {}, ledger },
    emit: {
      changed: () => {},
      finished: () => {},
      paused: ({ pause }) => {
        pauses.push(pause.kind)
        void orchestrator.answerPause('w', 'col', pause.pauseId, answer(pause))
      }
    },
    changedThrottleMs: 0
  })
  return { orchestrator, sender, ledger, pauses }
}

async function finish(orchestrator: TestRunOrchestrator, start: StartRunInput): Promise<TestRun> {
  const result = orchestrator.start(start)
  if (!result.ok) {
    throw new Error(result.message)
  }
  return result.finished
}

describe('unexpected 401', () => {
  it('pauses for credentials and re-sends only the 401 step after resume', async () => {
    let scenarioCalls = 0
    const h = build(
      { 'req-S-1': { body: '{"id":"A1"}' } },
      () => ({ kind: 'credentials', action: 'resume', values: { userToken: 'new-token' } }),
      (send) => async (req) => {
        if (req.request.id === 'req-SC-1' && ++scenarioCalls === 1) {
          return createFakeSender({ 'req-SC-1': { status: 401 } }).sendRequest(req)
        }
        return send(req)
      }
    )
    const run = await finish(
      h.orchestrator,
      input([
        fakePlanStep('S-1', 'setup', 0, { entry: capturing }),
        fakePlanStep('SC-1', 'scenario', 1),
        fakePlanStep('C-1', 'cleanup', 2)
      ])
    )
    expect(h.pauses).toEqual(['credentials'])
    expect(run.steps.map((step) => `${step.stepId}:${step.result}`)).toEqual([
      'S-1:pass',
      'SC-1:pass',
      'C-1:pass'
    ])
    const sentIds = h.sender.calls.map((call) => call.request.id)
    expect(sentIds.filter((id) => id === 'req-S-1')).toHaveLength(1)
    expect(scenarioCalls).toBe(2)
  })

  it('treats Stop on the credentials pause as a stopped run', async () => {
    const h = build({ 'req-SC-1': { status: 401 } }, () => ({
      kind: 'credentials',
      action: 'stop'
    }))
    const run = await finish(h.orchestrator, input([fakePlanStep('SC-1', 'scenario', 0)]))
    expect(run.ending).toBe('stopped-by-user')
    expect(run.steps[0].result).toBe('skipped')
  })
})

describe('Stop', () => {
  async function stopAfterSetup(choice: 'run-cleanup' | 'keep-data') {
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => (release = resolve))
    const h = build(
      { 'req-S-1': { body: '{"id":"A1"}' } },
      () => ({ kind: 'stopping', choice }),
      (send) => async (req) => {
        if (req.request.id === 'req-SC-1') {
          await gate
        }
        return send(req)
      }
    )
    const started = h.orchestrator.start(
      input([
        fakePlanStep('S-1', 'setup', 0, { entry: capturing }),
        fakePlanStep('SC-1', 'scenario', 1),
        fakePlanStep('C-1', 'cleanup', 2, { entry: { forEach: 'caseId' } })
      ])
    )
    if (!started.ok) {
      throw new Error(started.message)
    }
    await new Promise((resolve) => setTimeout(resolve, 20))
    h.orchestrator.stop('w', 'col')
    release()
    return { h, run: await started.finished }
  }

  it('runs cleanup after Stop and records the run as stopped by the user', async () => {
    const { h, run } = await stopAfterSetup('run-cleanup')
    expect(run.ending).toBe('stopped-by-user')
    expect(run.steps.find((s) => s.stepId === 'SC-1')?.result).toBe('skipped')
    expect(run.steps.find((s) => s.stepId === 'C-1')?.result).toBe('pass')
    expect(run.cleanup.notCleaned).toEqual([])
    expect(await h.ledger.listUncleaned()).toEqual([])
  })

  it('keeps data on request and lists every captured value as not cleaned', async () => {
    const { h, run } = await stopAfterSetup('keep-data')
    expect(run.cleanup.keptByUser).toBe(true)
    expect(run.steps.find((s) => s.stepId === 'C-1')?.result).toBe('skipped')
    expect(run.cleanup.notCleaned.map((value) => value.variable)).toEqual(['caseId'])
    expect(h.sender.calls.map((call) => call.request.id)).not.toContain('req-C-1')
  })
})

describe('concurrent group', () => {
  it('sends members together and passes expectAll in any arrival order', async () => {
    const h = build({ 'req-A': { status: 409 }, 'req-B': { status: 201 } }, () => ({
      kind: 'stopping',
      choice: 'run-cleanup'
    }))
    const run = await finish(
      h.orchestrator,
      input(
        [
          fakePlanStep('SC-1', 'scenario', 0, {
            requestIds: ['req-A', 'req-B'],
            entry: { expectAll: [{ status: 201 }, { status: 409 }] }
          })
        ],
        { inputs: [] }
      )
    )
    const step = run.steps[0]
    expect(step.result).toBe('pass')
    expect(step.exchanges).toHaveLength(2)
    expect(step.exchanges.every((exchange) => exchange.sentOffsetMs !== undefined)).toBe(true)
  })
})
