import { getSecretStore, type SecretStore } from '../../shared/secret-store'
import type { Environment } from '../../shared/api-client/api-client-types'
import { openSecretCipher, sealSecretValue, UNSEALED_CIPHER } from '../secret-value-codec'
import type {
  PersistedEnvironment,
  PersistedEnvironmentVariable
} from '../../shared/api-client/api-client-schemas'

export function encryptEnvironmentSecrets(
  environment: Environment,
  store: SecretStore = getSecretStore()
): PersistedEnvironment {
  const variables: PersistedEnvironmentVariable[] = environment.variables.map((variable) => {
    if (variable.type === 'secret') {
      return {
        key: variable.key,
        enabled: variable.enabled,
        type: 'secret',
        cipher: variable.value === null ? UNSEALED_CIPHER : sealSecretValue(variable.value, store)
      }
    }
    return {
      key: variable.key,
      enabled: variable.enabled,
      type: 'default',
      value: variable.value ?? ''
    }
  })
  return {
    id: environment.id,
    name: environment.name,
    variables,
    revision: environment.revision,
    postmanExtra: environment.postmanExtra
  }
}

export function decryptEnvironmentSecrets(
  persisted: PersistedEnvironment,
  store: SecretStore = getSecretStore()
): Environment {
  return {
    id: persisted.id,
    name: persisted.name,
    revision: persisted.revision,
    postmanExtra: persisted.postmanExtra,
    variables: persisted.variables.map((variable) => {
      if (variable.type === 'secret') {
        const value = openSecretCipher(variable.cipher, store)
        return {
          key: variable.key,
          enabled: variable.enabled,
          type: 'secret' as const,
          value,
          ...(value === null ? { needsReentry: true } : {})
        }
      }
      return {
        key: variable.key,
        enabled: variable.enabled,
        type: 'default' as const,
        value: variable.value
      }
    })
  }
}
