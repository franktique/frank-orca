import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { SecretStore } from '../../shared/secret-store'
import type {
  CapturedValue,
  StepResult
} from '../../shared/test-orchestrator/test-orchestrator-types'
import { CaptureLedgerStore } from './capture-ledger-store'
import { createRunCleanup } from './test-run-cleanup'
import { fakePlanStep } from './test-support/test-run-fakes'

const W = 'wt'
const C = 'col'
let root: string
let secretAvailable = true
let ledger: CaptureLedgerStore

const secretStore = (): SecretStore => ({
  isEncryptionAvailable: () => secretAvailable,
  encryptString: (plain) => Buffer.from(`enc:${plain}`),
  decryptString: (cipher) => cipher.toString().replace(/^enc:/, ''),
  describeProtectionGap: () => (secretAvailable ? null : 'no keychain')
})

beforeEach(async () => {
  secretAvailable = true
  root = await mkdtemp(join(tmpdir(), 'run-cleanup-'))
  ledger = new CaptureLedgerStore({ root, secretStore })
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

const capture = (variable: string, value: string, stepId = 'S-1'): CapturedValue => ({
  variable,
  value,
  capturedAt: 1,
  runId: 'run-0',
  stepId,
  source: 'script',
  cleaned: null
})

const cleanupStep = (forEach?: string) =>
  fakePlanStep('C-1', 'cleanup', 5, { entry: forEach ? { forEach } : {} })
const context = { runId: 'run-1', worktreeId: W, collectionId: C }

function makeCleanup() {
  return createRunCleanup({
    ledger,
    runId: 'run-1',
    worktreeId: W,
    collectionId: C,
    maskText: (text) => text.replace('secretish', '***')
  })
}

const resultFor = (value: string, result: StepResult['result']): StepResult => ({
  stepId: 'C-1',
  title: 't',
  phase: 'cleanup',
  iterationValue: { variable: 'caseId', valueMasked: value },
  result,
  dependencyFailed: [],
  expectedText: '',
  actualText: '',
  before: [],
  after: [],
  exchanges: [],
  durationMs: 0
})

describe('createRunCleanup', () => {
  it('runs a forEach step once per recorded value, including overwritten ones', async () => {
    await ledger.append(W, C, capture('caseId', 'a'))
    await ledger.append(W, C, capture('caseId', 'b', 'S-2'))
    await ledger.append(W, C, capture('other', 'z', 'S-3'))
    const items = await makeCleanup().expandCleanup(cleanupStep('caseId'), context)
    expect(items.map((item) => item.iterationValue)).toEqual([
      { variable: 'caseId', value: 'a' },
      { variable: 'caseId', value: 'b' }
    ])
  })

  it('runs an unmarked step once with current values', async () => {
    await ledger.append(W, C, capture('caseId', 'a'))
    const step = cleanupStep()
    expect(await makeCleanup().expandCleanup(step, context)).toEqual([{ step }])
  })

  it('marks passing iterations cleaned and leaves uncleaned values in the ledger', async () => {
    await ledger.append(W, C, capture('caseId', 'a'))
    await ledger.append(W, C, capture('caseId', 'b', 'S-2'))
    const cleanup = makeCleanup()
    await cleanup.expandCleanup(cleanupStep('caseId'), context)
    const summary = await cleanup.finalize([resultFor('a', 'pass'), resultFor('b', 'fail')])
    expect(summary).toEqual({
      cleaned: 1,
      notCleaned: [{ variable: 'caseId', valueMasked: 'b' }]
    })
    const { values } = await ledger.list(W, C)
    expect(values.find((v) => v.value === 'a')?.cleaned).toMatchObject({ runId: 'run-1' })
    expect(values.find((v) => v.value === 'b')?.cleaned).toBeNull()
  })

  it('lists everything as not cleaned after a 500 on the only iteration', async () => {
    await ledger.append(W, C, capture('caseId', 'a'))
    const cleanup = makeCleanup()
    await cleanup.expandCleanup(cleanupStep('caseId'), context)
    const summary = await cleanup.finalize([resultFor('a', 'fail')])
    expect(summary.cleaned).toBe(0)
    expect(summary.notCleaned).toHaveLength(1)
  })

  it('skips values already cleaned by an earlier run', async () => {
    await ledger.append(W, C, capture('caseId', 'a'))
    await ledger.markCleaned(
      W,
      C,
      { variable: 'caseId', runId: 'run-0', stepId: 'S-1' },
      { runId: 'run-0', stepId: 'C-1', at: 2 }
    )
    await ledger.append(W, C, capture('caseId', 'b', 'S-2'))
    const items = await makeCleanup().expandCleanup(cleanupStep('caseId'), context)
    expect(items.map((item) => item.iterationValue?.value)).toEqual(['b'])
  })

  it('lists unavailable placeholders as not cleaned and never sends them', async () => {
    secretAvailable = false
    await ledger.append(W, C, capture('caseToken', 'tok-1'))
    await ledger.append(W, C, capture('caseId', 'a', 'S-2'))
    // Why: a fresh store has no session memory, like after an app restart.
    const cleanupRestarted = createRunCleanup({
      ledger: new CaptureLedgerStore({ root, secretStore }),
      runId: 'run-1',
      worktreeId: W,
      collectionId: C,
      maskText: (text) => text
    })
    const items = await cleanupRestarted.expandCleanup(cleanupStep('caseToken'), context)
    expect(items).toEqual([])
    const summary = await cleanupRestarted.finalize([])
    expect(summary.notCleaned).toContainEqual(
      expect.objectContaining({ variable: 'caseToken', unavailable: true })
    )
    expect(JSON.stringify(summary)).not.toContain('tok-1')
  })

  it('masks sensitive values in the not-cleaned list', async () => {
    await ledger.append(W, C, capture('apiToken', 'tok-live'))
    const summary = await makeCleanup().finalize([])
    expect(summary.notCleaned[0].valueMasked).not.toContain('tok-live')
  })
})
