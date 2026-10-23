import { describe, expect, it } from 'vitest'
import type { CapturedValue, TestRun } from '../../shared/test-orchestrator/test-orchestrator-types'
import { TestRunOrchestrator, type StartRunInput } from './test-run-orchestrator'
import type { TestRunOrchestratorDeps } from './test-run-orchestrator-types'
import {
  createFakeSender,
  emptyLedger,
  fakePlanStep,
  type FakeReply
} from './test-support/test-run-fakes'

function build(replies: Record<string, FakeReply>, extra: Partial<TestRunOrchestratorDeps> = {}) {
  const sender = createFakeSender(replies)
  const states: string[] = []
  const saved: TestRun[] = []
  const ledger: CapturedValue[] = []
  const finishedEvents: string[] = []
  const orchestrator = new TestRunOrchestrator({
    sendRequest: sender.sendRequest,
    store: {
      saveRun: async (_w, _c, run) => void saved.push(structuredClone(run)),
      ledger: { ...emptyLedger, append: async (_w, _c, v) => void ledger.push(v) }
    },
    emit: {
      changed: ({ run }) => void states.push(run.state),
      finished: ({ run }) => void finishedEvents.push(run.id)
    },
    changedThrottleMs: 0,
    ...extra
  })
  return { orchestrator, sender, states, saved, ledger, finishedEvents }
}

function input(steps: StartRunInput['steps'], extra: Partial<StartRunInput> = {}): StartRunInput {
  return {
    worktreeId: 'w',
    collectionId: 'col',
    environmentId: null,
    steps,
    testMap: null,
    environment: null,
    collectionVariables: [],
    inputs: [],
    targetHosts: [],
    databaseMode: { mode: 'none' },
    ...extra
  }
}

async function runToEnd(harness: ReturnType<typeof build>, start: StartRunInput): Promise<TestRun> {
  const result = harness.orchestrator.start(start)
  if (!result.ok) {
    throw new Error(result.message)
  }
  return result.finished
}

const capturing = { captures: [{ variable: 'caseId', from: 'id' }] }

describe('TestRunOrchestrator', () => {
  it('runs phases in order, always cleans up, persists and emits finished', async () => {
    const h = build({ 'req-S-1': { body: '{"id":"A1"}' } })
    const run = await runToEnd(
      h,
      input([
        fakePlanStep('S-1', 'setup', 0, { entry: capturing }),
        fakePlanStep('SC-1', 'scenario', 1, { requiredVariables: ['caseId'] }),
        fakePlanStep('C-1', 'cleanup', 2)
      ])
    )
    expect(run.ending).toBe('passed')
    expect(run.state).toBe('finished')
    expect(run.steps.map((s) => s.stepId)).toEqual(['S-1', 'SC-1', 'C-1'])
    expect(h.states).toContain('cleaning-up')
    expect(h.saved).toHaveLength(1)
    expect(h.finishedEvents).toEqual([run.id])
    expect(h.ledger.map((v) => v.variable)).toEqual(['caseId'])
    expect(h.orchestrator.getRun('w', 'col')).toBe(run)
  })

  it('skips cleanup steps when nothing was captured', async () => {
    const h = build({})
    const run = await runToEnd(h, input([fakePlanStep('C-1', 'cleanup', 0)]))
    expect(run.steps[0]).toMatchObject({
      result: 'skipped',
      reason: 'skipped — nothing was captured'
    })
    expect(h.sender.calls).toHaveLength(0)
  })

  it('preflight failure sends no setup or scenario requests but still lists them', async () => {
    const h = build({ 'req-P-1': { status: 500 } })
    const run = await runToEnd(
      h,
      input([
        fakePlanStep('P-1', 'preflight', 0),
        fakePlanStep('S-1', 'setup', 1),
        fakePlanStep('SC-1', 'scenario', 2)
      ])
    )
    expect(run.ending).toBe('preflight-failed')
    expect(h.sender.calls.map((c) => c.request.id)).toEqual(['req-P-1'])
    expect(run.steps.map((s) => s.result)).toEqual(['fail', 'skipped', 'skipped'])
  })

  it('a missing capture blocks the dependent step and the run fails', async () => {
    const h = build({ 'req-S-1': { body: '{}' } })
    const run = await runToEnd(
      h,
      input([
        fakePlanStep('S-1', 'setup', 0, { entry: capturing }),
        fakePlanStep('SC-1', 'scenario', 1, { requiredVariables: ['caseId'] })
      ])
    )
    expect(run.steps.map((s) => s.result)).toEqual(['fail', 'blocked'])
    expect(run.ending).toBe('failed')
  })

  it('lists broken-link entries as skipped', async () => {
    const h = build({})
    const run = await runToEnd(
      h,
      input([], {
        testMap: {
          orcaTestMap: 1,
          collectionId: 'col',
          loadedAt: 0,
          entries: [
            {
              ref: { path: ['Gone'] },
              link: { state: 'broken', lastRequestId: 'x' },
              before: [],
              after: []
            }
          ]
        }
      })
    )
    expect(run.steps[0]).toMatchObject({
      result: 'skipped',
      reason: 'skipped — broken test-map link'
    })
    expect(run.ending).toBe('passed')
  })

  it('refuses a second start while a run is active, then allows it', async () => {
    const h = build({})
    const first = h.orchestrator.start(input([fakePlanStep('S-1', 'setup', 0)]))
    const second = h.orchestrator.start(input([]))
    expect(second).toMatchObject({ ok: false, code: 'busy' })
    if (first.ok) {
      await first.finished
    }
    expect(h.orchestrator.start(input([])).ok).toBe(true)
  })

  it('stop aborts the in-flight request, skips the rest, and still runs cleanup', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => (release = resolve))
    const h = build({ 'req-S-1': { body: '{"id":"A1"}' } })
    const baseSend = h.sender.sendRequest
    const orchestrator = new TestRunOrchestrator({
      sendRequest: async (req) => {
        if (req.request.id === 'req-SC-1') {
          await gate
        }
        return baseSend(req)
      },
      store: { saveRun: async () => {}, ledger: emptyLedger },
      emit: {
        changed: () => {},
        finished: () => {},
        paused: ({ pause }) =>
          void orchestrator.answerPause('w', 'col', pause.pauseId, {
            kind: 'stopping',
            choice: 'run-cleanup'
          })
      },
      changedThrottleMs: 0
    })
    const started = orchestrator.start(
      input([
        fakePlanStep('S-1', 'setup', 0, { entry: capturing }),
        fakePlanStep('SC-1', 'scenario', 1),
        fakePlanStep('SC-2', 'scenario', 2),
        fakePlanStep('C-1', 'cleanup', 3)
      ])
    )
    if (!started.ok) {
      throw new Error('start failed')
    }
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(orchestrator.stop('w', 'col')).toEqual({ ok: true })
    release()
    const run = await started.finished
    expect(run.ending).toBe('stopped-by-user')
    expect(run.steps.map((s) => `${s.stepId}:${s.result}`)).toEqual([
      'S-1:pass',
      'SC-1:skipped',
      'SC-2:skipped',
      'C-1:pass'
    ])
  })

  it('pauses via the hook primitive and resumes on answer', async () => {
    let pauseId = ''
    const h = build(
      {},
      {
        hooks: {
          runBefore: async (_step, ctx) => {
            await ctx.pause({ kind: 'credentials', stepId: 'S-1', inputs: [] })
            return { evidence: [] }
          }
        },
        emit: {
          changed: () => {},
          finished: () => {},
          paused: ({ pause }) => void (pauseId = pause.pauseId)
        }
      }
    )
    const started = h.orchestrator.start(input([fakePlanStep('S-1', 'setup', 0)]))
    if (!started.ok) {
      throw new Error('start failed')
    }
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(h.orchestrator.getRun('w', 'col')?.state).toBe('paused')
    expect(
      h.orchestrator.answerPause('w', 'col', pauseId, {
        kind: 'credentials',
        action: 'resume',
        values: {}
      })
    ).toEqual({ ok: true })
    expect((await started.finished).ending).toBe('passed')
  })
})
