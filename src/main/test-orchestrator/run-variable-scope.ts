import type {
  Environment,
  EnvironmentVariable,
  Variable
} from '../../shared/api-client/api-client-types'
import {
  buildScopeChain,
  resolveTemplate,
  type ResolvedText
} from '../../shared/api-client/variable-resolution'
import type { RunSensitiveValues } from '../../shared/test-orchestrator/run-sensitive-values'
import type { CapturedValue } from '../../shared/test-orchestrator/test-orchestrator-types'
import type { ExecuteRequestInput } from '../api-client/request-execution'
import type { VariableWrites } from '../api-client/script-sandbox/script-sandbox-types'

export type RunInput = { name: string; value: string; secret: boolean }

export type RunVariableScopeOptions = {
  runId: string
  worktreeId: string
  collectionId: string
  environment: Pick<Environment, 'variables'> | null
  collectionVariables: readonly Variable[]
  inputs: readonly RunInput[]
  sensitive: RunSensitiveValues
  ledger: {
    append: (worktreeId: string, collectionId: string, value: CapturedValue) => Promise<void>
  }
  now?: () => number
}

type VariableSink = NonNullable<ExecuteRequestInput['variableSink']>
type ScopeFolder = { name: string; variables: readonly Variable[] }

export type RunVariableScope = {
  /** Fresh copies, so a request's script cannot mutate the run's scope except through the sink. */
  overlay: () => { environment: EnvironmentVariable[]; collection: Variable[] }
  /** Applies a step's script writes and records each assigned value (FR-002d). */
  sinkFor: (stepId: string) => VariableSink
  /** Applies a test-map capture into the environment scope. */
  capture: (stepId: string, variable: string, value: string) => Promise<void>
  /** Replaces a run input's value (credentials resume); secrets join the masked set. */
  setInput: (name: string, value: string, secret: boolean) => void
  /** Resolves `{{name}}` the way a request would; `folders` are the step's ancestors, outermost first. */
  resolve: (text: string, folders?: readonly ScopeFolder[]) => ResolvedText
}

function setEnvironmentValue(list: EnvironmentVariable[], key: string, value: string): boolean {
  const index = list.findLastIndex((entry) => entry.key === key && entry.enabled)
  if (index === -1) {
    list.push({ key, value, enabled: true, type: 'default' })
    return false
  }
  const isSecret = list[index].type === 'secret'
  list[index] = { ...list[index], value, needsReentry: undefined }
  return isSecret
}

function setCollectionValue(list: Variable[], key: string, value: string): void {
  const index = list.findLastIndex((entry) => entry.key === key && entry.enabled)
  if (index === -1) {
    list.push({ key, value, enabled: true })
  } else {
    list[index] = { ...list[index], value }
  }
}

export function createRunVariableScope(options: RunVariableScopeOptions): RunVariableScope {
  const { sensitive } = options
  const now = options.now ?? Date.now
  const environment: EnvironmentVariable[] = (options.environment?.variables ?? []).map((v) => ({
    ...v
  }))
  const collection: Variable[] = options.collectionVariables.map((v) => ({ ...v }))

  sensitive.addEnvironment(options.environment)
  const setInput = (name: string, value: string, secret: boolean): void => {
    setEnvironmentValue(environment, name, value)
    if (secret) {
      const index = environment.findLastIndex((entry) => entry.key === name)
      environment[index] = { ...environment[index], type: 'secret' }
      sensitive.addSecret(value)
    }
  }
  for (const input of options.inputs) {
    setInput(input.name, input.value, input.secret)
  }

  const record = async (
    stepId: string,
    variable: string,
    value: string,
    source: CapturedValue['source']
  ): Promise<void> => {
    // Why: the value must be masked before anything below can write it to disk or evidence.
    sensitive.addCaptured(variable, value)
    await options.ledger.append(options.worktreeId, options.collectionId, {
      variable,
      value,
      capturedAt: now(),
      runId: options.runId,
      stepId,
      source,
      cleaned: null
    })
  }

  const applyWrites = async (
    stepId: string,
    writes: { environment: VariableWrites; collection: VariableWrites }
  ): Promise<void> => {
    for (const key of writes.environment.unset) {
      for (let i = environment.length - 1; i >= 0; i--) {
        if (environment[i].key === key) {
          environment.splice(i, 1)
        }
      }
    }
    for (const key of writes.collection.unset) {
      for (let i = collection.length - 1; i >= 0; i--) {
        if (collection[i].key === key) {
          collection.splice(i, 1)
        }
      }
    }
    for (const [key, value] of Object.entries(writes.environment.set)) {
      if (setEnvironmentValue(environment, key, value)) {
        sensitive.addSecret(value)
      }
      await record(stepId, key, value, 'script')
    }
    for (const [key, value] of Object.entries(writes.collection.set)) {
      setCollectionValue(collection, key, value)
      await record(stepId, key, value, 'script')
    }
  }

  return {
    overlay: () => ({
      environment: environment.map((v) => ({ ...v })),
      collection: collection.map((v) => ({ ...v }))
    }),
    sinkFor: (stepId) => (writes) => applyWrites(stepId, writes),
    capture: async (stepId, variable, value) => {
      setEnvironmentValue(environment, variable, value)
      await record(stepId, variable, value, 'test-map')
    },
    setInput,
    resolve: (text, folders = []) =>
      resolveTemplate(text, buildScopeChain({ environment, folders, collection }))
  }
}
