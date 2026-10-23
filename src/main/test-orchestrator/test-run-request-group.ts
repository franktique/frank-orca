// Sends a step's requests (concurrently for a group) and judges them together (FR-018, FR-015).
import type { LatestResult } from '../../shared/api-client/api-client-types'
import {
  decideExpectAllVerdict,
  decideStepVerdict
} from '../../shared/test-orchestrator/step-verdict'
import type { StepVerdict } from '../../shared/test-orchestrator/step-verdict'
import type { TestPlanStep } from '../../shared/test-orchestrator/test-orchestrator-types'
import type { StepExecutorDeps } from './test-run-step-executor'

export type SentRequest = { latest: LatestResult; sentOffsetMs?: number }

export type SendResult = { ok: true; sent: SentRequest[] } | { ok: false; message: string }

export async function sendStepRequests(
  deps: StepExecutorDeps,
  step: TestPlanStep
): Promise<SendResult> {
  const now = deps.now ?? Date.now
  const concurrent = step.requests.length > 1
  const groupStart = now()
  const results = await Promise.all(
    step.requests.map(async (request) => {
      // Why: read before the first await so every member's offset is stamped in the same tick.
      const sentOffsetMs = concurrent ? now() - groupStart : undefined
      const executed = await deps.sendRequest({
        worktreeId: deps.worktreeId,
        collectionId: deps.collectionId,
        request: request.snapshot,
        environmentId: deps.environmentId,
        origin: 'run',
        runId: deps.runId,
        signal: deps.signal,
        scope: request.scope,
        variableOverlay: deps.scope.overlay(),
        variableSink: deps.scope.sinkFor(step.stepId)
      })
      return { executed, sentOffsetMs }
    })
  )
  const sent: SentRequest[] = []
  for (const { executed, sentOffsetMs } of results) {
    if (!executed.ok) {
      return { ok: false, message: executed.message }
    }
    sent.push({ latest: executed.latest, sentOffsetMs })
  }
  return { ok: true, sent }
}

export function hasUnexpectedUnauthorized(
  step: TestPlanStep,
  sent: readonly SentRequest[]
): boolean {
  const unauthorized = sent.filter(
    ({ latest }) => latest.outcome.kind === 'response' && latest.outcome.response.status === 401
  ).length
  const { entry } = step
  const expectations = entry?.expectAll ?? (entry?.expect ? [entry.expect] : [])
  const accepting = expectations.filter((expect) =>
    (Array.isArray(expect.status) ? expect.status : [expect.status]).includes(401)
  ).length
  return unauthorized > accepting
}

export function decideRequestVerdicts(
  step: TestPlanStep,
  sent: readonly SentRequest[]
): StepVerdict[] {
  const expectAll = step.entry?.expectAll
  if (sent.length > 1 && expectAll && expectAll.length > 0) {
    const group = decideExpectAllVerdict({
      expectAll,
      outcomes: sent.map(({ latest }) => latest.outcome)
    })
    const failedTests = sent.flatMap(({ latest }) =>
      latest.tests.filter((test) => !test.passed).map((test) => test.name)
    )
    return failedTests.length > 0
      ? [
          group,
          {
            result: 'fail',
            reason: `Failed tests: ${failedTests.join(', ')}`,
            expectedText: group.expectedText,
            actualText: group.actualText
          }
        ]
      : [group]
  }
  return sent.map(({ latest }, index) =>
    decideStepVerdict({
      outcome: latest.outcome,
      tests: latest.tests,
      expect: expectAll?.[index] ?? (index === 0 ? step.entry?.expect : undefined)
    })
  )
}
