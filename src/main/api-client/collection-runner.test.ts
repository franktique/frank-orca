import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { SecretStore } from '../../shared/secret-store'
import type {
  ApiFolder,
  ApiRequest,
  Collection,
  Run,
  RunOptions,
  RunRequestResult
} from '../../shared/api-client/api-client-types'
import { ApiClientConsoleBuffer } from './api-client-console-buffer'
import { readLatestRun } from './api-client-results'
import { ApiClientStore } from './api-client-store'
import { getApiClientWorktreePaths } from './api-client-storage-paths'
import { CollectionRunner, enforceRunSizeCap, type StartRunInput } from './collection-runner'
import { HttpRequestSender } from './http-request-sender'
import { runScript } from './script-sandbox/script-sandbox-runner'
import { startLocalEchoServer, type LocalEchoServer } from './test-support/local-echo-server'

const WT = 'wt'

function secretStore(): SecretStore {
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

const folder = (id: string, items: (ApiFolder | ApiRequest)[]): ApiFolder => ({
  id,
  kind: 'folder',
  name: id,
  variables: [],
  events: {},
  items,
  postmanExtra: {}
})

const pass = { exec: ["pm.test('ok', function () { pm.response.to.have.status(200) })"] }

let server: LocalEchoServer
let root: string
let store: ApiClientStore
let runner: CollectionRunner
let counter = 0
const progress: RunRequestResult[] = []
const finished: Run[] = []

beforeAll(async () => {
  server = await startLocalEchoServer()
})
afterAll(async () => {
  await server.close()
})

async function seed(items: (ApiFolder | ApiRequest)[]): Promise<Collection> {
  const collection: Collection = {
    id: 'col',
    name: 'col',
    variables: [],
    events: {},
    items,
    revision: 0,
    postmanExtra: {},
    importWarnings: []
  }
  await store.transact(WT, (data, tx) => {
    data.collections.set('col', collection)
    tx.touchCollection('col')
    data.environments.set('env', {
      id: 'env',
      name: 'env',
      revision: 0,
      postmanExtra: {},
      variables: [{ key: 'baseUrl', value: server.baseUrl, enabled: true, type: 'default' }]
    })
    tx.touchEnvironment('env')
    return { ok: true as const }
  })
  return collection
}

const options = (ids: string[], overrides: Partial<RunOptions> = {}): RunOptions => ({
  iterations: 1,
  delayMs: 0,
  stopOnFailure: false,
  includedRequestIds: ids,
  ...overrides
})

async function run(
  ids: string[],
  overrides: Partial<RunOptions> = {},
  input: Partial<StartRunInput> = {}
): Promise<Run> {
  const started = await runner.start({
    worktreeId: WT,
    scope: { collectionId: 'col' },
    environmentId: 'env',
    options: options(ids, overrides),
    origin: 'manual',
    ...input
  })
  if (!started.ok) {
    throw new Error(started.message)
  }
  return started.done
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'api-client-runner-'))
  store = new ApiClientStore({ root, secretStore, newId: () => `id-${++counter}` })
  progress.length = 0
  finished.length = 0
  runner = new CollectionRunner(
    {
      store,
      sender: new HttpRequestSender(() => (url, init) => fetch(url, init)),
      sandbox: { run: runScript },
      consoleBuffer: new ApiClientConsoleBuffer(),
      getSslVerification: () => true
    },
    {
      onProgress: ({ result }) => progress.push(result),
      onFinished: ({ run: done }) => finished.push(done)
    }
  )
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('CollectionRunner', () => {
  it('runs the included requests once in depth-first order and skips excluded ones', async () => {
    await seed([
      folder('A', [request('a1'), folder('B', [request('b1'), request('b2')]), request('a2')]),
      request('top')
    ])
    const result = await run(['a1', 'b1', 'a2', 'top'])
    expect(result.results.map((r) => r.requestId)).toEqual(['a1', 'b1', 'a2', 'top'])
    expect(result.results[1].folderPath).toEqual(['A', 'B'])
    expect(result.state).toBe('completed')
    expect(finished).toHaveLength(1)
    expect(progress).toHaveLength(4)
  })

  it('repeats the requests for every iteration and keeps the details of earlier ones', async () => {
    await seed([request('r1'), request('r2')])
    const result = await run(['r1', 'r2'], { iterations: 2 })
    expect(result.results.map((r) => `${r.iteration}:${r.requestId}`)).toEqual([
      '1:r1',
      '1:r2',
      '2:r1',
      '2:r2'
    ])
    expect(result.results.every((r) => r.detail?.outcome.kind === 'response')).toBe(true)
  })

  it('waits the configured delay between requests', async () => {
    await seed([request('r1'), request('r2'), request('r3')])
    const started = Date.now()
    await run(['r1', 'r2', 'r3'], { delayMs: 120 })
    // Two gaps between three requests.
    expect(Date.now() - started).toBeGreaterThanOrEqual(230)
  })

  it('stops starting requests after Stop and keeps what already finished', async () => {
    await seed([
      request('r1'),
      request('slow', { url: { raw: '{{baseUrl}}/delay/3000', query: [] } }),
      request('r3')
    ])
    const started = await runner.start({
      worktreeId: WT,
      scope: { collectionId: 'col' },
      environmentId: 'env',
      options: options(['r1', 'slow', 'r3']),
      origin: 'manual'
    })
    if (!started.ok) {
      throw new Error(started.message)
    }
    while (progress.length < 1) {
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    expect(runner.stop(started.runId)).toBe(true)
    const result = await started.done
    expect(result.state).toBe('stopped')
    expect(result.results.map((r) => r.requestId)).toEqual(['r1'])
  })

  it('ends as completed with stoppedEarly when stop-on-failure trips', async () => {
    await seed([
      request('ok', { events: { test: pass } }),
      request('fails', {
        url: { raw: '{{baseUrl}}/status/500', query: [] },
        events: { test: pass }
      }),
      request('never')
    ])
    const result = await run(['ok', 'fails', 'never'], { stopOnFailure: true })
    expect(result.state).toBe('completed')
    expect(result.stoppedEarly).toBe(true)
    expect(result.results.map((r) => r.requestId)).toEqual(['ok', 'fails'])
  })

  it('runs on after a failure when stop-on-failure is off', async () => {
    await seed([
      request('fails', {
        url: { raw: '{{baseUrl}}/status/500', query: [] },
        events: { test: pass }
      }),
      request('next', { events: { test: pass } })
    ])
    const result = await run(['fails', 'next'])
    expect(result.results.map((r) => r.requestId)).toEqual(['fails', 'next'])
    expect(result.stoppedEarly).toBe(false)
  })

  it('passes a variable set by an earlier test to a later request and persists it', async () => {
    await seed([
      request('login', {
        url: { raw: '{{baseUrl}}/token', query: [] },
        events: { test: { exec: ["pm.environment.set('token', pm.response.json().token)"] } }
      }),
      request('use', { headers: [{ key: 'X-Token', value: '{{token}}', enabled: true }] })
    ])
    const result = await run(['login', 'use'])
    expect(result.results[1].detail?.resolvedRequest.headers).toContainEqual([
      'X-Token',
      'test-token-value'
    ])
    const stored = await store.getSnapshot(WT)
    expect(stored.environments[0].variables.find((v) => v.key === 'token')?.value).toBe(
      'test-token-value'
    )
  })

  it('is not affected by edits made while it runs', async () => {
    await seed([
      request('first', { url: { raw: '{{baseUrl}}/delay/150', query: [] } }),
      request('second', { name: 'Original name' })
    ])
    const started = await runner.start({
      worktreeId: WT,
      scope: { collectionId: 'col' },
      environmentId: 'env',
      options: options(['first', 'second']),
      origin: 'manual'
    })
    if (!started.ok) {
      throw new Error(started.message)
    }
    await store.transact(WT, (data, tx) => {
      const collection = data.collections.get('col')
      const second = collection?.items.find((item) => item.id === 'second')
      if (second) {
        second.name = 'Edited during run'
        if (second.kind === 'request') {
          second.url.raw = '{{baseUrl}}/status/418'
        }
      }
      tx.touchCollection('col')
      return { ok: true as const }
    })
    const result = await started.done
    expect(result.results[1].requestName).toBe('Original name')
    expect(result.results[1].status).toBe(200)
  })

  async function startAndEdit(
    items: (ApiFolder | ApiRequest)[],
    edit: (collection: Collection) => void
  ): Promise<Run> {
    await seed(items)
    const started = await runner.start({
      worktreeId: WT,
      scope: { collectionId: 'col' },
      environmentId: 'env',
      options: options(['first', 'second']),
      origin: 'manual'
    })
    if (!started.ok) {
      throw new Error(started.message)
    }
    await store.transact(WT, (data, tx) => {
      const collection = data.collections.get('col')
      if (collection) {
        edit(collection)
      }
      tx.touchCollection('col')
      return { ok: true as const }
    })
    return started.done
  }

  const slowFirst = (): ApiRequest =>
    request('first', { url: { raw: '{{baseUrl}}/delay/150', query: [] } })

  it('still runs a request that was deleted while the run was going', async () => {
    const result = await startAndEdit([slowFirst(), request('second')], (collection) => {
      collection.items = collection.items.filter((item) => item.id !== 'second')
    })
    expect(result.results.map((r) => r.requestId)).toEqual(['first', 'second'])
    expect(result.results[1].status).toBe(200)
  })

  it('uses the folder scripts as they were when the run started', async () => {
    const result = await startAndEdit(
      [slowFirst(), folder('F', [request('second', { events: {} })])],
      (collection) => {
        const f = collection.items.find((item) => item.id === 'F')
        if (f?.kind === 'folder') {
          f.events = { test: { exec: ["pm.test('edited', function () { throw new Error('x') })"] } }
        }
      }
    )
    expect(result.results[1].tests).toEqual([])
  })

  it('refuses a second run on the same scope while one is going', async () => {
    await seed([request('slow', { url: { raw: '{{baseUrl}}/delay/300', query: [] } })])
    const first = await runner.start({
      worktreeId: WT,
      scope: { collectionId: 'col' },
      environmentId: 'env',
      options: options(['slow']),
      origin: 'manual'
    })
    const second = await runner.start({
      worktreeId: WT,
      scope: { collectionId: 'col' },
      environmentId: 'env',
      options: options(['slow']),
      origin: 'manual'
    })
    expect(second).toMatchObject({ ok: false, code: 'busy' })
    if (first.ok) {
      await first.done
    }
  })

  it('fails to start when the environment is missing and keeps the previous run', async () => {
    await seed([request('r1')])
    await run(['r1'])
    const failed = await run(['r1'], {}, { environmentId: 'gone' })
    expect(failed.state).toBe('failed-to-start')
    expect(failed.error).toContain('environment')
    const stored = await readLatestRun(store, WT, 'col')
    expect(stored?.state).toBe('completed')
  })

  it('derives totals that equal the per-request sums', async () => {
    await seed([
      request('a', { events: { test: pass } }),
      request('b', { url: { raw: '{{baseUrl}}/status/404', query: [] }, events: { test: pass } })
    ])
    const result = await run(['a', 'b'])
    const sum = (pick: (r: RunRequestResult) => number): number =>
      result.results.reduce((n, r) => n + pick(r), 0)
    expect(result.totals).toEqual({
      requests: 2,
      testsPassed: sum((r) => r.tests.filter((t) => t.passed).length),
      testsFailed: sum((r) => r.tests.filter((t) => !t.passed).length),
      durationMs: sum((r) => r.durationMs)
    })
    expect(result.totals.testsPassed).toBe(1)
    expect(result.totals.testsFailed).toBe(1)
  })

  it('persists the latest run per scope and survives a restart', async () => {
    await seed([folder('F', [request('r1')])])
    const result = await run(['r1'], {}, { scope: { collectionId: 'col', folderId: 'F' } })
    const fresh = new ApiClientStore({ root, secretStore })
    const stored = await readLatestRun(fresh, WT, 'F')
    expect(stored?.id).toBe(result.id)
    expect(stored?.results).toHaveLength(1)
  })

  it('marks agent runs as agent-initiated', async () => {
    await seed([request('r1')])
    const result = await run(['r1'], {}, { origin: 'agent' })
    expect(result.origin).toBe('agent')
    const latest = await readFile(getApiClientWorktreePaths(WT, root).resultFile('r1'), 'utf8')
    expect(JSON.parse(latest).origin).toBe('agent')
  })
})

describe('enforceRunSizeCap', () => {
  it('drops the oldest details first and keeps every summary', () => {
    const detail = (size: number): RunRequestResult['detail'] => ({
      resolvedRequest: { method: 'GET', url: 'x'.repeat(size), headers: [], body: null },
      outcome: { kind: 'error', code: 'network', message: '' },
      scriptLogs: []
    })
    const results: RunRequestResult[] = [1, 2, 3].map((n) => ({
      iteration: 1,
      requestId: `r${n}`,
      requestName: `r${n}`,
      folderPath: [],
      durationMs: 1,
      tests: [],
      detail: detail(1000)
    }))
    enforceRunSizeCap(results, 2500)
    expect(results.map((r) => r.detail !== null)).toEqual([false, true, true])
    expect(results.map((r) => r.requestId)).toEqual(['r1', 'r2', 'r3'])
  })
})
