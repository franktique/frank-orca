// Walks the phases in order for one run (FR-010, FR-011, FR-017).
import { createRunSensitiveValues } from '../../shared/test-orchestrator/run-sensitive-values'
import type {
  PauseAnswer,
  PauseRequest,
  Phase,
  StepResult,
  TestPlanStep
} from '../../shared/test-orchestrator/test-orchestrator-types'
import { createRunVariableScope } from './run-variable-scope'
import { createRunCleanup } from './test-run-cleanup'
import { decideEnding, listCaptureOwners } from './test-run-progress'
import { beginStop } from './test-run-stop'
import type {
  ActiveRun,
  EvidenceSink,
  StartRunInput,
  TestRunOrchestratorDeps
} from './test-run-orchestrator-types'
import {
  brokenLinkStepResult,
  executeStep,
  runningStepResult,
  skippedStepResult,
  type StepExecutorDeps
} from './test-run-step-executor'

export async function runRunPhases(
  deps: TestRunOrchestratorDeps,
  input: StartRunInput,
  entry: ActiveRun,
  sink: EvidenceSink | null
): Promise<void> {
  const { run, changed } = entry
  const { worktreeId } = input
  const cleanupOnly = run.kind === 'cleanup-only'
  const now = deps.now ?? Date.now
  let capturedAny = false
  const sensitive = createRunSensitiveValues()
  const scope = createRunVariableScope({
    runId: run.id,
    worktreeId,
    collectionId: input.collectionId,
    environment: input.environment,
    collectionVariables: input.collectionVariables,
    inputs: input.inputs,
    sensitive,
    now,
    ledger: {
      append: (w, c, value) => {
        capturedAny = true
        return deps.store.ledger.append(w, c, value)
      }
    }
  })

  const pause = async (request: PauseRequest): Promise<PauseAnswer> => {
    const priorState = run.state
    run.state = 'paused'
    run.pause = request
    changed.notify(true)
    try {
      return await entry.pauses.raise(request, (pauseId) =>
        deps.emit.paused?.({
          worktreeId,
          collectionId: input.collectionId,
          runId: run.id,
          pause: { ...request, pauseId }
        })
      )
    } finally {
      run.pause = null
      if (run.state === 'paused') {
        run.state = priorState
      }
      changed.notify(true)
    }
  }

  const baseDeps: Omit<StepExecutorDeps, 'signal'> = {
    sendRequest: deps.sendRequest,
    scope,
    sensitive,
    worktreeId,
    collectionId: input.collectionId,
    environmentId: input.environmentId,
    runId: run.id,
    pause,
    hooks: input.hooks ?? deps.hooks,
    capture: sink?.capture,
    pausedWithin: (start, end) => entry.pauses.pausedWithin(start, end),
    captureOwners: listCaptureOwners(input.steps),
    inputs: input.inputs,
    requestStop: () => beginStop(entry),
    now
  }

  const record = async (result: StepResult, index: number | null): Promise<void> => {
    const last = run.steps.at(-1)
    if (last?.result === 'running' && last.stepId === result.stepId) {
      run.steps[run.steps.length - 1] = result
    } else {
      run.steps.push(result)
    }
    run.currentStepIndex = index
    changed.notify(false)
    run.evidence = (await sink?.writeReport(run).catch(() => null)) ?? run.evidence
  }

  const runStep = async (
    step: TestPlanStep,
    signal: AbortSignal,
    iterationValue?: { variable: string; value: string }
  ): Promise<StepResult> => {
    run.steps.push(runningStepResult(step))
    run.currentStepIndex = step.index
    changed.notify(false)
    const result = await executeStep(
      { ...baseDeps, signal },
      step,
      run.steps.slice(0, -1),
      iterationValue
    ).catch((error: unknown) => {
      // Why: Stop rejects hook pauses; anything else is a real failure for the outer handler.
      if (!signal.aborted) {
        throw error
      }
      return skippedStepResult(step, 'skipped — run stopped')
    })
    await record(result, step.index)
    return result
  }

  const recordBrokenLinks = async (phase: Phase): Promise<void> => {
    const broken = (input.testMap?.entries ?? []).filter(
      (e) => e.link.state === 'broken' && (e.phase ?? 'scenario') === phase
    )
    for (const [i, e] of broken.entries()) {
      await record(brokenLinkStepResult(e, `${phase}-broken-${i + 1}`), null)
    }
  }

  const cleanup = createRunCleanup({
    ledger: deps.store.ledger,
    runId: run.id,
    worktreeId,
    collectionId: input.collectionId,
    maskText: sensitive.maskText,
    now
  })
  const expand = deps.expandCleanup ?? cleanup.expandCleanup
  const cleanupSteps = input.steps.filter((s) => s.phase === 'cleanup')

  const askStopChoice = async (): Promise<'run-cleanup' | 'keep-data'> => {
    run.state = 'stopping'
    changed.notify(true)
    try {
      const answer = await entry.pauses.raise({ kind: 'stopping' }, (pauseId) =>
        deps.emit.paused?.({
          worktreeId,
          collectionId: input.collectionId,
          runId: run.id,
          pause: { kind: 'stopping', pauseId }
        })
      )
      return answer.kind === 'stopping' ? answer.choice : 'run-cleanup'
    } catch {
      return 'run-cleanup'
    }
  }

  let preflightFailed = false
  let keptByUser = false
  try {
    run.state = 'running'
    changed.notify(true)
    if (!cleanupOnly) {
      for (const phase of ['preflight', 'setup', 'scenario'] as const) {
        for (const step of input.steps.filter((s) => s.phase === phase)) {
          if (entry.abort.signal.aborted) {
            await record(skippedStepResult(step, 'skipped — run stopped'), step.index)
            continue
          }
          if (preflightFailed) {
            await record(skippedStepResult(step, 'skipped — preflight failed'), step.index)
            continue
          }
          const result = await runStep(step, entry.abort.signal)
          preflightFailed = phase === 'preflight' && result.result !== 'pass'
        }
        await recordBrokenLinks(phase)
      }
      if (entry.abort.signal.aborted && capturedAny && cleanupSteps.length > 0) {
        keptByUser = (await askStopChoice()) === 'keep-data'
      }
    }
    entry.inCleanup = true
    run.state = 'cleaning-up'
    changed.notify(true)
    const hasLedgerValues = cleanupOnly
      ? (await deps.store.ledger.listUncleaned(worktreeId, input.collectionId)).length > 0
      : capturedAny
    for (const step of cleanupSteps) {
      if (keptByUser || !hasLedgerValues || entry.cleanupAbort.signal.aborted) {
        const reason = keptByUser
          ? 'skipped — data kept by user'
          : entry.cleanupAbort.signal.aborted
            ? 'skipped — run stopped'
            : cleanupOnly
              ? 'skipped — nothing to clean up'
              : 'skipped — nothing was captured'
        await record(skippedStepResult(step, reason), step.index)
        continue
      }
      const context = { runId: run.id, worktreeId, collectionId: input.collectionId }
      for (const item of await expand(step, context)) {
        await runStep(item.step, entry.cleanupAbort.signal, item.iterationValue)
      }
    }
    if (!cleanupOnly) {
      await recordBrokenLinks('cleanup')
    }
    const summary = await cleanup.finalize(run.steps)
    run.cleanup = { cleaned: summary.cleaned, notCleaned: summary.notCleaned, keptByUser }
    const stopped = entry.abort.signal.aborted || entry.cleanupAbort.signal.aborted
    run.ending = decideEnding(run, stopped, preflightFailed)
  } catch {
    run.ending = 'error'
  }
}
