import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { SecretStore } from '../../shared/secret-store'
import { envOp, saveEnvironment } from './api-client-operations'
import { ApiClientStore } from './api-client-store'
import { getApiClientWorktreePaths } from './api-client-storage-paths'

// A nonce makes every seal differ, so only an untouched cipher can compare equal byte-for-byte.
function nonceSecretStore(): SecretStore {
  let nonce = 0
  return {
    isEncryptionAvailable: () => true,
    encryptString: (plain) => Buffer.from(`n${++nonce}:${plain}`),
    decryptString: (cipher) => cipher.toString().replace(/^n\d+:/, ''),
    describeProtectionGap: () => null
  }
}

const WT = 'wt'
let root: string
let store: ApiClientStore
let counter = 0

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'api-client-env-'))
  const secretStore = nonceSecretStore()
  store = new ApiClientStore({
    root,
    secretStore: () => secretStore,
    newId: () => `id-${++counter}`
  })
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

async function createEnvironment(): Promise<string> {
  const created = await envOp(store, { worktreeId: WT, op: 'create', name: 'Env' })
  if (!created.ok || !created.id) {
    throw new Error('create failed')
  }
  return created.id
}

async function saveInitial(id: string) {
  return saveEnvironment(store, {
    worktreeId: WT,
    baseRevision: 1,
    environment: {
      id,
      name: 'Env',
      variables: [
        { key: 'baseUrl', value: 'http://x', enabled: true, type: 'default' },
        { key: 'token', value: 'secret-one', enabled: true, type: 'secret' },
        { key: 'key', value: 'secret-two', enabled: true, type: 'secret' }
      ]
    }
  })
}

const environmentJson = async (id: string): Promise<string> =>
  readFile(getApiClientWorktreePaths(WT, root).environmentFile(id), 'utf8')

describe('envOp', () => {
  it('creates, renames, duplicates and deletes environments', async () => {
    const id = await createEnvironment()
    await saveInitial(id)
    expect(await envOp(store, { worktreeId: WT, op: 'rename', id, name: 'Renamed' })).toMatchObject(
      { ok: true }
    )
    const copy = await envOp(store, { worktreeId: WT, op: 'duplicate', id })
    expect(copy).toMatchObject({ ok: true })

    const snapshot = await store.getSnapshot(WT, { revealSecrets: true })
    expect(snapshot.environments.map((e) => e.name)).toEqual(['Renamed', 'Renamed copy'])
    const duplicated = snapshot.environments[1]
    expect(duplicated.variables.find((v) => v.key === 'token')?.value).toBe('secret-one')
    expect(duplicated.id).not.toBe(id)

    await envOp(store, { worktreeId: WT, op: 'delete', id })
    expect((await store.getSnapshot(WT)).environments.map((e) => e.name)).toEqual(['Renamed copy'])
  })

  it('writes a duplicate with freshly sealed secrets', async () => {
    const id = await createEnvironment()
    await saveInitial(id)
    const copy = await envOp(store, { worktreeId: WT, op: 'duplicate', id })
    const copyId = copy.ok && copy.id ? copy.id : ''
    const original = JSON.parse(await environmentJson(id))
    const duplicate = JSON.parse(await environmentJson(copyId))
    expect(duplicate.variables[1].cipher).not.toBe(original.variables[1].cipher)
    expect(JSON.stringify(duplicate)).not.toContain('secret-one')
  })

  it('clears the active environment when it is deleted', async () => {
    const id = await createEnvironment()
    await store.setActiveEnvironment(WT, id)
    expect((await store.getSnapshot(WT)).activeEnvironmentId).toBe(id)
    await envOp(store, { worktreeId: WT, op: 'delete', id })
    expect((await store.getSnapshot(WT)).activeEnvironmentId).toBeNull()
    const fresh = new ApiClientStore({ root, secretStore: () => nonceSecretStore() })
    expect((await fresh.getSnapshot(WT)).activeEnvironmentId).toBeNull()
  })

  it('reports an unknown environment', async () => {
    expect(
      await envOp(store, { worktreeId: WT, op: 'rename', id: 'nope', name: 'x' })
    ).toMatchObject({
      ok: false,
      code: 'not-found'
    })
  })
})

describe('saveEnvironment', () => {
  it('encrypts secrets and never writes their plain value', async () => {
    const id = await createEnvironment()
    expect(await saveInitial(id)).toMatchObject({ ok: true })
    const raw = await environmentJson(id)
    expect(raw).not.toContain('secret-one')
    expect(raw).not.toContain('secret-two')
    expect(raw).toContain('http://x')
  })

  it('reports a stale revision as a conflict', async () => {
    const id = await createEnvironment()
    await saveInitial(id)
    const stale = await saveEnvironment(store, {
      worktreeId: WT,
      baseRevision: 1,
      environment: { id, name: 'Env', variables: [] }
    })
    expect(stale).toMatchObject({ ok: false, code: 'conflict' })
  })

  it('keeps the cipher text of untouched secrets byte-for-byte and re-seals only the changed one', async () => {
    const id = await createEnvironment()
    const first = await saveInitial(id)
    const before = JSON.parse(await environmentJson(id))

    const second = await saveEnvironment(store, {
      worktreeId: WT,
      baseRevision: first.ok ? first.revision : 0,
      environment: {
        id,
        name: 'Env',
        variables: [
          { key: 'baseUrl', value: 'http://y', enabled: true, type: 'default' },
          { key: 'token', enabled: true, type: 'secret', unchanged: true },
          { key: 'key', value: 'secret-two-changed', enabled: true, type: 'secret' }
        ]
      }
    })
    expect(second).toMatchObject({ ok: true })
    const after = JSON.parse(await environmentJson(id))
    expect(after.variables[1].cipher).toBe(before.variables[1].cipher)
    expect(after.variables[2].cipher).not.toBe(before.variables[2].cipher)
    expect(after.variables[0].value).toBe('http://y')

    const revealed = await store.getSnapshot(WT, { revealSecrets: true })
    expect(revealed.environments[0].variables.map((v) => v.value)).toEqual([
      'http://y',
      'secret-one',
      'secret-two-changed'
    ])
  })

  it('rejects an unchanged secret that has no stored value to keep', async () => {
    const id = await createEnvironment()
    const first = await saveInitial(id)
    const result = await saveEnvironment(store, {
      worktreeId: WT,
      baseRevision: first.ok ? first.revision : 0,
      environment: {
        id,
        name: 'Env',
        variables: [{ key: 'renamed', enabled: true, type: 'secret', unchanged: true }]
      }
    })
    expect(result).toMatchObject({ ok: false, code: 'not-found' })
  })

  it('removes variables the editor deleted and keeps the disabled flag', async () => {
    const id = await createEnvironment()
    const first = await saveInitial(id)
    await saveEnvironment(store, {
      worktreeId: WT,
      baseRevision: first.ok ? first.revision : 0,
      environment: {
        id,
        name: 'Env',
        variables: [{ key: 'baseUrl', value: 'http://x', enabled: false, type: 'default' }]
      }
    })
    const snapshot = await store.getSnapshot(WT)
    expect(snapshot.environments[0].variables).toEqual([
      { key: 'baseUrl', value: 'http://x', enabled: false, type: 'default' }
    ])
  })
})
