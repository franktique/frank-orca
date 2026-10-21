// Expands `forEach` cleanup steps over the capture ledger and reports what stayed uncleaned (FR-017a/b).
import { SECRET_MASK } from '../../shared/api-client/api-client-types'
import { isSensitiveVariableName } from '../../shared/test-orchestrator/run-sensitive-values'
import type {
  CapturedValue,
  NotCleanedValue,
  StepResult
} from '../../shared/test-orchestrator/test-orchestrator-types'
import type { CaptureIdentity, CleanedMark } from './capture-ledger-store'
import type { CleanupExpander } from './test-run-orchestrator-types'

export type CleanupLedger = {
  listUncleaned: (worktreeId: string, collectionId: string) => Promise<CapturedValue[]>
  markCleaned: (
    worktreeId: string,
    collectionId: string,
    match: CaptureIdentity,
    cleaned: CleanedMark
  ) => Promise<void>
}

export type CleanupSummary = { cleaned: number; notCleaned: NotCleanedValue[] }

export type RunCleanup = {
  expandCleanup: CleanupExpander
  /** Marks values whose iteration passed, then lists the rest; call once after the cleanup phase. */
  finalize: (steps: readonly StepResult[]) => Promise<CleanupSummary>
}

type Expansion = { stepId: string; identities: CaptureIdentity[] }

const identityOf = ({ variable, runId, stepId }: CapturedValue): CaptureIdentity => ({
  variable,
  runId,
  stepId
})

export function createRunCleanup(deps: {
  ledger: CleanupLedger
  runId: string
  worktreeId: string
  collectionId: string
  maskText: (text: string) => string
  now?: () => number
}): RunCleanup {
  const now = deps.now ?? Date.now
  const expansions: Expansion[] = []

  const expandCleanup: CleanupExpander = async (step, context) => {
    const variable = step.entry?.forEach
    if (!variable) {
      return [{ step }]
    }
    const uncleaned = await deps.ledger.listUncleaned(context.worktreeId, context.collectionId)
    // Why: a value captured twice is one resource; sending it again would only 404.
    const byValue = new Map<string, CaptureIdentity[]>()
    for (const entry of uncleaned) {
      if (entry.variable !== variable || entry.unavailable) {
        continue
      }
      byValue.set(entry.value, [...(byValue.get(entry.value) ?? []), identityOf(entry)])
    }
    return [...byValue].map(([value, identities]) => {
      expansions.push({ stepId: step.stepId, identities })
      return { step, iterationValue: { variable, value } }
    })
  }

  const finalize: RunCleanup['finalize'] = async (steps) => {
    // Why: results for one step arrive in expansion order, so the nth result maps to the nth expansion.
    const seen = new Map<string, number>()
    let cleaned = 0
    for (const result of steps) {
      if (result.phase !== 'cleanup' || !result.iterationValue) {
        continue
      }
      const nth = seen.get(result.stepId) ?? 0
      seen.set(result.stepId, nth + 1)
      const expansion = expansions.filter((e) => e.stepId === result.stepId)[nth]
      if (result.result !== 'pass' || !expansion) {
        continue
      }
      for (const identity of expansion.identities) {
        await deps.ledger.markCleaned(deps.worktreeId, deps.collectionId, identity, {
          runId: deps.runId,
          stepId: result.stepId,
          at: now()
        })
      }
      cleaned += expansion.identities.length
    }
    const remaining = await deps.ledger.listUncleaned(deps.worktreeId, deps.collectionId)
    return { cleaned, notCleaned: remaining.map((entry) => toNotCleaned(entry, deps.maskText)) }
  }

  return { expandCleanup, finalize }
}

function toNotCleaned(entry: CapturedValue, maskText: (text: string) => string): NotCleanedValue {
  if (entry.unavailable) {
    return { variable: entry.variable, valueMasked: SECRET_MASK, unavailable: true }
  }
  return {
    variable: entry.variable,
    valueMasked: isSensitiveVariableName(entry.variable) ? SECRET_MASK : maskText(entry.value)
  }
}
