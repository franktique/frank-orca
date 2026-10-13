import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SecretStore } from '../../../../shared/secret-store'
import type {
  ApiFolder,
  ApiRequest,
  Collection
} from '../../../../shared/api-client/api-client-types'
import { isRecord } from '../../../../shared/api-client/postman-field-mapping'
import { readLatestResult } from '../../../api-client/api-client-results'
import {
  initApiClientService,
  resetApiClientServiceForTests,
  type ApiClientService
} from '../../../api-client/api-client-service'
import { ApiClientStore } from '../../../api-client/api-client-store'
import { runScript } from '../../../api-client/script-sandbox/script-sandbox-runner'
import {
  startLocalEchoServer,
  type LocalEchoServer
} from '../../../api-client/test-support/local-echo-server'
import type { OrcaRuntimeService } from '../../orca-runtime'
import { RpcDispatcher } from '../dispatcher'
import type { RpcRequest } from '../core'
import { API_CLIENT_METHODS } from './api-client'

const LOCAL_WT = 'repo-local::/work/local'
const SSH_WT = 'repo-ssh::/work/remote'
const SECRET = 'super-secret-token-123'

function fakeSecretStore(): SecretStore {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (plain) => Buffer.from(Buffer.from(plain).toReversed()),
    decryptString: (cipher) => Buffer.from(cipher.toReversed()).toString(),
    describeProtectionGap: () => null
  }
}

function request(id: string, overrides: Partial<ApiRequest> = {}): ApiRequest {
  return {
    id,
    kind: 'request',
    name: id,
    method: 'GET',
    url: { raw: '{{baseUrl}}/echo', query: [] },
    pathVariables: [],
    headers: [],
    events: {},
    settings: {},
    revision: 0,
    postmanExtra: {},
    ...overrides
  }
}

const folder = (id: string, items: ApiRequest[]): ApiFolder => ({
  id,
  kind: 'folder',
  name: id,
  variables: [],
  events: {},
  items,
  postmanExtra: {}
})

function dispatcher(): RpcDispatcher {
  // SAFETY: only showTerminalWorkspaceLaunchScope is read by these methods; the rest of the runtime is unused.
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: test stub of one runtime method.
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
  return new RpcDispatcher({ runtime, methods: API_CLIENT_METHODS })
}

function runResultRows(result: unknown): Record<string, unknown>[] {
  if (!isRecord(result) || !Array.isArray(result.results)) {
    return []
  }
  return result.results.filter(isRecord)
}

async function call(method: string, params: unknown): Promise<unknown> {
  const rpc: RpcRequest = { id: 'req', authToken: 'tok', method, params }
  const response = await dispatcher().dispatch(rpc)
  if (!response.ok) {
    throw new Error(`${response.error.code}: ${response.error.message}`)
  }
  return response.result
}

let server: LocalEchoServer
let root: string
let service: ApiClientService

beforeAll(async () => {
  server = await startLocalEchoServer()
})
afterAll(async () => {
  await server.close()
})

async function seed(): Promise<void> {
  const collection: Collection = {
    id: 'col',
    name: 'Smoke',
    variables: [],
    events: {},
    revision: 0,
    postmanExtra: {},
    importWarnings: [],
    items: [
      folder('F', [
        request('r1', {
          headers: [{ key: 'Authorization', value: 'Bearer {{secretToken}}', enabled: true }],
          events: {
            test: { exec: ["console.log('token is ' + pm.environment.get('secretToken'))"] }
          }
        }),
        request('slow', { url: { raw: '{{baseUrl}}/delay/4000', query: [] } })
      ])
    ]
  }
  await service.store.transact(LOCAL_WT, (data, tx) => {
    data.collections.set('col', collection)
    tx.touchCollection('col')
    data.environments.set('env', {
      id: 'env',
      name: 'Local',
      revision: 0,
      postmanExtra: {},
      variables: [
        { key: 'baseUrl', value: server.baseUrl, enabled: true, type: 'default' },
        { key: 'secretToken', value: SECRET, enabled: true, type: 'secret' }
      ]
    })
    tx.touchEnvironment('env')
    data.state.activeEnvironmentId = 'env'
    tx.touchState('active-environment')
    return { ok: true as const }
  })
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'api-client-rpc-'))
  resetApiClientServiceForTests()
  service = initApiClientService({
    orcaStore: {
      getRepo: (id: string) =>
        id === 'repo-ssh'
          ? {
              id,
              path: '/work/remote',
              displayName: 'r',
              badgeColor: '#000',
              addedAt: 0,
              connectionId: 'ssh'
            }
          : { id, path: '/work/local', displayName: 'l', badgeColor: '#000', addedAt: 0 },
      getAllWorktreeMeta: () => ({}),
      getFolderWorkspace: () => undefined,
      getSettings: () => ({ apiClientSslVerification: true })
    },
    store: new ApiClientStore({ root, secretStore: fakeSecretStore }),
    sandbox: { run: runScript },
    fetchFor: () => (url, init) => fetch(url, init)
  })
  await seed()
})

afterEach(async () => {
  resetApiClientServiceForTests()
  await rm(root, { recursive: true, force: true })
})

describe('apiClient RPC methods', () => {
  it('exposes read and run methods only', () => {
    expect(API_CLIENT_METHODS.map((method) => method.name).sort()).toEqual([
      'apiClient.environments',
      'apiClient.list',
      'apiClient.result',
      'apiClient.run',
      'apiClient.show'
    ])
  })

  it('lists collections with ids and the active environment', async () => {
    expect(await call('apiClient.list', { worktree: LOCAL_WT })).toMatchObject({
      ok: true,
      activeEnvironmentId: 'env',
      collections: [
        {
          id: 'col',
          name: 'Smoke',
          items: [
            {
              id: 'F',
              kind: 'folder',
              items: [
                { id: 'r1', kind: 'request', method: 'GET' },
                { id: 'slow', kind: 'request', method: 'GET' }
              ]
            }
          ]
        }
      ]
    })
  })

  it('masks secret values in environments', async () => {
    const result = await call('apiClient.environments', { worktree: LOCAL_WT })
    expect(JSON.stringify(result)).not.toContain(SECRET)
    expect(result).toMatchObject({
      environments: [
        {
          variables: [
            { key: 'baseUrl', type: 'default', value: server.baseUrl },
            { key: 'secretToken', type: 'secret', value: '••••' }
          ]
        }
      ]
    })
  })

  it('never returns a secret anywhere in a run, even when the server echoes it back', async () => {
    const result = await call('apiClient.run', { worktree: LOCAL_WT, targetId: 'r1' })
    expect(result).toMatchObject({ ok: true, state: 'completed' })
    expect(JSON.stringify(result)).not.toContain(SECRET)
    expect(JSON.stringify(result)).toContain('••••')
    const folderRun = await call('apiClient.run', {
      worktree: LOCAL_WT,
      targetId: 'F',
      timeoutMs: 1000
    })
    expect(JSON.stringify(folderRun)).not.toContain(SECRET)
  })

  it('records agent runs as agent-initiated in the latest result', async () => {
    await call('apiClient.run', { worktree: LOCAL_WT, targetId: 'r1' })
    const stored = await readLatestResult(service.store, LOCAL_WT, 'r1')
    expect(stored?.origin).toBe('agent')
    expect(service.console.list(LOCAL_WT)[0].origin).toBe('agent')
    const result = await call('apiClient.result', { worktree: LOCAL_WT, requestId: 'r1' })
    expect(result).toMatchObject({
      ok: true,
      origin: 'agent',
      result: { requestId: 'r1', name: 'r1' }
    })
  })

  it('stops a run at --timeout and returns the partial results', async () => {
    const result = await call('apiClient.run', {
      worktree: LOCAL_WT,
      targetId: 'F',
      timeoutMs: 1000
    })
    expect(result).toMatchObject({ ok: true, state: 'stopped' })
    expect(runResultRows(result).map((row) => row.requestId)).toEqual(['r1'])
  })

  it('runs against a named environment, or none', async () => {
    expect(
      await call('apiClient.run', { worktree: LOCAL_WT, targetId: 'r1', environment: 'Local' })
    ).toMatchObject({ ok: true })
    expect(
      await call('apiClient.run', { worktree: LOCAL_WT, targetId: 'r1', environment: 'nope' })
    ).toMatchObject({ ok: false, code: 'not-found' })
    const none = await call('apiClient.run', {
      worktree: LOCAL_WT,
      targetId: 'r1',
      environment: 'none'
    })
    // Without the environment the URL cannot resolve.
    expect(runResultRows(none)[0]).toMatchObject({ error: expect.anything() })
  })

  it('rejects a worktree that is not local', async () => {
    expect(await call('apiClient.list', { worktree: SSH_WT })).toMatchObject({
      ok: false,
      code: 'not-local'
    })
    expect(await call('apiClient.run', { worktree: SSH_WT, targetId: 'r1' })).toMatchObject({
      ok: false,
      code: 'not-local'
    })
  })

  it('reports an unknown target and an unknown result', async () => {
    expect(await call('apiClient.run', { worktree: LOCAL_WT, targetId: 'zzz' })).toMatchObject({
      ok: false,
      code: 'not-found'
    })
    expect(await call('apiClient.result', { worktree: LOCAL_WT, requestId: 'r1' })).toMatchObject({
      ok: false,
      code: 'not-found'
    })
  })

  it('asks the renderer to show a request and returns the tab it answers with', async () => {
    const shown = vi.fn().mockResolvedValue({ ok: true, tabId: 'tab-7' })
    service.setShowHandler(shown)
    expect(await call('apiClient.show', { worktree: LOCAL_WT, requestId: 'r1' })).toEqual({
      ok: true,
      tabId: 'tab-7'
    })
    expect(shown).toHaveBeenCalledWith(LOCAL_WT, 'r1')
    expect(await call('apiClient.show', { worktree: LOCAL_WT, requestId: 'nope' })).toMatchObject({
      ok: false,
      code: 'not-found'
    })
  })
})
