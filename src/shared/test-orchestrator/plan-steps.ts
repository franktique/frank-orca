import { flattenRequestsDepthFirst, findNode } from '../api-client/collection-tree'
import { resolveEffectiveAuth } from '../api-client/request-auth'
import type { ApiRequest, Collection } from '../api-client/api-client-types'
import { collectQueryVariables, collectRequestVariables } from './plan-inputs'
import { derivePhaseFromFolderName } from './plan-phases'
import type {
  Phase,
  RequestScopeSnapshot,
  TestMap,
  TestMapEntry,
  TestPlanStep
} from './test-orchestrator-types'

const PHASE_ORDER: readonly Phase[] = ['preflight', 'setup', 'scenario', 'cleanup']
const STEP_ID_PREFIX: Record<Phase, string> = {
  preflight: 'P',
  setup: 'S',
  scenario: 'SC',
  cleanup: 'C'
}

type PlannedRequest = {
  request: ApiRequest
  scope: RequestScopeSnapshot
  entry: TestMapEntry | null
  phase: Phase
  variables: string[]
}

const SCRIPT_SET_PATTERN =
  /pm\.(?:environment|collectionVariables|variables|globals)\.set\(\s*['"]([^'"]+)['"]/g

function scriptWrittenVariables(request: ApiRequest): string[] {
  const source = (request.events.test?.exec ?? []).join('\n')
  return [...source.matchAll(SCRIPT_SET_PATTERN)].map((match) => match[1])
}

function planRequest(
  collection: Collection,
  request: ApiRequest,
  entry: TestMapEntry | null
): PlannedRequest {
  const ancestors = findNode(collection, request.id)?.ancestors ?? []
  const effectiveAuth = resolveEffectiveAuth([collection, ...ancestors, request])
  const queries = [...(entry?.before ?? []), ...(entry?.after ?? [])]
  const variables = new Set([
    ...collectRequestVariables(request, effectiveAuth),
    ...collectQueryVariables(queries),
    ...(entry?.forEach ? [entry.forEach] : [])
  ])
  return {
    request,
    entry,
    variables: [...variables],
    phase:
      entry?.phase ?? (ancestors[0] ? derivePhaseFromFolderName(ancestors[0].name) : 'scenario'),
    scope: {
      collection: structuredClone({ ...collection, items: [] }),
      folders: ancestors.map((folder) => structuredClone({ ...folder, items: [] }))
    }
  }
}

/** Phases in fixed order; inside a phase, collection order. `dependsOn` never reorders (R3). */
export function buildPlanSteps(args: {
  collection: Collection
  testMap: TestMap | null
  /** `stepId`s whose data-changing queries the user approved. */
  approvedStepIds?: ReadonlySet<string>
}): TestPlanStep[] {
  const entryByRequest = new Map<string, TestMapEntry>()
  for (const entry of args.testMap?.entries ?? []) {
    if (entry.link.state === 'linked') {
      entryByRequest.set(entry.link.requestId, entry)
    }
  }

  const planned = flattenRequestsDepthFirst(args.collection).map((request) =>
    planRequest(args.collection, request, entryByRequest.get(request.id) ?? null)
  )

  const groups: PlannedRequest[][] = []
  const groupByKey = new Map<string, PlannedRequest[]>()
  for (const item of planned) {
    const name = item.entry?.concurrentGroup
    const key = name ? `${item.phase}\u0000${name}` : null
    const existing = key ? groupByKey.get(key) : undefined
    if (existing) {
      existing.push(item)
      continue
    }
    const group = [item]
    groups.push(group)
    if (key) {
      groupByKey.set(key, group)
    }
  }

  const ordered = PHASE_ORDER.flatMap((phase) => groups.filter((group) => group[0].phase === phase))
  const usedIds = new Set(
    ordered.map((group) => group[0].entry?.stepId).filter((id): id is string => Boolean(id))
  )
  const counters: Record<Phase, number> = { preflight: 0, setup: 0, scenario: 0, cleanup: 0 }
  const capturedBefore = new Set<string>()

  return ordered.map((group, index) => {
    const [first] = group
    const { phase, entry } = first
    let stepId = entry?.stepId
    if (!stepId) {
      do {
        counters[phase] += 1
        stepId = `${STEP_ID_PREFIX[phase]}-${counters[phase]}`
      } while (usedIds.has(stepId))
      usedIds.add(stepId)
    }
    const used = new Set(group.flatMap((item) => item.variables))
    const step: TestPlanStep = {
      index,
      stepId,
      title:
        entry?.title ??
        (group.length > 1 ? entry?.concurrentGroup : undefined) ??
        first.request.name,
      phase,
      requests: group.map((item) => ({
        requestId: item.request.id,
        snapshot: structuredClone(item.request),
        scope: item.scope
      })),
      entry,
      requiredVariables: [...used].filter((name) => capturedBefore.has(name)),
      approvedDataChange: args.approvedStepIds?.has(stepId) ?? false
    }
    for (const item of group) {
      for (const capture of item.entry?.captures ?? []) {
        capturedBefore.add(capture.variable)
      }
      for (const name of scriptWrittenVariables(item.request)) {
        capturedBefore.add(name)
      }
    }
    return step
  })
}
