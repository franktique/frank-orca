import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { SecretStore } from '../../shared/secret-store'
import type { SqlChangedEvent } from '../../shared/sql-client/sql-client-ipc-schemas'
import { SqlClientStore } from './sql-client-store'
import { getProjectSqlPaths } from './sql-client-storage-paths'

const PROJECT = 'repo:r1'
const PASSWORD = 'p@ss-w0rd-unique-marker'

function fakeSecretStore(available = true): SecretStore {
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
    describeProtectionGap: () => (available ? null : 'no keyring')
  }
}

const input = (name = 'Local DB') => ({
  name,
  host: 'localhost',
  port: 5432,
  user: 'postgres',
  database: 'cases',
  sslMode: 'prefer' as const,
  password: PASSWORD
})

let root: string
let events: SqlChangedEvent[]

function makeStore(secretStore = fakeSecretStore()) {
  return new SqlClientStore({ root, secretStore, emit: (e) => events.push(e) })
}

function filesUnder(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => join(e.parentPath, e.name))
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'orca-sql-store-'))
  events = []
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

async function createConnection(store: SqlClientStore, name = 'Local DB') {
  const result = await store.createConnection(PROJECT, input(name))
  if (!result.ok) {
    throw new Error(result.message)
  }
  return result.connection
}

describe('SqlClientStore connections', () => {
  it('keeps ids stable across update and reload from disk (FR-034)', async () => {
    const store = makeStore()
    const created = await createConnection(store)
    const updated = await store.updateConnection(PROJECT, created.id, created.revision, {
      host: '127.0.0.1'
    })
    expect(updated).toMatchObject({ ok: true, connection: { id: created.id, host: '127.0.0.1' } })

    const reloaded = await makeStore().getSnapshot(PROJECT)
    expect(reloaded.ok && reloaded.connections.map((c) => c.id)).toEqual([created.id])
  })

  it('keeps the password when an update omits it and clears it with an empty string', async () => {
    const store = makeStore()
    const created = await createConnection(store)
    expect(created.passwordState).toBe('set')

    const kept = await store.updateConnection(PROJECT, created.id, 1, { name: 'Renamed' })
    expect(kept).toMatchObject({ ok: true, connection: { passwordState: 'set', revision: 2 } })
    const forRun = await store.getConnectionForRun(PROJECT, created.id)
    expect('password' in forRun && forRun.password).toBe(PASSWORD)

    const cleared = await store.updateConnection(PROJECT, created.id, 2, { password: '' })
    expect(cleared).toMatchObject({ ok: true, connection: { passwordState: 'empty' } })
  })

  it('rejects duplicate names case-insensitively and stale revisions', async () => {
    const store = makeStore()
    const created = await createConnection(store, 'Prod')
    expect(await store.createConnection(PROJECT, input('PROD'))).toMatchObject({
      ok: false,
      code: 'invalid'
    })
    await store.updateConnection(PROJECT, created.id, 1, { port: 5433 })
    expect(await store.updateConnection(PROJECT, created.id, 1, { port: 5434 })).toMatchObject({
      ok: false,
      code: 'conflict'
    })
  })

  it('never writes the plaintext password to disk', async () => {
    const store = makeStore()
    await createConnection(store)
    const paths = getProjectSqlPaths(PROJECT, root)
    for (const file of filesUnder(paths.dir)) {
      expect(readFileSync(file, 'utf8')).not.toContain(PASSWORD)
    }
    for (const file of filesUnder(root)) {
      expect(readFileSync(file, 'utf8')).not.toContain(PASSWORD)
    }
  })

  it('keeps the password session-only when encryption is unavailable', async () => {
    const store = makeStore(fakeSecretStore(false))
    const created = await createConnection(store)
    expect(created.passwordState).toBe('session-only')
    const forRun = await store.getConnectionForRun(PROJECT, created.id)
    expect('password' in forRun && forRun.password).toBe(PASSWORD)
    for (const file of filesUnder(root)) {
      expect(readFileSync(file, 'utf8')).not.toContain(PASSWORD)
    }
    const snapshot = await store.getSnapshot(PROJECT)
    expect(snapshot).toMatchObject({
      ok: true,
      encryptionAvailable: false,
      protectionGapMessage: 'no keyring'
    })
    // A fresh process has lost the session password.
    const restarted = await makeStore(fakeSecretStore(false)).getSnapshot(PROJECT)
    expect(restarted.ok && restarted.connections[0]?.passwordState).toBe('empty')
  })

  it('flags a cipher that cannot be decrypted for re-entry', async () => {
    await createConnection(makeStore())
    const broken: SecretStore = {
      ...fakeSecretStore(),
      decryptString: () => {
        throw new Error('x')
      }
    }
    const snapshot = await makeStore(broken).getSnapshot(PROJECT)
    expect(snapshot.ok && snapshot.connections[0]?.passwordState).toBe('needs-reentry')
  })

  it('never exposes a password or cipher in the snapshot', async () => {
    const store = makeStore()
    await createConnection(store)
    const snapshot = JSON.stringify(await store.getSnapshot(PROJECT))
    expect(snapshot).not.toContain(PASSWORD)
    expect(snapshot).not.toContain('cipher')
  })
})

describe('SqlClientStore queries and cascade', () => {
  it('cascades a connection delete and reports the counts', async () => {
    const store = makeStore()
    const connection = await createConnection(store)
    const collection = await store.createCollection(PROJECT, {
      connectionId: connection.id,
      name: 'Cleanup'
    })
    if (!collection.ok) {
      throw new Error('collection')
    }
    await store.saveQuery(PROJECT, {
      connectionId: connection.id,
      collectionId: collection.collection.id,
      name: 'q1',
      sql: 'select 1'
    })
    await store.saveQuery(PROJECT, {
      connectionId: connection.id,
      collectionId: null,
      name: 'q2',
      sql: 'select 2'
    })

    const deleted = await store.deleteConnection(PROJECT, connection.id)
    expect(deleted).toMatchObject({ ok: true, deletedQueries: 2, deletedCollections: 1 })
    const snapshot = await store.getSnapshot(PROJECT)
    expect(snapshot).toMatchObject({ ok: true, connections: [], collections: [], queries: [] })
  })

  it('keeps query ids on update and rejects stale revisions and foreign collections', async () => {
    const store = makeStore()
    const a = await createConnection(store, 'A')
    const b = await createConnection(store, 'B')
    const foreign = await store.createCollection(PROJECT, { connectionId: b.id, name: 'Other' })
    const saved = await store.saveQuery(PROJECT, {
      connectionId: a.id,
      collectionId: null,
      name: 'q',
      sql: 'select 1'
    })
    if (!saved.ok || !foreign.ok) {
      throw new Error('setup')
    }
    const updated = await store.saveQuery(PROJECT, {
      id: saved.query.id,
      baseRevision: 1,
      connectionId: a.id,
      collectionId: null,
      name: 'q',
      sql: 'select 2'
    })
    expect(updated).toMatchObject({
      ok: true,
      query: { id: saved.query.id, revision: 2, sql: 'select 2' }
    })
    expect(
      await store.saveQuery(PROJECT, {
        id: saved.query.id,
        baseRevision: 1,
        connectionId: a.id,
        collectionId: null,
        name: 'q',
        sql: 'x'
      })
    ).toMatchObject({ ok: false, code: 'conflict' })
    expect(
      await store.moveQuery(PROJECT, {
        id: saved.query.id,
        baseRevision: 2,
        collectionId: foreign.collection.id
      })
    ).toMatchObject({ ok: false, code: 'invalid' })
  })

  it('ungroups or deletes a collection’s queries', async () => {
    const store = makeStore()
    const connection = await createConnection(store)
    const collection = await store.createCollection(PROJECT, {
      connectionId: connection.id,
      name: 'C'
    })
    if (!collection.ok) {
      throw new Error('setup')
    }
    const save = (name: string) =>
      store.saveQuery(PROJECT, {
        connectionId: connection.id,
        collectionId: collection.collection.id,
        name,
        sql: 'select 1'
      })
    await save('one')
    expect(
      await store.deleteCollection(PROJECT, { id: collection.collection.id, deleteQueries: false })
    ).toMatchObject({
      ok: true,
      affectedQueries: 1
    })
    const records = await store.getRecords(PROJECT)
    expect('queries' in records && records.queries.map((q) => q.collectionId)).toEqual([null])
  })

  it('emits a change event per write and null revision on delete', async () => {
    const store = makeStore()
    const connection = await createConnection(store)
    await store.deleteConnection(PROJECT, connection.id)
    expect(events.map((e) => [e.kind, e.revision])).toEqual([
      ['connection', 1],
      ['connection', null]
    ])
  })
})

describe('SqlClientStore storage safety', () => {
  it('refuses data written by a newer Orca without overwriting it', async () => {
    await createConnection(makeStore())
    const paths = getProjectSqlPaths(PROJECT, root)
    const future = JSON.stringify({ schemaVersion: 2, connections: [], extra: true })
    writeFileSync(paths.connectionsFile, future)

    const store = makeStore()
    expect(await store.getSnapshot(PROJECT)).toMatchObject({ ok: false, code: 'storage' })
    expect(await store.createConnection(PROJECT, input('x'))).toMatchObject({
      ok: false,
      code: 'storage'
    })
    expect(readFileSync(paths.connectionsFile, 'utf8')).toBe(future)
  })
})
