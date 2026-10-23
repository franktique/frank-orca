import type {
  RunEnding,
  TestPlanStep,
  TestRun,
  TestRunSummary
} from '../../shared/test-orchestrator/test-orchestrator-types'
import type { ChangedEmitter } from './test-run-orchestrator-types'

export function summarizeRun(run: TestRun): TestRunSummary {
  return {
    ...run,
    steps: run.steps.map(({ stepId, title, phase, result, reason, durationMs }) => ({
      stepId,
      title,
      phase,
      result,
      reason,
      durationMs
    }))
  }
}

export function listCaptureOwners(steps: readonly TestPlanStep[]): Map<string, string> {
  const owners = new Map<string, string>()
  for (const step of steps) {
    for (const capture of step.entry?.captures ?? []) {
      if (!owners.has(capture.variable)) {
        owners.set(capture.variable, step.stepId)
      }
    }
  }
  return owners
}

export function decideEnding(run: TestRun, stopped: boolean, preflightFailed: boolean): RunEnding {
  if (preflightFailed) {
    return 'preflight-failed'
  }
  if (stopped) {
    return 'stopped-by-user'
  }
  return run.steps.some((step) => step.result === 'fail' || step.result === 'blocked')
    ? 'failed'
    : 'passed'
}

/** `testRun:changed` runs at ~10/s while stepping, and at once on every state change. */
export function createChangedEmitter(options: {
  send: () => void
  intervalMs: number
  now: () => number
}): ChangedEmitter {
  let last = Number.NEGATIVE_INFINITY
  let timer: NodeJS.Timeout | null = null
  const fire = (): void => {
    last = options.now()
    timer = null
    options.send()
  }
  return {
    notify: (immediate) => {
      if (immediate || options.now() - last >= options.intervalMs) {
        if (timer) {
          clearTimeout(timer)
        }
        fire()
      } else if (!timer) {
        timer = setTimeout(fire, options.intervalMs - (options.now() - last))
      }
    },
    cancel: () => {
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
    }
  }
}
