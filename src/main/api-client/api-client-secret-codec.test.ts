import { describe, expect, it } from 'vitest'
import type { SecretStore } from '../../shared/secret-store'
import type { Environment } from '../../shared/api-client/api-client-types'
import {
  decryptEnvironmentSecrets,
  encryptEnvironmentSecrets,
  getSecretProtection,
  UNSEALED_CIPHER
} from './api-client-secret-codec'

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

function environment(): Environment {
  return {
    id: 'env-1',
    name: 'Env',
    revision: 1,
    postmanExtra: {},
    variables: [
      { key: 'baseUrl', value: 'http://x', enabled: true, type: 'default' },
      { key: 'token', value: 'super-secret-token', enabled: true, type: 'secret' }
    ]
  }
}

describe('api-client secret codec', () => {
  it('round-trips secrets through encryption', () => {
    const store = fakeStore()
    const persisted = encryptEnvironmentSecrets(environment(), store)
    expect(decryptEnvironmentSecrets(persisted, store).variables).toEqual(environment().variables)
  })

  it('never writes the plain secret value', () => {
    const persisted = encryptEnvironmentSecrets(environment(), fakeStore())
    expect(JSON.stringify(persisted)).not.toContain('super-secret-token')
    const secret = persisted.variables[1]
    expect(secret).toMatchObject({ type: 'secret' })
    expect('value' in secret).toBe(false)
  })

  it('flags a secret that cannot be decrypted for re-entry', () => {
    const persisted = encryptEnvironmentSecrets(environment(), fakeStore())
    const broken = {
      ...persisted,
      variables: persisted.variables.map((v) =>
        v.type === 'secret' ? { ...v, cipher: Buffer.from('garbage').toString('base64') } : v
      )
    }
    const opened = decryptEnvironmentSecrets(broken, fakeStore())
    expect(opened.variables[1]).toMatchObject({ value: null, needsReentry: true })
    expect(opened.variables[0]).toMatchObject({ value: 'http://x' })
  })

  it('writes no secret value when encryption is unavailable', () => {
    const persisted = encryptEnvironmentSecrets(environment(), fakeStore({ available: false }))
    expect(JSON.stringify(persisted)).not.toContain('super-secret-token')
    expect(persisted.variables[1]).toMatchObject({ type: 'secret', cipher: UNSEALED_CIPHER })
    const opened = decryptEnvironmentSecrets(persisted, fakeStore({ available: false }))
    expect(opened.variables[1]).toMatchObject({ value: null, needsReentry: true })
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

  it('still encrypts and writes cipher text under a weak backend', () => {
    const store = fakeStore({ available: true, gap: 'basic text' })
    const persisted = encryptEnvironmentSecrets(environment(), store)
    expect(persisted.variables[1]).toMatchObject({ type: 'secret' })
    expect(persisted.variables[1]).not.toMatchObject({ cipher: UNSEALED_CIPHER })
    expect(getSecretProtection(store)?.level).toBe('weak')
  })
})
