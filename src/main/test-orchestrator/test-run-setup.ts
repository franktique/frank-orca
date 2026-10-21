// Setup-screen model and remembered inputs for a test run (FR-005a, FR-007, FR-008).
import type { RunSetupModel } from '../../preload/api/test-run-api'
import type {
  DatabaseModeChoice,
  PlanSettings,
  RunDatabaseMode,
  RunInput,
  TestMapEntry,
  TestMapRef
} from '../../shared/test-orchestrator/test-orchestrator-types'
import type { TestMapStore } from './test-map-store'
import type { PlanContext } from './test-run-plan-context'
import { deriveStepInputs } from './test-run-plan-context'

const refLabel = (ref: TestMapRef): string => ('path' in ref ? ref.path.join(' / ') : ref.id)

/** Remembered values first, then anything the user typed (blank never overwrites). */
export function mergeRememberedInputs(
  settings: PlanSettings | null,
  provided: Readonly<Record<string, string>>
): Record<string, string> {
  const merged: Record<string, string> = {
    ...settings?.inputs,
    ...settings?.secretInputs
  }
  for (const [name, value] of Object.entries(provided)) {
    if (value !== '') {
      merged[name] = value
    }
  }
  return merged
}

function problemFor(entry: TestMapEntry): string | null {
  switch (entry.link.state) {
    case 'broken':
      return `The request for ${refLabel(entry.ref)} was removed.`
    case 'unmatched':
      return `No request matches ${refLabel(entry.ref)}.`
    case 'ambiguous':
      return `More than one request matches ${refLabel(entry.ref)}.`
    case 'linked':
      return null
  }
}

export function buildSetupModel(args: {
  context: PlanContext
  settings: PlanSettings | null
  unavailableSecretInputs: readonly string[]
  uncleanedCaptures: number
  activeRunId: string | null
}): RunSetupModel {
  const { context, settings } = args
  const steps: RunSetupModel['steps'] = context.steps.map((step) => ({
    stepId: step.stepId,
    title: step.title,
    phase: step.phase,
    queries: [...(step.entry?.before ?? []), ...(step.entry?.after ?? [])],
    problems: []
  }))
  context.testMap?.entries.forEach((entry, index) => {
    const problem = problemFor(entry)
    if (problem) {
      steps.push({
        stepId: entry.stepId ?? `link-problem-${index + 1}`,
        title: entry.title ?? refLabel(entry.ref),
        phase: entry.phase ?? 'scenario',
        queries: [...entry.before, ...entry.after],
        problems: [problem]
      })
    }
  })
  const unavailable = new Set(args.unavailableSecretInputs)
  const inputs = deriveStepInputs(context, {}).map((input) =>
    toSetupInput(input, settings, unavailable)
  )
  const dataChangingSteps = context.steps.flatMap((step) => {
    const queryIds = [...(step.entry?.before ?? []), ...(step.entry?.after ?? [])]
      .filter((query) => query.changesData)
      .map((query) => query.id)
    return queryIds.length > 0 ? [{ stepId: step.stepId, queryIds }] : []
  })
  return {
    steps,
    inputs,
    hasQueries: steps.some((step) => step.queries.length > 0),
    dataChangingSteps,
    rememberedMode: settings?.databaseMode?.mode ?? null,
    uncleanedCaptures: args.uncleanedCaptures,
    ...(args.activeRunId ? { activeRunId: args.activeRunId } : {})
  }
}

function toSetupInput(
  input: RunInput,
  settings: PlanSettings | null,
  unavailable: ReadonlySet<string>
): RunSetupModel['inputs'][number] {
  if (input.secret) {
    // Why: secret values never leave main; the form only learns that one is remembered.
    const hasRemembered =
      Boolean(settings?.secretInputs[input.name]) && !unavailable.has(input.name)
    return { name: input.name, secret: true, required: input.required, hasRemembered }
  }
  const remembered = settings?.inputs[input.name]
  return {
    name: input.name,
    secret: false,
    required: input.required,
    ...(remembered !== undefined ? { value: remembered } : {}),
    hasRemembered: remembered !== undefined
  }
}

/** Applies the user's remember choices to the stored settings; secret values stay sealed by the store. */
export function applyRememberChoices(args: {
  existing: PlanSettings | null
  collectionId: string
  environmentId: string
  inputs: readonly RunInput[]
  effective: Readonly<Record<string, string>>
  remember: { inputs: boolean; secrets: boolean }
  databaseMode: PlanSettings['databaseMode']
}): PlanSettings | null {
  if (!args.remember.inputs && !args.remember.secrets) {
    return null
  }
  const next: PlanSettings = {
    collectionId: args.collectionId,
    environmentId: args.environmentId,
    inputs: { ...args.existing?.inputs },
    secretInputs: { ...args.existing?.secretInputs },
    ...(args.existing?.databaseMode ? { databaseMode: args.existing.databaseMode } : {})
  }
  for (const input of args.inputs) {
    const value = args.effective[input.name]
    if (value === undefined || value === '') {
      continue
    }
    if (input.secret && args.remember.secrets) {
      next.secretInputs[input.name] = value
    } else if (!input.secret && args.remember.inputs) {
      next.inputs[input.name] = value
    }
  }
  if (args.remember.inputs && args.databaseMode) {
    next.databaseMode = args.databaseMode
  }
  return next
}

/** Saves the remember choices unless the stored settings are read-only. */
export async function saveRememberChoices(
  store: Pick<TestMapStore, 'savePlanSettings'>,
  worktreeId: string,
  readOnly: boolean,
  args: Parameters<typeof applyRememberChoices>[0]
): Promise<void> {
  const next = applyRememberChoices(args)
  if (!next || readOnly) {
    return
  }
  try {
    await store.savePlanSettings(worktreeId, args.collectionId, next)
  } catch {
    // Why: failing to remember inputs must not stop the run the user just asked for.
  }
}

export function toRunDatabaseMode(
  choice: DatabaseModeChoice | null,
  connectionName?: string
): RunDatabaseMode {
  switch (choice?.mode) {
    case 'automatic':
      return { mode: 'automatic', connectionName: connectionName ?? choice.connectionId }
    case 'browser':
      return { mode: 'browser', site: choice.origin }
    case 'manual':
      return { mode: 'manual' }
    case undefined:
      return { mode: 'none' }
  }
}
