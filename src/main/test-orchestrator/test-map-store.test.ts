import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { SecretStore } from '../../shared/secret-store'
import type {
  CapturedValue,
  PlanSettings,
  TestMap,
  TestRun
} from '../../shared/test-orchestrator/test-orchestrator-types'
import { getApiClientWorktreePaths } from '../api-client/api-client-storage-paths'
import { StoredFileReadOnlyError, TestMapStore } from './test-map-store'

function nonceSecretStore(available = true): SecretStore {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (plain) => Buffer.from(`enc:${plain}`),
    decryptString: (cipher) => cipher.toString().replace(/^enc:/, ''),
    describeProtectionGap: () => (available ? null : 'no keychain')
  }
}

const WT = 'wt'
const COL = 'col-1'
let root: string
let secretStore: SecretStore
let store: TestMapStore
const paths = () => getApiClientWorktreePaths(WT, root)

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'test-map-store-'))
  secretStore = nonceSecretStore()
  store = new TestMapStore({ root, secretStore: () => secretStore })
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

const map: TestMap = {
  orcaTestMap: 1,
  collectionId: COL,
  entries: [
    { ref: { id: 'r1' }, link: { state: 'linked', requestId: 'r1' }, before: [], after: [] }
  ],
  loadedAt: 1
}
const settings: PlanSettings = {
  collectionId: COL,
  environmentId: null,
  inputs: { region: 'eu' },
  secretInputs: { password: 'hunter2-plain' }
}
const capture = (variable: string, value: string, stepId = 'SC-1'): CapturedValue => ({
  variable,
  value,
  capturedAt: 1,
  runId: 'run-1',
  stepId,
  source: 'script',
  cleaned: null
})
function run(body = 'x'): TestRun {
  return {
    id: 'run-1',
    collectionId: COL,
    kind: 'full',
    environmentId: null,
    targetHosts: [],
    databaseMode: { mode: 'none' },
    state: 'finished',
    ending: 'passed',
    startedAt: 1,
    endedAt: 2,
    pausedMs: 0,
    currentStepIndex: null,
    steps: [
      {
        stepId: 'SC-1',
        title: 't',
        phase: 'scenario',
        result: 'pass',
        dependencyFailed: [],
        expectedText: '',
        actualText: '',
        before: [],
        after: [],
        durationMs: 1,
        exchanges: [
          {
            requestId: 'r1',
            resolvedRequest: { method: 'GET', url: 'http://x', headers: [], body: null },
            outcome: {
              kind: 'response',
              response: {
                status: 200,
                statusText: 'OK',
                headers: [],
                sizeBytes: body.length,
                contentType: null,
                body: { encoding: 'utf8', text: body, truncated: false },
                redirects: []
              }
            },
            tests: [],
            screenshot: null
          }
        ]
      }
    ],
    pause: null,
    evidence: null,
    cleanup: { cleaned: 0, notCleaned: [], keptByUser: false }
  }
}

describe('round trips', () => {
  it('stores the map, plan settings and latest run', async () => {
    await store.saveMap(WT, COL, map)
    await store.savePlanSettings(WT, COL, settings)
    await store.saveRun(WT, COL, run())
    expect((await store.getMap(WT, COL)).value).toEqual(map)
    expect((await store.getPlanSettings(WT, COL)).value).toEqual(settings)
    expect((await store.getRun(WT, COL)).value?.id).toBe('run-1')
    await store.saveRun(WT, COL, { ...run(), id: 'run-2' })
    expect((await store.getRun(WT, COL)).value?.id).toBe('run-2')
  })

  it('returns null for missing files', async () => {
    expect(await store.getMap(WT, COL)).toEqual({ value: null, readOnly: false })
  })

  it('caps long response bodies', async () => {
    await store.saveRun(WT, COL, run('a'.repeat(2_000_000)))
    const got = (await store.getRun(WT, COL)).value
    const outcome = got?.steps[0]?.exchanges[0]?.outcome
    expect(outcome?.kind === 'response' && outcome.response.body.truncated).toBe(true)
  })
})

describe('corruption', () => {
  it('quarantines an invalid file and loads as missing', async () => {
    const file = paths().testMapFile(COL)
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, '{not json')
    expect((await store.getMap(WT, COL)).value).toBeNull()
    expect(await readdir(paths().corruptDir)).toHaveLength(1)
  })
})

describe('secrets', () => {
  it('never writes secret inputs or sensitive ledger values in plain text', async () => {
    await store.savePlanSettings(WT, COL, settings)
    await store.ledger.append(WT, COL, capture('authToken', 'tok-plain'))
    await store.ledger.append(WT, COL, capture('requestId', 'id-plain'))
    const plan = await readFile(paths().testPlanFile(COL), 'utf8')
    const ledger = await readFile(paths().testCapturesFile(COL), 'utf8')
    expect(plan).not.toContain('hunter2-plain')
    expect(ledger).not.toContain('tok-plain')
    expect(ledger).toContain('id-plain')
    expect((await store.getPlanSettings(WT, COL)).value?.secretInputs).toEqual(
      settings.secretInputs
    )
    const [token] = await store.ledger.listUncleaned(WT, COL)
    expect(token?.value).toBe('tok-plain')
  })

  it('memory-only: secrets are not written and ledger values survive only in session', async () => {
    secretStore = nonceSecretStore(false)
    await store.savePlanSettings(WT, COL, settings)
    const plan = await store.getPlanSettings(WT, COL)
    expect(plan.value?.secretInputs).toEqual({})
    expect(plan.unavailableSecretInputs).toEqual(['password'])

    await store.ledger.append(WT, COL, capture('authToken', 'tok-plain'))
    const onDisk = await readFile(paths().testCapturesFile(COL), 'utf8')
    expect(onDisk).not.toContain('tok-plain')
    expect(onDisk).toContain('"unavailable":true')
    expect((await store.ledger.listUncleaned(WT, COL))[0]).toMatchObject({
      value: 'tok-plain'
    })

    const restarted = new TestMapStore({ root, secretStore: () => secretStore })
    const [after] = await restarted.ledger.listUncleaned(WT, COL)
    expect(after).toMatchObject({
      variable: 'authToken',
      stepId: 'SC-1',
      unavailable: true,
      value: ''
    })
  })
})

describe('newer schemaVersion', () => {
  it('shows data read-only and refuses saves', async () => {
    const file = paths().testMapFile(COL)
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, JSON.stringify({ schemaVersion: 2, map }))
    const read = await store.getMap(WT, COL)
    expect(read).toEqual({ value: map, readOnly: true })
    await expect(store.saveMap(WT, COL, map)).rejects.toBeInstanceOf(StoredFileReadOnlyError)
    expect(await readdir(paths().corruptDir).catch(() => [])).toHaveLength(0)
  })

  it('refuses ledger changes', async () => {
    const file = paths().testCapturesFile(COL)
    await mkdir(dirname(file), { recursive: true })
    await writeFile(
      file,
      JSON.stringify({ schemaVersion: 2, ledger: { collectionId: COL, values: [] } })
    )
    await expect(store.ledger.append(WT, COL, capture('a', 'b'))).rejects.toBeInstanceOf(
      StoredFileReadOnlyError
    )
  })
})

describe('capture ledger', () => {
  it('appends, marks cleaned and forgets', async () => {
    await store.ledger.append(WT, COL, capture('requestId', 'a', 'SC-1'))
    await store.ledger.append(WT, COL, capture('orderId', 'b', 'SC-2'))
    await store.ledger.markCleaned(
      WT,
      COL,
      { variable: 'requestId', runId: 'run-1', stepId: 'SC-1' },
      { runId: 'run-2', stepId: 'C-1', at: 5 }
    )
    expect((await store.ledger.listUncleaned(WT, COL)).map((v) => v.variable)).toEqual(['orderId'])
    await store.ledger.forget(WT, COL, { variable: 'orderId', runId: 'run-1', stepId: 'SC-2' })
    expect(await store.ledger.listUncleaned(WT, COL)).toEqual([])
    await store.ledger.append(WT, COL, capture('x', 'y'))
    await store.ledger.forget(WT, COL)
    expect((await store.ledger.list(WT, COL)).values).toEqual([])
  })

  it('serializes concurrent appends', async () => {
    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        store.ledger.append(WT, COL, capture(`v${i}`, 'x', `S${i}`))
      )
    )
    expect(await store.ledger.listUncleaned(WT, COL)).toHaveLength(10)
  })
})
