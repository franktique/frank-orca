import { getSecretStore, type SecretStore } from '../shared/secret-store'

export type SecretProtection = { level: 'memory-only' | 'weak'; message: string }

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
