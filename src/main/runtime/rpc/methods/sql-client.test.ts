import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FolderWorkspace } from '../../../../shared/folder-workspace-types'
import type { Repo } from '../../../../shared/repo-types'
import type { SecretStore } from '../../../../shared/secret-store'
import type { SqlRunResult } from '../../../../shared/sql-client/sql-client-types'
import { getProjectSqlPaths } from '../../../sql-client/sql-client-storage-paths'
import type { OrcaRuntimeService } from '../../orca-runtime'
import type { RpcRequest } from '../core'
import { RpcDispatcher } from '../dispatcher'

const { runAgentQueryMock } = vi.hoisted(() => ({ runAgentQueryMock: vi.fn() }))
vi.mock('../../../sql-client/sql-agent-runner', () => ({ runAgentQuery: runAgentQueryMock }))

import {
  initSqlClientService,
  resetSqlClientServiceForTests,
  type SqlClientService
} from '../../../sql-client/sql-client-service'
import { SQL_CLIENT_METHODS } from './sql-client'

const LOCAL_WT = 'repo-local::/work/local'
const SSH_WT = 'repo-ssh::/work/remote'
const PASSWORD = 'agent-visible-never-password'

const secretStore: SecretStore = {
  isEncryptionAvailable: () => true,
  encryptString: (plain) => Buffer.from(Buffer.from(plain).toReversed()),
  decryptString: (cipher) => Buffer.from(cipher.toReversed()).toString(),
  describeProtectionGap: () => null
}

const repo = (id: string, connectionId?: string): Repo => ({
  id,
  path: `/work/${id}`,
  displayName: id,
  badgeColor: '#000',
  addedAt: 0,
  ...(connectionId ? { connectionId } : {})
})

const rows: SqlRunResult = {
  kind: 'rows',
  columns: [{ name: 'n', dataTypeId: 23, dataTypeName: 'integer' }],
  rows: [['1']],
  rowCount: 1,
  rowCapApplied: false,
  sizeLimitReached: false,
  statementCount: 1,
  elapsedMs: 3
}

function dispatcher(): RpcDispatcher {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: test stub of the one runtime method these methods read.
  const runtime = {
    getRuntimeId: () => 'test-runtime',
    showTerminalWorkspaceLaunchScope: async (selector: string) => ({
      id: selector,
      path: '/p',
      connectionId: null,
      repo: null,
      folderWorkspace: null
    })
  } as unknown as OrcaRuntimeService
  return new RpcDispatcher({ runtime, methods: SQL_CLIENT_METHODS })
}

async function call(method: string, params: unknown) {
  const rpc: RpcRequest = { id: 'req', authToken: 'tok', method, params }
  return dispatcher().dispatch(rpc)
}

async function callOk(method: string, params: unknown): Promise<unknown> {
  const response = await call(method, params)
  if (!response.ok) {
    throw new Error(`${response.error.code}: ${response.error.message}`)
  }
  return response.result
}

let root: string
let service: SqlClientService

async function seedConnection(name: string, host = 'localhost'): Promise<string> {
  const created = await service.store.createConnection('repo:repo-local', {
    name,
    host,
    port: 5432,
    user: 'app',
    database: 'cases',
    sslMode: 'prefer',
    password: PASSWORD
  })
  if (!created.ok) {
    throw new Error(created.message)
  }
  return created.connection.id
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'sql-client-rpc-'))
  runAgentQueryMock.mockReset().mockResolvedValue(rows)
  resetSqlClientServiceForTests()
  service = initSqlClientService({
    orcaStore: {
      getRepo: (id) => (id === 'repo-ssh' ? repo(id, 'ssh-target') : repo(id)),
      getAllWorktreeMeta: () => ({}),
      getFolderWorkspace: (): FolderWorkspace | undefined => undefined
    },
    storeOptions: { root, secretStore }
  })
})

afterEach(async () => {
  resetSqlClientServiceForTests()
  await rm(root, { recursive: true, force: true })
})

describe('sql RPC methods', () => {
  it('exposes read and run methods only', () => {
    expect(SQL_CLIENT_METHODS.map((method) => method.name).sort()).toEqual([
      'sql.connections',
      'sql.queries',
      'sql.run'
    ])
  })

  it('lists connections with their agent access and never a password or cipher', async () => {
    await seedConnection('Local', 'localhost')
    await seedConnection('Shared', 'db.example.com')
    const result = await callOk('sql.connections', { worktree: LOCAL_WT })
    expect(result).toMatchObject({
      ok: true,
      projectKey: 'repo:repo-local',
      connections: [
        { name: 'Local', agentAccess: 'full', passwordState: 'set' },
        { name: 'Shared', agentAccess: 'read-only' }
      ]
    })
    const json = JSON.stringify(result)
    expect(json).not.toContain(PASSWORD)
    expect(json).not.toContain('cipher')
    expect(json).not.toContain('"password"')
  })

  it('rejects non-local worktrees with not-local', async () => {
    for (const method of ['sql.connections', 'sql.queries']) {
      expect(await callOk(method, { worktree: SSH_WT })).toMatchObject({
        ok: false,
        code: 'not-local'
      })
    }
    expect(
      await callOk('sql.run', { worktree: SSH_WT, connection: 'x', sql: 'select 1' })
    ).toMatchObject({ ok: false, code: 'not-local' })
    expect(runAgentQueryMock).not.toHaveBeenCalled()
  })

  it('runs against a connection chosen by id or case-insensitive name', async () => {
    const id = await seedConnection('Local DB')
    for (const connection of [id, 'local db', 'LOCAL DB']) {
      runAgentQueryMock.mockClear()
      expect(
        await callOk('sql.run', { worktree: LOCAL_WT, connection, sql: 'select 1' })
      ).toMatchObject({ ok: true, connectionId: id, agentAccess: 'full', result: { kind: 'rows' } })
      expect(runAgentQueryMock).toHaveBeenCalledTimes(1)
    }
  })

  it('passes the decrypted password to the runner but never back out', async () => {
    await seedConnection('Local')
    const result = await callOk('sql.run', {
      worktree: LOCAL_WT,
      connection: 'Local',
      sql: 'select 1'
    })
    expect(runAgentQueryMock).toHaveBeenCalledWith(
      expect.objectContaining({ password: PASSWORD, sql: 'select 1', timeoutMs: 30_000 })
    )
    expect(JSON.stringify(result)).not.toContain(PASSWORD)
  })

  it('converts timeoutSeconds and rejects out-of-range values', async () => {
    await seedConnection('Local')
    await callOk('sql.run', {
      worktree: LOCAL_WT,
      connection: 'Local',
      sql: 'x',
      timeoutSeconds: 5
    })
    expect(runAgentQueryMock).toHaveBeenLastCalledWith(expect.objectContaining({ timeoutMs: 5000 }))
    for (const timeoutSeconds of [0, 601, 1.5]) {
      const response = await call('sql.run', {
        worktree: LOCAL_WT,
        connection: 'Local',
        sql: 'x',
        timeoutSeconds
      })
      expect(response.ok).toBe(false)
    }
  })

  it('needs exactly one of sql and savedQuery', async () => {
    await seedConnection('Local')
    expect((await call('sql.run', { worktree: LOCAL_WT, connection: 'Local' })).ok).toBe(false)
    expect(
      (
        await call('sql.run', {
          worktree: LOCAL_WT,
          connection: 'Local',
          sql: 'select 1',
          savedQuery: 'q'
        })
      ).ok
    ).toBe(false)
  })

  it('runs a saved query by id or name under that connection', async () => {
    const id = await seedConnection('Local')
    const saved = await service.store.saveQuery('repo:repo-local', {
      connectionId: id,
      collectionId: null,
      name: 'Delete Test Cases',
      sql: 'delete from t'
    })
    if (!saved.ok) {
      throw new Error('setup')
    }
    for (const savedQuery of [saved.query.id, 'delete test cases']) {
      runAgentQueryMock.mockClear()
      await callOk('sql.run', { worktree: LOCAL_WT, connection: 'Local', savedQuery })
      expect(runAgentQueryMock).toHaveBeenCalledWith(
        expect.objectContaining({ sql: 'delete from t' })
      )
    }
    expect(
      await callOk('sql.run', { worktree: LOCAL_WT, connection: 'Local', savedQuery: 'missing' })
    ).toMatchObject({ ok: false, code: 'not-found' })
  })

  it('reports an unknown connection as not-found', async () => {
    expect(
      await callOk('sql.run', { worktree: LOCAL_WT, connection: 'nope', sql: 'select 1' })
    ).toMatchObject({ ok: false, code: 'not-found' })
  })

  it('lists the ids when a connection name is ambiguous', async () => {
    const paths = getProjectSqlPaths('repo:repo-local', root)
    await mkdir(paths.dir, { recursive: true })
    const connection = (id: string) => ({
      id,
      name: 'Twin',
      host: 'localhost',
      port: 5432,
      user: 'u',
      database: 'd',
      sslMode: 'prefer',
      password: null,
      createdAt: 't',
      updatedAt: 't',
      revision: 1
    })
    await writeFile(
      paths.connectionsFile,
      JSON.stringify({ schemaVersion: 1, connections: [connection('id-1'), connection('id-2')] })
    )
    const result = await callOk('sql.run', { worktree: LOCAL_WT, connection: 'twin', sql: 'x' })
    expect(result).toMatchObject({ ok: false, code: 'ambiguous' })
    expect(JSON.stringify(result)).toContain('id-1')
    expect(JSON.stringify(result)).toContain('id-2')
  })

  it('filters saved queries by connection and omits nothing sensitive', async () => {
    const a = await seedConnection('A')
    const b = await seedConnection('B')
    await service.store.saveQuery('repo:repo-local', {
      connectionId: a,
      collectionId: null,
      name: 'qa',
      sql: 'select a'
    })
    await service.store.saveQuery('repo:repo-local', {
      connectionId: b,
      collectionId: null,
      name: 'qb',
      sql: 'select b'
    })
    const result = await callOk('sql.queries', { worktree: LOCAL_WT, connection: 'b' })
    expect(result).toMatchObject({ ok: true, queries: [{ name: 'qb', sql: 'select b' }] })
    expect(JSON.stringify(result)).not.toContain('cipher')
  })

  it('asks for a re-entered password when the saved one cannot be read', async () => {
    await seedConnection('Local')
    const unreadable: SecretStore = {
      ...secretStore,
      decryptString: () => {
        throw new Error('cannot decrypt')
      }
    }
    resetSqlClientServiceForTests()
    initSqlClientService({
      orcaStore: {
        getRepo: (id) => repo(id),
        getAllWorktreeMeta: () => ({}),
        getFolderWorkspace: () => undefined
      },
      storeOptions: { root, secretStore: unreadable }
    })
    expect(
      await callOk('sql.run', { worktree: LOCAL_WT, connection: 'Local', sql: 'select 1' })
    ).toMatchObject({ ok: false, code: 'unavailable' })
    expect(runAgentQueryMock).not.toHaveBeenCalled()
  })
})
