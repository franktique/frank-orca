import { describe, expect, it } from 'vitest'
import type { SecretStore } from '../shared/secret-store'
import {
  getSecretProtection,
  openSecretCipher,
  sealSecretValue,
  UNSEALED_CIPHER
} from './secret-value-codec'

function fakeStore(options: { available?: boolean; gap?: string | null } = {}): SecretStore {
  const available = options.available ?? true
  return {
    isEncryptionAvailable: () => available,
    encryptString: (plain) => Buffer.from(`sealed:${Buffer.from(plain).toString('hex')}`),
    decryptString: (cipher) => {
      const text = cipher.toString()
      if (!text.startsWith('sealed:')) {
        throw new Error('bad cipher')
      }
      return Buffer.from(text.slice('sealed:'.length), 'hex').toString()
    },
    describeProtectionGap: () => options.gap ?? null
  }
}

describe('secret value codec', () => {
  it('round-trips a value and never exposes it in the cipher', () => {
    const store = fakeStore()
    const cipher = sealSecretValue('hunter2', store)
    expect(Buffer.from(cipher, 'base64').toString()).not.toContain('hunter2')
    expect(openSecretCipher(cipher, store)).toBe('hunter2')
  })

  it('seals nothing when encryption is unavailable', () => {
    const store = fakeStore({ available: false })
    expect(sealSecretValue('hunter2', store)).toBe(UNSEALED_CIPHER)
    expect(openSecretCipher(UNSEALED_CIPHER, store)).toBeNull()
  })

  it('returns null for a cipher that cannot be decrypted', () => {
    expect(openSecretCipher(Buffer.from('garbage').toString('base64'), fakeStore())).toBeNull()
  })

  it('reports memory-only when encryption is unavailable and weak for basic_text', () => {
    expect(getSecretProtection(fakeStore({ available: false, gap: 'no keyring' }))).toEqual({
      level: 'memory-only',
      message: 'no keyring'
    })
    expect(getSecretProtection(fakeStore({ available: true, gap: 'basic text' }))).toEqual({
      level: 'weak',
      message: 'basic text'
    })
    expect(getSecretProtection(fakeStore())).toBeNull()
  })
})
