import type {
  ApiClientResult,
  DraftEnvironment,
  EnvOpParams
} from '../../shared/api-client/api-client-ipc-schemas'
import type { ApiNodeId, Environment } from '../../shared/api-client/api-client-types'
import type {
  PersistedEnvironment,
  PersistedEnvironmentVariable
} from '../../shared/api-client/api-client-schemas'
import { sealSecretValue, getSecretProtection } from '../secret-value-codec'
import { failure, type ApiClientStore, type WorktreeApiState } from './api-client-store'
import type { StoreTransaction } from './api-client-store-transaction'

const COPY_SUFFIX = ' copy'

function notFound(what: string): ReturnType<typeof failure> {
  return failure('not-found', `${what} not found.`)
}

export function applyEnvOp(
  store: ApiClientStore,
  data: WorktreeApiState,
  tx: StoreTransaction,
  params: EnvOpParams
): ApiClientResult<{ id?: ApiNodeId }> {
  if (params.op === 'create') {
    const id = store.newId()
    data.environments.set(id, {
      id,
      name: params.name?.trim() || 'New Environment',
      variables: [],
      revision: 0,
      postmanExtra: {}
    })
    tx.touchEnvironment(id)
    return { ok: true, id }
  }

  const environment = data.environments.get(params.id)
  if (!environment) {
    return notFound('Environment')
  }
  switch (params.op) {
    case 'rename':
      environment.name = params.name
      tx.touchEnvironment(environment.id)
      return { ok: true, id: environment.id }
    case 'duplicate': {
      const id = store.newId()
      // Secret values are plain in memory, so the copy is sealed afresh when it is written.
      data.environments.set(id, {
        ...structuredClone(environment),
        id,
        name: `${environment.name}${COPY_SUFFIX}`.slice(0, 200),
        revision: 0
      })
      tx.touchEnvironment(id)
      return { ok: true, id }
    }
    case 'delete':
      data.environments.delete(environment.id)
      tx.removeEnvironment(environment.id)
      if (data.state.activeEnvironmentId === environment.id) {
        data.state.activeEnvironmentId = null
        tx.touchState('active-environment')
      }
      return { ok: true, id: environment.id }
  }
}

/** Pairs an untouched secret with the stored variable at the same position and key. */
function previousSecretAt(
  environment: Environment,
  index: number,
  key: string
): Environment['variables'][number] | null {
  const previous = environment.variables[index]
  return previous && previous.type === 'secret' && previous.key === key ? previous : null
}

export function applySaveEnvironment(
  store: ApiClientStore,
  data: WorktreeApiState,
  tx: StoreTransaction,
  draft: DraftEnvironment,
  baseRevision: number
): ApiClientResult<{ revision: number }> {
  const environment = data.environments.get(draft.id)
  if (!environment) {
    return notFound('Environment')
  }
  if (environment.revision !== baseRevision) {
    return failure('conflict', 'This environment was changed elsewhere.')
  }
  const previousPersisted = data.persistedEnvironments.get(environment.id)
  const secretStore = store.secretStore

  const variables: Environment['variables'] = []
  const persistedVariables: PersistedEnvironmentVariable[] = []
  for (const [index, variable] of draft.variables.entries()) {
    if ('unchanged' in variable) {
      const previous = previousSecretAt(environment, index, variable.key)
      const previousCipher = previousPersisted?.variables[index]
      if (!previous || previousCipher?.type !== 'secret' || previousCipher.key !== variable.key) {
        return failure('not-found', `No stored value to keep for secret "${variable.key}".`)
      }
      variables.push({ ...previous, enabled: variable.enabled })
      // Byte-for-byte: re-sealing would change the cipher text of a value nobody touched.
      persistedVariables.push({ ...previousCipher, enabled: variable.enabled })
      continue
    }
    variables.push({
      key: variable.key,
      value: variable.value,
      enabled: variable.enabled,
      type: variable.type
    })
    persistedVariables.push(
      variable.type === 'secret'
        ? {
            key: variable.key,
            enabled: variable.enabled,
            type: 'secret',
            cipher: sealSecretValue(variable.value, secretStore)
          }
        : { key: variable.key, enabled: variable.enabled, type: 'default', value: variable.value }
    )
  }

  environment.name = draft.name
  environment.variables = variables
  tx.touchEnvironment(environment.id)
  const persisted: PersistedEnvironment = {
    id: environment.id,
    name: environment.name,
    variables: persistedVariables,
    revision: environment.revision,
    postmanExtra: environment.postmanExtra
  }
  data.persistedEnvironments.set(environment.id, persisted)
  const protection = variables.some((v) => v.type === 'secret')
    ? getSecretProtection(secretStore)
    : null
  return {
    ok: true,
    revision: environment.revision,
    ...(protection ? { secretProtection: protection } : {})
  }
}
