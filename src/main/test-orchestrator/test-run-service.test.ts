import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Collection, Environment } from '../../shared/api-client/api-client-types'
import { importPostmanJson } from '../../shared/api-client/postman-import'
import type { SecretStore } from '../../shared/secret-store'
import { linkTestMapFile } from '../../shared/test-orchestrator/test-map-linking'
import { parseTestMapFile } from '../../shared/test-orchestrator/test-map-schema'
import type { startRunParamsSchema } from '../../shared/test-orchestrator/test-orchestrator-ipc-schemas'
import type { z } from 'zod'
import { TestMapStore } from './test-map-store'
import { TestOrchestratorService, type TestRunRuntime } from './test-orchestrator-service'
import { createFakeSender } from './test-support/test-run-fakes'

const WT = 'wt'
const FIXTURES = fileURLToPath(
  new URL('../../shared/test-orchestrator/__fixtures__/', import.meta.url)
)
const secretStore: SecretStore = {
  isEncryptionAvailable: () => true,
  encryptString: (plain) => Buffer.from(plain),
  decryptString: (cipher) => cipher.toString(),
  describeProtectionGap: () => null
}

async function fixture(name: string): Promise<unknown> {
  return JSON.parse(await readFile(join(FIXTURES, name), 'utf8'))
}

let root: string
let collection: Collection
let environment: Environment
let service: TestOrchestratorService
let store: TestMapStore
let sentCount: () => number
let gate: Promise<void> = Promise.resolve()
const finishedRuns: string[] = []
let runtimeExtras: Partial<TestRunRuntime> = {}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'test-run-service-'))
  let id = 0
  const newId = (): string => `id-${++id}`
  const col = importPostmanJson(await fixture('smoke-plan.postman_collection.json'), { newId })
  const env = importPostmanJson(await fixture('smoke-plan.postman_environment.json'), { newId })
  if (!col.ok || col.kind !== 'collection' || !env.ok || env.kind !== 'environment') {
    throw new Error('fixture import failed')
  }
  collection = col.collection
  environment = env.environment
  const parsed = parseTestMapFile(await fixture('smoke-plan.no-db.test-map.json'))
  if (!parsed.ok) {
    throw new Error('fixture test map invalid')
  }
  store = new TestMapStore({ root, secretStore: () => secretStore })
  await store.saveMap(WT, collection.id, {
    orcaTestMap: 1,
    collectionId: collection.id,
    entries: linkTestMapFile(parsed.file, collection).entries,
    loadedAt: 1
  })
  const sender = createFakeSender({})
  sentCount = () => sender.calls.length
  finishedRuns.length = 0
  runtimeExtras = {}
  gate = Promise.resolve()
  service = new TestOrchestratorService({
    store,
    apiClient: {
      store: {
        getState: async () => ({
          collections: new Map([[collection.id, collection]]),
          environments: new Map([[environment.id, environment]])
        })
      }
    },
    browserBridge: { tabList: () => ({ tabs: [] }) },
    emitTestMapChanged: () => {},
    runtime: {
      sendRequest: async (input) => {
        await gate
        return sender.sendRequest(input)
      },
      emit: {
        changed: () => {},
        finished: ({ run }) => void finishedRuns.push(run.id)
      },
      changedThrottleMs: 0,
      createQueryHooks: async (request) =>
        (await runtimeExtras.createQueryHooks?.(request)) ?? { ok: true },
      testDatabase: async (params) => (await runtimeExtras.testDatabase?.(params)) ?? { ok: true }
    }
  })
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

type StartParams = z.output<typeof startRunParamsSchema>
const startParams = (extra: Partial<StartParams> = {}): StartParams => ({
  worktreeId: WT,
  collectionId: collection.id,
  environmentId: environment.id,
  kind: 'full',
  inputs: { host: 'http://localhost:1', tenantId: 't-1', userToken: 'sekret-token-1' },
  remember: { inputs: false, secrets: false },
  database: null,
  confirmedHosts: [],
  approvedDataChanges: [],
  ...extra
})

async function startAndFinish(params: StartParams) {
  const started = await service.start(params)
  if (!started.ok) {
    return started
  }
  await expect.poll(() => finishedRuns.includes(started.runId)).toBe(true)
  return started
}

describe('prepare', () => {
  it('lists inputs, steps and flags, never a remembered secret value', async () => {
    await store.savePlanSettings(WT, collection.id, {
      collectionId: collection.id,
      environmentId: environment.id,
      inputs: { host: 'http://localhost:9' },
      secretInputs: { userToken: 'sekret-token-1' }
    })
    const prepared = await service.prepare({
      worktreeId: WT,
      collectionId: collection.id,
      environmentId: environment.id
    })
    if (!prepared.ok) {
      throw new Error(prepared.message)
    }
    const { setup } = prepared
    expect(setup.inputs).toEqual([
      {
        name: 'host',
        secret: false,
        required: true,
        value: 'http://localhost:9',
        hasRemembered: true
      },
      { name: 'tenantId', secret: false, required: true, hasRemembered: false },
      { name: 'userToken', secret: true, required: true, hasRemembered: true }
    ])
    expect(JSON.stringify(setup)).not.toContain('sekret-token-1')
    expect(setup.steps.map((step) => step.stepId)).toContain('SC-4')
    expect(setup.hasQueries).toBe(false)
    expect(setup.uncleanedCaptures).toBe(0)
  })
})

describe('resolveTargets', () => {
  it('reports hosts and unresolved variables', async () => {
    const result = await service.resolveTargets({
      worktreeId: WT,
      collectionId: collection.id,
      environmentId: environment.id,
      inputs: { host: 'https://api.example.test' }
    })
    expect(result).toMatchObject({
      ok: true,
      hosts: [{ host: 'api.example.test', local: false }]
    })
  })
})

describe('start', () => {
  it('rejects missing inputs before sending anything', async () => {
    const result = await service.start(startParams({ inputs: { host: 'http://localhost:1' } }))
    expect(result).toMatchObject({ ok: false, code: 'missing-inputs' })
    expect(sentCount()).toBe(0)
  })

  it('requires confirmation for a non-local host', async () => {
    const params = startParams({
      inputs: { host: 'https://api.example.test', tenantId: 't', userToken: 'x' }
    })
    expect(await service.start(params)).toMatchObject({ ok: false, code: 'host-unconfirmed' })
    expect(sentCount()).toBe(0)
  })

  it('refuses a host outside the map allowlist even when confirmed', async () => {
    const stored = (await store.getMap(WT, collection.id)).value
    if (!stored) {
      throw new Error('missing map')
    }
    await store.saveMap(WT, collection.id, { ...stored, allowedHosts: ['*.corp.test'] })
    const params = startParams({
      inputs: { host: 'https://api.example.test', tenantId: 't', userToken: 'x' },
      confirmedHosts: ['api.example.test']
    })
    expect(await service.start(params)).toMatchObject({ ok: false, code: 'host-not-allowed' })
  })

  it('runs, remembers inputs and sealed secrets, then pre-fills the next start', async () => {
    const first = await startAndFinish(startParams({ remember: { inputs: true, secrets: true } }))
    expect(first.ok).toBe(true)
    const stored = await store.getPlanSettings(WT, collection.id)
    expect(stored.value?.inputs).toEqual({ host: 'http://localhost:1', tenantId: 't-1' })
    expect(stored.value?.secretInputs).toEqual({ userToken: 'sekret-token-1' })

    const sentBefore = sentCount()
    const second = await startAndFinish(startParams({ inputs: {} }))
    expect(second.ok).toBe(true)
    expect(sentCount()).toBeGreaterThan(sentBefore)
    const run = await service.getRun({ worktreeId: WT, collectionId: collection.id })
    expect(run?.state).toBe('finished')
  })

  it('does not persist anything unless the user asked to remember', async () => {
    await startAndFinish(startParams())
    expect((await store.getPlanSettings(WT, collection.id)).value).toBeNull()
  })

  it('clears remembered secrets only', async () => {
    await startAndFinish(startParams({ remember: { inputs: true, secrets: true } }))
    await service.clearRememberedSecrets({ worktreeId: WT, collectionId: collection.id })
    const stored = await store.getPlanSettings(WT, collection.id)
    expect(stored.value?.secretInputs).toEqual({})
    expect(stored.value?.inputs.host).toBe('http://localhost:1')
  })

  it('reports a second start as busy and serves step detail', async () => {
    let release = (): void => {}
    gate = new Promise((resolve) => (release = resolve))
    const first = await service.start(startParams())
    const second = await service.start(startParams())
    release()
    expect(second).toMatchObject({ ok: false, code: 'busy' })
    if (!first.ok) {
      throw new Error(first.message)
    }
    await expect.poll(() => finishedRuns.includes(first.runId)).toBe(true)
    const detail = await service.getStepDetail({
      worktreeId: WT,
      collectionId: collection.id,
      runId: first.runId,
      stepIndex: 0
    })
    expect(detail).toMatchObject({ ok: true, step: { stepId: 'P-1' } })
    expect(await service.stop({ worktreeId: WT, runId: first.runId })).toMatchObject({
      ok: false,
      code: 'not-found'
    })
  })
})

describe('database modes', () => {
  it('records the connection name and disposes the hooks when the run ends', async () => {
    let disposed = 0
    runtimeExtras = {
      createQueryHooks: async () => ({
        ok: true,
        connectionName: 'Local dev',
        dispose: async () => void disposed++
      })
    }
    const started = await startAndFinish(
      startParams({
        database: { mode: 'automatic', connectionId: 'c-1', projectKey: 'p' }
      })
    )
    if (!started.ok) {
      throw new Error(started.message)
    }
    await expect.poll(() => disposed).toBe(1)
    const run = await service.getRun({ worktreeId: WT, collectionId: collection.id })
    expect(run?.databaseMode).toEqual({ mode: 'automatic', connectionName: 'Local dev' })
  })

  it('does not start when the mode cannot be prepared', async () => {
    runtimeExtras = {
      createQueryHooks: async () => ({
        ok: false,
        code: 'console-not-found',
        message: 'Pick a tab.'
      })
    }
    const result = await service.start(
      startParams({ database: { mode: 'browser', origin: 'http://localhost:5050' } })
    )
    expect(result).toMatchObject({ ok: false, code: 'console-not-found' })
    expect(sentCount()).toBe(0)
  })

  it('records the manual mode', async () => {
    await startAndFinish(startParams({ database: { mode: 'manual' } }))
    const run = await service.getRun({ worktreeId: WT, collectionId: collection.id })
    expect(run?.databaseMode).toEqual({ mode: 'manual' })
  })

  it('forwards the connection test result', async () => {
    runtimeExtras = {
      testDatabase: async () => ({ ok: false, code: 'connection-failed', message: 'refused' })
    }
    const result = await service.testDatabase({
      worktreeId: WT,
      mode: { mode: 'automatic', connectionId: 'c-1', projectKey: 'p' }
    })
    expect(result).toMatchObject({ ok: false, code: 'connection-failed' })
  })
})

describe('forgetCaptures', () => {
  it('clears the ledger', async () => {
    await store.ledger.append(WT, collection.id, {
      variable: 'orderId',
      value: '7',
      stepId: 'SC-1',
      runId: 'r',
      capturedAt: 1,
      source: 'script',
      cleaned: null
    })
    expect(await store.ledger.listUncleaned(WT, collection.id)).toHaveLength(1)
    expect(await service.forgetCaptures({ worktreeId: WT, collectionId: collection.id })).toEqual({
      ok: true
    })
    expect(await store.ledger.listUncleaned(WT, collection.id)).toHaveLength(0)
  })
})
