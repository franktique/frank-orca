import type {
  DraftEnvironment,
  DraftEnvironmentVariable
} from '../../../../shared/api-client/api-client-ipc-schemas'
import type {
  ApiNodeId,
  Environment,
  VariableType
} from '../../../../shared/api-client/api-client-types'

/** One row of the environment editor. Secrets arrive masked and stay masked until revealed. */
export type EditableEnvironmentVariable = {
  key: string
  value: string
  enabled: boolean
  type: VariableType
  /** The secret exists but its value was withheld; nothing was typed or revealed. */
  masked: boolean
  /** Decryption failed on this machine (FR-009b). */
  needsReentry: boolean
  /** The plain value fetched by Reveal, so an untouched revealed secret still counts as unchanged. */
  revealedValue: string | null
}

export type EnvironmentDraft = {
  kind: 'environment'
  environmentId: ApiNodeId
  name: string
  variables: EditableEnvironmentVariable[]
  /** Revision of the environment this draft was started from. */
  baseRevision: number
  changedElsewhere: boolean
  conflict: boolean
}

export function toEditableVariables(environment: Environment): EditableEnvironmentVariable[] {
  return environment.variables.map((variable) => ({
    key: variable.key,
    value: variable.value ?? '',
    enabled: variable.enabled,
    type: variable.type,
    masked: variable.masked === true,
    needsReentry: variable.needsReentry === true,
    revealedValue: null
  }))
}

export function startEnvironmentDraft(
  stored: Environment,
  patch: { name?: string; variables?: EditableEnvironmentVariable[] } = {}
): EnvironmentDraft {
  return {
    kind: 'environment',
    environmentId: stored.id,
    name: patch.name ?? stored.name,
    variables: patch.variables ?? toEditableVariables(stored),
    baseRevision: stored.revision,
    changedElsewhere: false,
    conflict: false
  }
}

const isUntouchedSecret = (variable: EditableEnvironmentVariable): boolean =>
  variable.type === 'secret' &&
  (variable.masked ||
    (variable.revealedValue !== null && variable.value === variable.revealedValue))

export function isEnvironmentUnchanged(
  edited: { name: string; variables: readonly EditableEnvironmentVariable[] },
  stored: Environment
): boolean {
  if (edited.name !== stored.name || edited.variables.length !== stored.variables.length) {
    return false
  }
  const original = toEditableVariables(stored)
  return edited.variables.every((variable, index) => {
    const before = original[index]
    if (
      variable.key !== before.key ||
      variable.enabled !== before.enabled ||
      variable.type !== before.type
    ) {
      return false
    }
    return before.masked ? isUntouchedSecret(variable) : variable.value === before.value
  })
}

/** An untouched secret is sent without a value, so its stored cipher is kept as is. */
export function toDraftEnvironmentPayload(draft: EnvironmentDraft): DraftEnvironment {
  const variables: DraftEnvironmentVariable[] = draft.variables.map((variable) =>
    isUntouchedSecret(variable)
      ? { key: variable.key, enabled: variable.enabled, type: 'secret', unchanged: true }
      : { key: variable.key, value: variable.value, enabled: variable.enabled, type: variable.type }
  )
  return { id: draft.environmentId, name: draft.name, variables }
}
