import { getSecretStore, type SecretStore } from '../../shared/secret-store'
import type { Environment, SecretProtection } from '../../shared/api-client/api-client-types'
import type {
  PersistedEnvironment,
  PersistedEnvironmentVariable
} from '../../shared/api-client/api-client-schemas'

/** Empty cipher marks a secret whose value was never written (encryption unavailable). */
export const UNSEALED_CIPHER = ''

/** Returns the base64 cipher, or `UNSEALED_CIPHER` when the host cannot encrypt (FR-009a). */
export function sealSecretValue(value: string, store: SecretStore = getSecretStore()): string {
  if (!store.isEncryptionAvailable()) {
    return UNSEALED_CIPHER
  }
  return store.encryptString(value).toString('base64')
}

/** `null` means the value must be re-entered (FR-009b). */
export function openSecretCipher(
  cipher: string,
  store: SecretStore = getSecretStore()
): string | null {
  if (cipher === UNSEALED_CIPHER || !store.isEncryptionAvailable()) {
    return null
  }
  try {
    return store.decryptString(Buffer.from(cipher, 'base64'))
  } catch {
    return null
  }
}

export function getSecretProtection(
  store: SecretStore = getSecretStore()
): SecretProtection | null {
  const message = store.describeProtectionGap()
  if (message === null) {
    return null
  }
  return { level: store.isEncryptionAvailable() ? 'weak' : 'memory-only', message }
}

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
