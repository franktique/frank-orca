import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { SecretStore } from '../../shared/secret-store'
import type {
  ApiFolder,
  ApiRequest,
  Auth,
  Collection,
  Environment
} from '../../shared/api-client/api-client-types'
import { ApiClientConsoleBuffer } from './api-client-console-buffer'
import { readLatestResult } from './api-client-results'
import { ApiClientStore } from './api-client-store'
import { getApiClientWorktreePaths } from './api-client-storage-paths'
import { HttpRequestSender } from './http-request-sender'
import { executeRequest, type RequestExecutionDeps } from './request-execution'
import { runScript } from './script-sandbox/script-sandbox-runner'
import { startLocalEchoServer, type LocalEchoServer } from './test-support/local-echo-server'

const WT = 'wt'
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

function folder(
  id: string,
  items: (ApiFolder | ApiRequest)[],
  extra: Partial<ApiFolder> = {}
): ApiFolder {
  return {
    id,
    kind: 'folder',
    name: id,
    variables: [],
    events: {},
    items,
    postmanExtra: {},
    ...extra
  }
}

const script = (...lines: string[]) => ({ exec: lines })
const bearer = (token: string): Auth => ({ type: 'bearer', params: { token } })

let server: LocalEchoServer
let root: string
let store: ApiClientStore
let consoleBuffer: ApiClientConsoleBuffer
let deps: RequestExecutionDeps
let counter = 0

beforeAll(async () => {
  server = await startLocalEchoServer()
})
afterAll(async () => {
  await server.close()
})

async function seed(collection: Collection, environment?: Partial<Environment>): Promise<void> {
  await store.transact(WT, (data, tx) => {
    data.collections.set(collection.id, collection)
    tx.touchCollection(collection.id)
    const env: Environment = {
      id: 'env',
      name: 'env',
      revision: 0,
      postmanExtra: {},
      variables: [
        { key: 'baseUrl', value: server.baseUrl, enabled: true, type: 'default' },
        { key: 'secretToken', value: SECRET, enabled: true, type: 'secret' }
      ],
      ...environment
    }
    data.environments.set('env', env)
    tx.touchEnvironment('env')
    return { ok: true as const }
  })
}

function collectionOf(
  items: (ApiFolder | ApiRequest)[],
  extra: Partial<Collection> = {}
): Collection {
  return {
    id: 'col',
    name: 'col',
    variables: [],
    events: {},
    items,
    revision: 0,
    postmanExtra: {},
    importWarnings: [],
    ...extra
  }
}

async function run(requestId: string, origin: 'manual' | 'run' | 'agent' = 'manual') {
  const snapshot = await store.getSnapshot(WT, { revealSecrets: true })
  const target = findRequest(snapshot.collections[0], requestId)
  const result = await executeRequest(deps, {
    worktreeId: WT,
    collectionId: 'col',
    request: target,
    environmentId: 'env',
    origin
  })
  if (!result.ok) {
    throw new Error(result.message)
  }
  return result
}

function findRequest(collection: Collection, id: string): ApiRequest {
  const walk = (items: Collection['items']): ApiRequest | null => {
    for (const item of items) {
      if (item.kind === 'request' && item.id === id) {
        return item
      }
      if (item.kind === 'folder') {
        const nested = walk(item.items)
        if (nested) {
          return nested
        }
      }
    }
    return null
  }
  const found = walk(collection.items)
  if (!found) {
    throw new Error(`no request ${id}`)
  }
  return found
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'api-client-exec-'))
  store = new ApiClientStore({ root, secretStore: fakeSecretStore, newId: () => `id-${++counter}` })
  consoleBuffer = new ApiClientConsoleBuffer()
  deps = {
    store,
    sender: new HttpRequestSender(() => (url, init) => fetch(url, init)),
    sandbox: { run: runScript },
    consoleBuffer,
    getSslVerification: () => true
  }
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('executeRequest', () => {
  it('runs scripts in Postman order for pre-request and test phases', async () => {
    const log = (name: string) => `console.log('${name}')`
    await seed(
      collectionOf(
        [
          folder(
            'outer',
            [
              folder(
                'inner',
                [
                  request('r', {
                    events: {
                      prerequest: script(log('pre-request')),
                      test: script(log('test-request'))
                    }
                  })
                ],
                {
                  events: { prerequest: script(log('pre-inner')), test: script(log('test-inner')) }
                }
              )
            ],
            { events: { prerequest: script(log('pre-outer')), test: script(log('test-outer')) } }
          )
        ],
        {
          events: {
            prerequest: script(log('pre-collection')),
            test: script(log('test-collection'))
          }
        }
      )
    )
    const { latest } = await run('r')
    expect(latest.scriptLogs.map((l) => `${l.phase}:${l.text}`)).toEqual([
      'prerequest:pre-collection',
      'prerequest:pre-outer',
      'prerequest:pre-inner',
      'prerequest:pre-request',
      'test:test-collection',
      'test:test-outer',
      'test:test-inner',
      'test:test-request'
    ])
  })

  it('aborts the send when a pre-request script throws', async () => {
    await seed(
      collectionOf([request('r', { events: { prerequest: script("throw new Error('nope')") } })])
    )
    const { latest } = await run('r')
    expect(latest.outcome).toMatchObject({ kind: 'error', code: 'script-error' })
    expect(latest.outcome.kind === 'error' ? latest.outcome.message : '').toContain('nope')
  })

  it('resolves variables, sends the request and runs the tests', async () => {
    await seed(
      collectionOf([
        request('r', {
          method: 'POST',
          headers: [{ key: 'X-Who', value: 'me', enabled: true }],
          body: { mode: 'raw', raw: '{"a":1}', language: 'json' },
          events: {
            test: script(
              "pm.test('status 200', function () { pm.response.to.have.status(200) });",
              "pm.test('echoed method', function () { pm.expect(pm.response.json().method).to.equal('POST') });"
            )
          }
        })
      ])
    )
    const { latest } = await run('r')
    expect(latest.outcome.kind).toBe('response')
    expect(latest.resolvedRequest.url).toBe(`${server.baseUrl}/echo`)
    expect(latest.tests).toEqual([
      { name: 'status 200', passed: true },
      { name: 'echoed method', passed: true }
    ])
    expect(latest.origin).toBe('manual')
  })

  it('persists a variable set by a test so the next request can use it', async () => {
    await seed(
      collectionOf([
        request('login', {
          url: { raw: '{{baseUrl}}/token', query: [] },
          events: { test: script("pm.environment.set('token', pm.response.json().token)") }
        }),
        request('use', {
          headers: [{ key: 'X-Token', value: '{{token}}', enabled: true }]
        })
      ])
    )
    await run('login')
    const { latest } = await run('use')
    expect(latest.resolvedRequest.headers).toContainEqual(['X-Token', 'test-token-value'])
    const snapshot = await store.getSnapshot(WT)
    expect(snapshot.environments[0].variables.find((v) => v.key === 'token')?.value).toBe(
      'test-token-value'
    )
  })

  it('masks secrets everywhere the result is saved or shown', async () => {
    await seed(
      collectionOf([
        request('r', {
          url: { raw: '{{baseUrl}}/echo?token={{secretToken}}', query: [] },
          headers: [{ key: 'Authorization', value: 'Bearer {{secretToken}}', enabled: true }],
          body: { mode: 'raw', raw: '{"t":"{{secretToken}}"}', language: 'json' },
          events: {
            prerequest: script("console.log('pre ' + pm.environment.get('secretToken'))"),
            test: script(
              "console.log('echo ' + pm.response.text());",
              "pm.test('leak ' + pm.environment.get('secretToken'), function () {})"
            )
          },
          method: 'POST'
        })
      ])
    )
    const { latest, consoleEntry } = await run('r')
    const paths = getApiClientWorktreePaths(WT, root)
    const onDisk = await readFile(paths.resultFile('r'), 'utf8')
    for (const text of [JSON.stringify(latest), JSON.stringify(consoleEntry), onDisk]) {
      expect(text).not.toContain(SECRET)
    }
    expect(latest.resolvedRequest.url).toContain('token=••••')
    expect(latest.resolvedRequest.headers).toContainEqual(['Authorization', 'Bearer ••••'])
    expect(latest.resolvedRequest.body).toBe('{"t":"••••"}')
    expect(JSON.stringify(latest.outcome)).toContain('••••')
  })

  it('writes the latest result with its origin and feeds the console buffer', async () => {
    await seed(collectionOf([request('r')]))
    await run('r', 'agent')
    const stored = await readLatestResult(store, WT, 'r')
    expect(stored).toMatchObject({ requestId: 'r', origin: 'agent' })
    const entries = consoleBuffer.list(WT)
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      origin: 'agent',
      requestId: 'r',
      method: 'GET',
      status: 200
    })
  })
})

describe('executeRequest — inherited auth', () => {
  const sentAuth = async (requestId: string): Promise<string | undefined> => {
    const { latest } = await run(requestId)
    if (latest.outcome.kind !== 'response') {
      throw new Error(JSON.stringify(latest.outcome))
    }
    const echoed = JSON.parse(latest.outcome.response.body.text ?? '{}')
    return echoed.headers.authorization
  }

  it('uses the nearest folder auth, then the collection auth', async () => {
    await seed(
      collectionOf(
        [
          folder('f', [request('own-folder')], { auth: bearer('folder-token') }),
          folder('plain', [request('from-collection')]),
          request('inherit', { auth: { type: 'inherit', params: {} } })
        ],
        { auth: bearer('collection-token') }
      )
    )
    expect(await sentAuth('own-folder')).toBe('Bearer folder-token')
    expect(await sentAuth('from-collection')).toBe('Bearer collection-token')
    expect(await sentAuth('inherit')).toBe('Bearer collection-token')
  })

  it('stops inheriting at noauth on any level', async () => {
    await seed(
      collectionOf(
        [
          folder('none', [request('under-noauth-folder')], {
            auth: { type: 'noauth', params: {} }
          }),
          request('noauth-request', { auth: { type: 'noauth', params: {} } })
        ],
        { auth: bearer('collection-token') }
      )
    )
    expect(await sentAuth('under-noauth-folder')).toBeUndefined()
    expect(await sentAuth('noauth-request')).toBeUndefined()
  })

  it('resolves {{variables}} inside inherited auth with the request scopes', async () => {
    await seed(collectionOf([folder('f', [request('r')])], { auth: bearer('{{secretToken}}') }))
    const { latest } = await run('r')
    expect(latest.resolvedRequest.headers).toContainEqual(['Authorization', 'Bearer ••••'])
    expect(JSON.stringify(latest)).not.toContain(SECRET)
  })

  it('reports an inherited unsupported auth type', async () => {
    await seed(collectionOf([request('r')], { auth: { type: 'oauth2', params: {} } }))
    const { latest } = await run('r')
    expect(latest.outcome).toMatchObject({ kind: 'error', code: 'unsupported-auth' })
  })
})

describe('executeRequest — variable overlay and sink', () => {
  it('resolves from the overlay and sends writes to the sink instead of the store', async () => {
    const target = request('r', {
      url: { raw: '{{base}}/echo', query: [] },
      events: { test: script("pm.environment.set('token', 'abc')") }
    })
    await seed(collectionOf([target]))
    const captured: unknown[] = []
    const result = await executeRequest(deps, {
      worktreeId: WT,
      collectionId: 'col',
      request: target,
      environmentId: 'env',
      origin: 'run',
      variableOverlay: {
        environment: [{ key: 'base', value: server.baseUrl, enabled: true, type: 'default' }],
        collection: []
      },
      variableSink: async (writes) => {
        captured.push(writes)
      }
    })
    if (!result.ok) {
      throw new Error(result.message)
    }
    expect(result.latest.resolvedRequest.url).toBe(`${server.baseUrl}/echo`)
    expect(captured).toEqual([
      {
        environment: { set: { token: 'abc' }, unset: [] },
        collection: { set: {}, unset: [] }
      }
    ])
    const snapshot = await store.getSnapshot(WT, { revealSecrets: true })
    expect(snapshot.environments[0].variables.some((v) => v.key === 'token')).toBe(false)
  })
})
