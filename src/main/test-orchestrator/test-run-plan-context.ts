// Resolves everything a run setup or start needs from one collection + environment (FR-004, FR-005a).
import type { ApiNodeId, Collection, Environment } from '../../shared/api-client/api-client-types'
import { resolveEffectiveAuth } from '../../shared/api-client/request-auth'
import {
  collectQueryVariables,
  collectRequestVariables,
  deriveRunInputs
} from '../../shared/test-orchestrator/plan-inputs'
import { buildPlanSteps } from '../../shared/test-orchestrator/plan-steps'
import type {
  RunInput,
  TestMap,
  TestPlanStep
} from '../../shared/test-orchestrator/test-orchestrator-types'

export type PlanContext = {
  collection: Collection
  environment: Environment
  testMap: TestMap | null
  steps: TestPlanStep[]
}

export type PlanApiState = {
  collections: Map<ApiNodeId, Collection>
  environments?: Map<ApiNodeId, Environment>
}

export type PlanContextResult = { ok: true; context: PlanContext } | { ok: false; message: string }

export function resolvePlanContext(args: {
  state: PlanApiState
  collectionId: ApiNodeId
  environmentId: ApiNodeId
  testMap: TestMap | null
  approvedStepIds?: ReadonlySet<string>
}): PlanContextResult {
  const collection = args.state.collections.get(args.collectionId)
  if (!collection) {
    return { ok: false, message: 'The collection no longer exists.' }
  }
  const environment = args.state.environments?.get(args.environmentId)
  if (!environment) {
    return { ok: false, message: 'The environment no longer exists.' }
  }
  const steps = buildPlanSteps({
    collection,
    testMap: args.testMap,
    approvedStepIds: args.approvedStepIds
  })
  return { ok: true, context: { collection, environment, testMap: args.testMap, steps } }
}

/** Empty environment variables become inputs; `required` when a request or query uses them. */
export function deriveStepInputs(
  context: PlanContext,
  provided: Readonly<Record<string, string>>
): RunInput[] {
  const referenced = new Set<string>()
  for (const step of context.steps) {
    for (const { snapshot, scope } of step.requests) {
      const auth = resolveEffectiveAuth([scope.collection, ...scope.folders, snapshot])
      collectRequestVariables(snapshot, auth).forEach((name) => referenced.add(name))
    }
    const queries = [...(step.entry?.before ?? []), ...(step.entry?.after ?? [])]
    collectQueryVariables(queries).forEach((name) => referenced.add(name))
  }
  return deriveRunInputs({
    environment: context.environment.variables,
    referenced,
    provided
  })
}
