// Runs one plan step's request(s): gates, send, captures, verdict, masked evidence (FR-011..FR-019).
import type { ApiNodeId } from '../../shared/api-client/api-client-types'
import { captureFromResponse } from '../../shared/test-orchestrator/response-capture'
import type { RunSensitiveValues } from '../../shared/test-orchestrator/run-sensitive-values'
import type {
  EvidenceSnapshotCard,
  RequestEvidenceCardData
} from '../../shared/test-orchestrator/evidence-snapshot-card'
import type {
  PauseAnswer,
  PauseRequest,
  QueryEvidence,
  RequestEvidence,
  StepResult,
  TestMapEntry,
  TestPlanStep
} from '../../shared/test-orchestrator/test-orchestrator-types'
import type { ExecuteRequestInput, ExecuteRequestResult } from '../api-client/request-execution'
import type { EvidenceImageRole } from './evidence-names'
import type { RunInput, RunVariableScope } from './run-variable-scope'
import { askForCredentials } from './test-run-credentials'
import {
  decideRequestVerdicts,
  hasUnexpectedUnauthorized,
  sendStepRequests,
  type SentRequest
} from './test-run-request-group'
import { maskOutcome, maskResolvedRequest, maskTestResults } from './test-run-evidence-masking'

/** Implemented by the hidden snapshot window (T049); wired in by the orchestrator in T054. */
export type EvidenceSnapshotRenderer = {
  render: (card: EvidenceSnapshotCard) => Promise<Uint8Array>
}

/** Per-run screenshot capture: render a masked card, then store the PNG and get its link. */
export type StepEvidenceCapture = {
  renderer: EvidenceSnapshotRenderer
  writeImage: (
    stepOrder: number,
    stepId: string,
    role: EvidenceImageRole,
    png: Uint8Array
  ) => Promise<string>
}

export type StepHookContext = {
  runId: string
  signal: AbortSignal
  scope: RunVariableScope
  sensitive: RunSensitiveValues
  /** Parks the run in `paused` until the user answers; never times out. */
  pause: (request: PauseRequest) => Promise<PauseAnswer>
}

export type BeforeQueriesResult = {
  evidence: QueryEvidence[]
  /** A failed precondition query: the step is blocked and its request is not sent. */
  preconditionFailure?: string
}

/** Database extension points (US2-US5); absent hooks mean a request-only step. */
export type StepQueryHooks = {
  runBefore?: (step: TestPlanStep, context: StepHookContext) => Promise<BeforeQueriesResult>
  runAfter?: (
    step: TestPlanStep,
    context: StepHookContext,
    exchanges: readonly RequestEvidence[]
  ) => Promise<QueryEvidence[]>
}

export type StepExecutorDeps = {
  sendRequest: (input: ExecuteRequestInput) => Promise<ExecuteRequestResult>
  scope: RunVariableScope
  sensitive: RunSensitiveValues
  worktreeId: string
  collectionId: ApiNodeId
  environmentId: ApiNodeId | null
  runId: string
  signal: AbortSignal
  pause: StepHookContext['pause']
  hooks?: StepQueryHooks
  capture?: StepEvidenceCapture
  /** Paused time inside [startMs, endMs]; excluded from the step duration (FR-006d). */
  pausedWithin?: (startMs: number, endMs: number) => number
  /** Step that produces a captured variable, for "blocked by setup step X". */
  captureOwners?: ReadonlyMap<string, string>
  /** Run inputs; a credentials pause lists the ones a 401 step references. */
  inputs: readonly RunInput[]
  /** Starts Stop; used when the user answers a credentials pause with Stop. */
  requestStop: () => void
  now?: () => number
}

const FAILED_RESULTS: ReadonlySet<StepResult['result']> = new Set(['fail', 'blocked', 'skipped'])

function baseResult(step: Pick<TestPlanStep, 'stepId' | 'title' | 'phase'>): StepResult {
  return {
    stepId: step.stepId,
    title: step.title,
    phase: step.phase,
    result: 'pending',
    dependencyFailed: [],
    expectedText: '',
    actualText: '',
    before: [],
    after: [],
    exchanges: [],
    durationMs: 0
  }
}

export function skippedStepResult(
  step: Pick<TestPlanStep, 'stepId' | 'title' | 'phase'>,
  reason: string
): StepResult {
  return { ...baseResult(step), result: 'skipped', reason }
}

export function runningStepResult(
  step: Pick<TestPlanStep, 'stepId' | 'title' | 'phase'>
): StepResult {
  return { ...baseResult(step), result: 'running' }
}

/** A test-map entry whose request is gone: listed in the evidence but never sent (SC-002). */
export function brokenLinkStepResult(entry: TestMapEntry, fallbackStepId: string): StepResult {
  const fallbackTitle = 'path' in entry.ref ? (entry.ref.path.at(-1) ?? 'request') : entry.ref.id
  return skippedStepResult(
    {
      stepId: entry.stepId ?? fallbackStepId,
      title: entry.title ?? fallbackTitle,
      phase: entry.phase ?? 'scenario'
    },
    'skipped — broken test-map link'
  )
}

function findMissingVariables(deps: StepExecutorDeps, step: TestPlanStep): string[] {
  return step.requiredVariables.filter(
    (name) => deps.scope.resolve(`{{${name}}}`).unresolved.length > 0
  )
}

function describeBlocker(
  deps: StepExecutorDeps,
  missing: readonly string[],
  history: readonly StepResult[]
): string {
  const ownerId = missing.map((name) => deps.captureOwners?.get(name)).find(Boolean)
  const owner =
    history.find((result) => result.stepId === ownerId && result.result !== 'pass') ??
    history.findLast((result) => FAILED_RESULTS.has(result.result))
  return owner
    ? `blocked by ${owner.phase} step ${owner.stepId}`
    : `blocked: missing ${missing.join(', ')}`
}

function failedDependencies(entry: TestMapEntry | null, history: readonly StepResult[]): string[] {
  return (entry?.dependsOn ?? []).filter((id) =>
    history.some((result) => result.stepId === id && FAILED_RESULTS.has(result.result))
  )
}

/** Failure to render or store a card only loses the image; the step verdict stands. */
async function captureRequestCard(
  deps: StepExecutorDeps,
  step: TestPlanStep,
  requestIndex: number,
  card: Omit<RequestEvidenceCardData, 'kind'>
): Promise<string | null> {
  if (!deps.capture) {
    return null
  }
  try {
    const png = await deps.capture.renderer.render({ kind: 'request', ...card })
    const role: EvidenceImageRole =
      step.requests.length > 1
        ? { kind: 'request', concurrentIndex: requestIndex + 1 }
        : { kind: 'request' }
    return await deps.capture.writeImage(step.index + 1, step.stepId, role, png)
  } catch {
    return null
  }
}

function joinTexts(values: readonly string[]): string {
  return [...new Set(values.filter(Boolean))].join(', ')
}

export async function executeStep(
  deps: StepExecutorDeps,
  step: TestPlanStep,
  history: readonly StepResult[],
  iterationValue?: { variable: string; value: string }
): Promise<StepResult> {
  const now = deps.now ?? Date.now
  const startedAt = now()
  const result: StepResult = {
    ...baseResult(step),
    dependencyFailed: failedDependencies(step.entry, history),
    ...(iterationValue
      ? {
          iterationValue: {
            variable: iterationValue.variable,
            valueMasked: deps.sensitive.maskText(iterationValue.value)
          }
        }
      : {})
  }
  const finish = (patch: Partial<StepResult>): StepResult => {
    const endedAt = now()
    const merged = { ...result, ...patch }
    return {
      ...merged,
      reason: merged.reason === undefined ? undefined : deps.sensitive.maskText(merged.reason),
      expectedText: deps.sensitive.maskText(merged.expectedText),
      actualText: deps.sensitive.maskText(merged.actualText),
      durationMs: Math.max(0, endedAt - startedAt - (deps.pausedWithin?.(startedAt, endedAt) ?? 0))
    }
  }

  const missing = findMissingVariables(deps, step)
  if (missing.length > 0) {
    return finish({ result: 'blocked', reason: describeBlocker(deps, missing, history) })
  }

  const hookContext: StepHookContext = {
    runId: deps.runId,
    signal: deps.signal,
    scope: deps.scope,
    sensitive: deps.sensitive,
    pause: deps.pause
  }
  const before = await deps.hooks?.runBefore?.(step, hookContext)
  if (before) {
    result.before = before.evidence
    if (before.preconditionFailure) {
      return finish({
        result: 'blocked',
        reason: `precondition failed: ${before.preconditionFailure}`
      })
    }
  }

  let sent: SentRequest[] = []
  for (;;) {
    const attempt = await sendStepRequests(deps, step)
    if (!attempt.ok) {
      return finish({ result: 'fail', reason: attempt.message })
    }
    sent = attempt.sent
    if (deps.signal.aborted || !hasUnexpectedUnauthorized(step, sent)) {
      break
    }
    // Why: passed steps are never re-run; only this step (or group) is sent again after resume.
    if (!(await askForCredentials(deps, step))) {
      return finish({ result: 'skipped', reason: 'skipped — run stopped' })
    }
  }

  const verdicts = decideRequestVerdicts(step, sent)
  const exchanges: RequestEvidence[] = []
  for (const [index, { latest, sentOffsetMs }] of sent.entries()) {
    // Why: capture before masking so a captured token is already in the sensitive set (R9).
    if (index === 0 && latest.outcome.kind === 'response') {
      for (const capture of step.entry?.captures ?? []) {
        const captured = captureFromResponse(
          capture.variable,
          capture.from,
          latest.outcome.response
        )
        if (captured.ok) {
          await deps.scope.capture(step.stepId, capture.variable, captured.value)
        } else {
          verdicts.push({
            result: 'fail',
            reason: captured.error,
            expectedText: '',
            actualText: ''
          })
        }
      }
    }
    const resolvedRequest = maskResolvedRequest(deps.sensitive, latest.resolvedRequest)
    const outcome = maskOutcome(deps.sensitive, latest.outcome)
    exchanges.push({
      requestId: step.requests[index].requestId,
      resolvedRequest,
      outcome,
      tests: maskTestResults(deps.sensitive, latest.tests),
      screenshot: await captureRequestCard(deps, step, index, {
        title: deps.sensitive.maskText(step.title),
        resolvedRequest,
        outcome,
        durationMs: latest.durationMs
      }),
      ...(sentOffsetMs === undefined ? {} : { sentOffsetMs })
    })
  }

  const failure = verdicts.find((verdict) => verdict.result === 'fail')
  const after = await deps.hooks?.runAfter?.(step, hookContext, exchanges)
  const stopped = deps.signal.aborted
  return finish({
    result: stopped ? 'skipped' : failure ? 'fail' : 'pass',
    reason: stopped ? 'skipped — run stopped' : failure?.reason,
    expectedText: joinTexts(verdicts.map((verdict) => verdict.expectedText)),
    actualText: joinTexts(verdicts.map((verdict) => verdict.actualText)),
    exchanges,
    ...(after ? { after } : {})
  })
}
