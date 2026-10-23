import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { Collection, Environment } from '../../shared/api-client/api-client-types'
import { importPostmanJson } from '../../shared/api-client/postman-import'
import { buildPlanSteps } from '../../shared/test-orchestrator/plan-steps'
import { linkTestMapFile } from '../../shared/test-orchestrator/test-map-linking'
import { parseTestMapFile } from '../../shared/test-orchestrator/test-map-schema'
import type {
  StepResult,
  TestMap,
  TestRun
} from '../../shared/test-orchestrator/test-orchestrator-types'
import { ApiClientConsoleBuffer } from '../api-client/api-client-console-buffer'
import { ApiClientStore } from '../api-client/api-client-store'
import { HttpRequestSender } from '../api-client/http-request-sender'
import {
  executeRequest,
  type ExecuteRequestInput,
  type RequestExecutionDeps
} from '../api-client/request-execution'
import { runScript } from '../api-client/script-sandbox/script-sandbox-runner'
import { createRunEvidenceSession } from './run-evidence-session'
import { TestRunOrchestrator } from './test-run-orchestrator'
import { startPlanEchoServer, type PlanEchoServer } from './test-support/plan-echo-routes'
import { createMemoryLedger } from './test-support/test-run-fakes'

const TOKEN = 'tok-secret-echo-9f3a'
const FIXTURES = fileURLToPath(
  new URL('../../shared/test-orchestrator/__fixtures__/', import.meta.url)
)

async function readFixture(name: string): Promise<unknown> {
  return JSON.parse(await readFile(join(FIXTURES, name), 'utf8'))
}

let server: PlanEchoServer
let root: string
let counter = 0

beforeAll(async () => {
  server = await startPlanEchoServer()
})
afterAll(async () => {
  await server.close()
})
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'plan-echo-run-'))
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

type Harness = {
  collection: Collection
  environment: Environment
  testMap: TestMap
  /** Request names in the order they reached the sender. */
  sent: string[]
  /** Sum of request durations per step, to measure orchestrator overhead. */
  requestMs: number[]
  orchestrator: TestRunOrchestrator
  renders: number[]
  start: (overrides?: {
    skipRequestScript?: string
    breakRequestUrl?: string
  }) => ReturnType<TestRunOrchestrator['start']>
}

async function buildHarness(): Promise<Harness> {
  const newId = (): string => `id-${++counter}`
  const worktreeId = `repo::${root}`
  const imported = importPostmanJson(await readFixture('smoke-plan.postman_collection.json'), {
    newId
  })
  const importedEnv = importPostmanJson(await readFixture('smoke-plan.postman_environment.json'), {
    newId
  })
  if (!imported.ok || imported.kind !== 'collection' || !importedEnv.ok) {
    throw new Error('fixture import failed')
  }
  if (importedEnv.kind !== 'environment') {
    throw new Error('fixture environment import failed')
  }
  const { collection } = imported
  const { environment } = importedEnv

  const store = new ApiClientStore({
    root,
    newId,
    secretStore: () => ({
      isEncryptionAvailable: () => true,
      encryptString: (plain) => Buffer.from(plain),
      decryptString: (cipher) => cipher.toString(),
      describeProtectionGap: () => null
    })
  })
  await store.transact(worktreeId, (data, tx) => {
    data.collections.set(collection.id, collection)
    tx.touchCollection(collection.id)
    return { ok: true as const }
  })
  const deps: RequestExecutionDeps = {
    store,
    sender: new HttpRequestSender(() => (url, init) => fetch(url, init)),
    sandbox: { run: runScript },
    consoleBuffer: new ApiClientConsoleBuffer(),
    getSslVerification: () => true
  }

  const parsed = parseTestMapFile(await readFixture('smoke-plan.no-db.test-map.json'))
  if (!parsed.ok) {
    throw new Error('fixture test map invalid')
  }
  const { entries } = linkTestMapFile(parsed.file, collection)
  const testMap: TestMap = { orcaTestMap: 1, collectionId: collection.id, entries, loadedAt: 1 }

  const sent: string[] = []
  const requestMs: number[] = []
  const renders: number[] = []
  let overrides: { skipRequestScript?: string; breakRequestUrl?: string } = {}
  const sendRequest = async (input: ExecuteRequestInput) => {
    sent.push(input.request.name)
    const request =
      input.request.name === overrides.skipRequestScript
        ? { ...input.request, events: {}, url: { raw: '{{host}}/missing', query: [] } }
        : input.request.name === overrides.breakRequestUrl
          ? { ...input.request, url: { raw: '{{host}}/missing', query: [] } }
          : input.request
    const result = await executeRequest(deps, { ...input, request })
    if (result.ok) {
      requestMs.push(result.latest.durationMs)
    }
    return result
  }

  const orchestrator = new TestRunOrchestrator({
    sendRequest,
    store: { saveRun: async () => {}, ledger: createMemoryLedger() },
    emit: { changed: () => {}, finished: () => {} },
    changedThrottleMs: 0,
    openEvidence: createRunEvidenceSession({
      worktreeId,
      planName: 'Smoke plan',
      isFolderWorkspace: true,
      orcaVersion: '1.0.0',
      createSnapshotWindow: () => ({
        render: async (card) => {
          renders.push(JSON.stringify(card).length)
          return Buffer.from('png')
        },
        destroy: () => {}
      })
    })
  })

  const steps = buildPlanSteps({ collection, testMap })
  return {
    collection,
    environment,
    testMap,
    sent,
    requestMs,
    renders,
    orchestrator,
    start: (next = {}) => {
      overrides = next
      return orchestrator.start({
        worktreeId,
        collectionId: collection.id,
        environmentId: null,
        steps,
        testMap,
        environment,
        collectionVariables: collection.variables,
        inputs: [
          { name: 'host', value: server.baseUrl, secret: false },
          { name: 'tenantId', value: 'tenant-1', secret: false },
          { name: 'userToken', value: TOKEN, secret: true }
        ],
        targetHosts: ['127.0.0.1'],
        databaseMode: { mode: 'none' },
        planName: 'Smoke plan'
      })
    }
  }
}

async function finish(result: ReturnType<Harness['start']>): Promise<TestRun> {
  if (!result.ok) {
    throw new Error(result.message)
  }
  return result.finished
}

const stepOf = (run: TestRun, stepId: string): StepResult => {
  const step = run.steps.find((candidate) => candidate.stepId === stepId)
  if (!step) {
    throw new Error(`no step ${stepId}`)
  }
  return step
}

describe('TestRunOrchestrator against the plan echo server', () => {
  it('runs the whole no-db plan, passing captured caseId to scenarios and SC-4 on 422 · AM00109', async () => {
    const h = await buildHarness()
    const run = await finish(h.start())

    expect(run.ending).toBe('passed')
    expect(run.steps.map((step) => step.stepId)).toEqual([
      'P-1',
      'S-1',
      'SC-1',
      'SC-4',
      'SC-14a',
      'C-1'
    ])
    expect(run.steps.every((step) => step.result === 'pass')).toBe(true)
    expect(stepOf(run, 'SC-4').actualText).toBe('422 · AM00109')
    // The script-captured case id reached the scenarios and the cleanup delete.
    expect(stepOf(run, 'SC-1').exchanges[0].resolvedRequest.body).toContain('case-')
    expect(stepOf(run, 'C-1').exchanges[0].resolvedRequest.url).toMatch(/\/cases\/case-\d+$/)
    expect(h.renders.length).toBeGreaterThan(0)
  })

  it('blocks a scenario whose captured variable was never produced', async () => {
    const h = await buildHarness()
    const run = await finish(h.start({ skipRequestScript: 'Create case' }))

    expect(stepOf(run, 'S-1').result).toBe('fail')
    expect(stepOf(run, 'SC-1')).toMatchObject({
      result: 'blocked',
      reason: 'blocked by setup step S-1'
    })
    expect(h.sent).not.toContain('SC-1 Bulk create')
    expect(run.ending).toBe('failed')
  })

  it('sends no setup request when preflight fails', async () => {
    const h = await buildHarness()
    const run = await finish(h.start({ breakRequestUrl: 'Health' }))

    expect(run.ending).toBe('preflight-failed')
    expect(h.sent).not.toContain('Create case')
    expect(stepOf(run, 'S-1').result).toBe('skipped')
    expect(stepOf(run, 'S-1').reason).toContain('preflight failed')
  })

  it('refuses a second start of the same plan while one is active', async () => {
    const h = await buildHarness()
    const first = h.start()
    const second = h.start()
    expect(second).toMatchObject({ ok: false, code: 'busy' })
    await finish(first)
    expect(h.orchestrator.activeRunId(`repo::${root}`, h.collection.id)).toBeNull()
  })

  it('writes a report listing every step and never the token', async () => {
    const h = await buildHarness()
    const run = await finish(h.start())

    const report = await readFile(run.evidence?.reportPath ?? '', 'utf8')
    for (const step of run.steps) {
      expect(report).toContain(step.stepId)
    }
    expect(report).not.toContain(TOKEN)
    expect(JSON.stringify(run)).not.toContain(TOKEN)
  })

  it('keeps orchestrator overhead per step under one second', async () => {
    const h = await buildHarness()
    const run = await finish(h.start())

    const requestTotal = h.requestMs.reduce((sum, ms) => sum + ms, 0)
    const stepTotal = run.steps.reduce((sum, step) => sum + step.durationMs, 0)
    const overheadPerStep = (stepTotal - requestTotal) / run.steps.length
    expect(overheadPerStep).toBeLessThan(1000)
  })
})
