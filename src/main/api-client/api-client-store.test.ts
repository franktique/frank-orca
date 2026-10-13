import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { SecretStore } from '../../shared/secret-store'
import { hashWorktreeId } from '../terminal-history-id'
import { saveRequest, treeOp } from './api-client-operations'
import { ApiClientStore } from './api-client-store'
import { getApiClientWorktreePaths } from './api-client-storage-paths'

function fakeSecretStore(): SecretStore {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (plain) => Buffer.from(Buffer.from(plain).toReversed()),
    decryptString: (cipher) => Buffer.from(cipher.toReversed()).toString(),
    describeProtectionGap: () => null
  }
}

let root: string
let counter = 0

function createStore(): ApiClientStore {
  return new ApiClientStore({
    root,
    secretStore: fakeSecretStore,
    newId: () => `id-${++counter}`
  })
}

async function createCollectionWithRequest(
  store: ApiClientStore,
  worktreeId: string
): Promise<{ collectionId: string; requestId: string }> {
  const collection = await treeOp(store, {
    worktreeId,
    op: 'create',
    kind: 'collection',
    name: 'Smoke'
  })
  if (!collection.ok || !collection.id) {
    throw new Error('collection create failed')
  }
  const request = await treeOp(store, {
    worktreeId,
    op: 'create',
    kind: 'request',
    collectionId: collection.id,
    name: 'Get it'
  })
  if (!request.ok || !request.id) {
    throw new Error('request create failed')
  }
  return { collectionId: collection.id, requestId: request.id }
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'api-client-store-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('ApiClientStore', () => {
  it('creates nothing on disk until the first write', async () => {
    const store = createStore()
    const snapshot = await store.getSnapshot('wt-a')
    expect(snapshot.collections).toEqual([])
    expect(await readdir(root)).toEqual([])
  })

  it('writes through and survives a fresh store instance (restart)', async () => {
    const first = createStore()
    const { collectionId } = await createCollectionWithRequest(first, 'wt-a')
    const env = first
    await env.transact('wt-a', (data, tx) => {
      data.environments.set('env-1', {
        id: 'env-1',
        name: 'Env',
        variables: [{ key: 'token', value: 'abc', enabled: true, type: 'secret' }],
        revision: 0,
        postmanExtra: {}
      })
      tx.touchEnvironment('env-1')
      data.state.activeEnvironmentId = 'env-1'
      tx.touchState('active-environment')
      return { ok: true as const }
    })

    const second = createStore()
    const snapshot = await second.getSnapshot('wt-a', { revealSecrets: true })
    expect(snapshot.collections.map((c) => c.id)).toEqual([collectionId])
    expect(snapshot.collections[0].items).toHaveLength(1)
    expect(snapshot.activeEnvironmentId).toBe('env-1')
    expect(snapshot.environments[0].variables[0].value).toBe('abc')
  })

  it('withholds secret values unless revealed and never writes them in plain text', async () => {
    const store = createStore()
    await store.transact('wt-a', (data, tx) => {
      data.environments.set('env-1', {
        id: 'env-1',
        name: 'Env',
        variables: [{ key: 'token', value: 'plain-secret', enabled: true, type: 'secret' }],
        revision: 0,
        postmanExtra: {}
      })
      tx.touchEnvironment('env-1')
      return { ok: true as const }
    })
    const hidden = await store.getSnapshot('wt-a')
    expect(hidden.environments[0].variables[0]).toMatchObject({ value: null, masked: true })

    const paths = getApiClientWorktreePaths('wt-a', root)
    const raw = await readFile(paths.environmentFile('env-1'), 'utf8')
    expect(raw).not.toContain('plain-secret')
  })

  it('reports a stale request revision as a conflict', async () => {
    const store = createStore()
    const { collectionId, requestId } = await createCollectionWithRequest(store, 'wt-a')
    const snapshot = await store.getSnapshot('wt-a')
    const request = snapshot.collections[0].items[0]
    if (request.kind !== 'request') {
      throw new Error('expected a request')
    }
    const first = await saveRequest(store, {
      worktreeId: 'wt-a',
      collectionId,
      request: { ...request, name: 'Renamed' },
      baseRevision: request.revision
    })
    expect(first).toMatchObject({ ok: true, revision: 1 })
    const stale = await saveRequest(store, {
      worktreeId: 'wt-a',
      collectionId,
      request: { ...request, name: 'Other' },
      baseRevision: request.revision
    })
    expect(stale).toMatchObject({ ok: false, code: 'conflict' })
    expect(requestId).toBe(request.id)
  })

  it('moves a corrupt file aside while the rest loads', async () => {
    const first = createStore()
    await createCollectionWithRequest(first, 'wt-a')
    const second = await treeOp(first, {
      worktreeId: 'wt-a',
      op: 'create',
      kind: 'collection',
      name: 'Other'
    })
    const paths = getApiClientWorktreePaths('wt-a', root)
    await writeFile(paths.collectionFile(second.ok && second.id ? second.id : ''), '{not json')

    const fresh = createStore()
    const snapshot = await fresh.getSnapshot('wt-a')
    expect(snapshot.collections.map((c) => c.name)).toEqual(['Smoke'])
    expect(snapshot.corruptFiles).toHaveLength(1)
    expect(await readdir(paths.corruptDir)).toHaveLength(1)
  })

  it('keeps two worktrees isolated and derives the data dir only from the worktree id hash', async () => {
    const store = createStore()
    await createCollectionWithRequest(store, 'wt-a')
    expect((await store.getSnapshot('wt-b')).collections).toEqual([])
    const entries = await readdir(root)
    expect(entries).toEqual([hashWorktreeId('wt-a')])
  })

  it('reloads the same data when reopened with the same worktree id (branch switch)', async () => {
    const first = createStore()
    await createCollectionWithRequest(first, 'repo::/path/wt')
    await first.setActiveEnvironment('repo::/path/wt', null)
    const reopened = createStore()
    const snapshot = await reopened.getSnapshot('repo::/path/wt')
    expect(snapshot.collections).toHaveLength(1)
  })

  it('opens read-only when a newer schema version wrote the data', async () => {
    const store = createStore()
    await createCollectionWithRequest(store, 'wt-a')
    const paths = getApiClientWorktreePaths('wt-a', root)
    await writeFile(
      paths.metaFile,
      JSON.stringify({ schemaVersion: 99, worktreeId: 'wt-a', createdAt: 1 })
    )
    const fresh = createStore()
    expect((await fresh.getSnapshot('wt-a')).readOnly).toBe(true)
    const result = await treeOp(fresh, {
      worktreeId: 'wt-a',
      op: 'create',
      kind: 'collection'
    })
    expect(result).toMatchObject({ ok: false, code: 'read-only' })
  })

  it('emits change events with the new revision', async () => {
    const store = createStore()
    const events: unknown[] = []
    store.onChange((event) => events.push(event))
    await createCollectionWithRequest(store, 'wt-a')
    expect(events).toMatchObject([
      { worktreeId: 'wt-a', kind: 'collection', revision: 1 },
      { worktreeId: 'wt-a', kind: 'collection', revision: 2 }
    ])
  })
})
