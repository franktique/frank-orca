// Re-checks hosts and inputs on Start; the setup screen's checks are advisory only (FR-005f, FR-007).
import { resolvePlanTargetHosts } from '../../shared/test-orchestrator/plan-target-hosts'
import type { TestRunErrorCode } from '../../shared/test-orchestrator/test-orchestrator-ipc-schemas'
import type { RunInput } from '../../shared/test-orchestrator/test-orchestrator-types'
import { deriveStepInputs, type PlanContext } from './test-run-plan-context'

export type StartChecksResult =
  | { ok: true; inputs: RunInput[]; hosts: string[] }
  | { ok: false; code: TestRunErrorCode; message: string }

export function resolveTargets(context: PlanContext, inputs: Readonly<Record<string, string>>) {
  return resolvePlanTargetHosts({
    steps: context.steps,
    environment: context.environment.variables,
    inputs,
    allowedHosts: context.testMap?.allowedHosts
  })
}

export function checkRunStart(
  context: PlanContext,
  effectiveInputs: Readonly<Record<string, string>>,
  confirmedHosts: readonly string[]
): StartChecksResult {
  const targets = resolveTargets(context, effectiveInputs)
  if (targets.refused) {
    const { host, allowedHosts } = targets.refused
    return {
      ok: false,
      code: 'host-not-allowed',
      message: `${host} is not on this plan's allowed hosts (${allowedHosts.join(', ')}).`
    }
  }
  const inputs = deriveStepInputs(context, effectiveInputs)
  const missing = [
    ...inputs.filter((input) => input.required && input.value === '').map((input) => input.name),
    ...targets.unresolved
  ]
  if (missing.length > 0) {
    return {
      ok: false,
      code: 'missing-inputs',
      message: `Fill in: ${[...new Set(missing)].join(', ')}.`
    }
  }
  const confirmed = new Set(confirmedHosts.map((host) => host.toLowerCase()))
  const unconfirmed = targets.hosts.find(
    ({ host, local }) => !local && !confirmed.has(host.toLowerCase())
  )
  if (unconfirmed) {
    return {
      ok: false,
      code: 'host-unconfirmed',
      message: `Confirm that ${unconfirmed.host} is the right target before starting.`
    }
  }
  return { ok: true, inputs, hosts: targets.hosts.map(({ host }) => host) }
}
