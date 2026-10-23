import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { EvidenceSnapshotCard } from '../../shared/test-orchestrator/evidence-snapshot-card'
import { createRunEvidenceSession } from './run-evidence-session'
import { TestRunOrchestrator } from './test-run-orchestrator'
import { createFakeSender, emptyLedger, fakePlanStep } from './test-support/test-run-fakes'

let root: string
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'run-evidence-'))
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

function harness(renderer: { render: (c: EvidenceSnapshotCard) => Promise<Buffer> }) {
  const cards: EvidenceSnapshotCard[] = []
  let destroyed = 0
  const openEvidence = createRunEvidenceSession({
    worktreeId: `repo::${root}`,
    planName: 'Plan A',
    isFolderWorkspace: true,
    orcaVersion: '1.0.0',
    createSnapshotWindow: () => ({
      render: async (card) => {
        cards.push(card)
        return renderer.render(card)
      },
      destroy: () => void destroyed++
    })
  })
  const sender = createFakeSender({
    'req-S-1': { body: '{"echo":"tok-secret-123"}', scriptSets: { token: 'tok-secret-123' } }
  })
  const orchestrator = new TestRunOrchestrator({
    sendRequest: sender.sendRequest,
    store: { saveRun: async () => {}, ledger: emptyLedger },
    emit: { changed: () => {}, finished: () => {} },
    openEvidence,
    changedThrottleMs: 0
  })
  return { orchestrator, cards, destroyed: () => destroyed }
}

async function runOnce(h: ReturnType<typeof harness>) {
  const result = h.orchestrator.start({
    worktreeId: `repo::${root}`,
    collectionId: 'col',
    environmentId: null,
    steps: [fakePlanStep('S-1', 'scenario', 0)],
    testMap: null,
    environment: null,
    collectionVariables: [],
    inputs: [{ name: 'userToken', value: 'tok-secret-123', secret: true }],
    targetHosts: [],
    databaseMode: { mode: 'none' }
  })
  if (!result.ok) {
    throw new Error(result.message)
  }
  return result.finished
}

describe('createRunEvidenceSession', () => {
  it('writes a masked image, links it, writes the report, and destroys the window', async () => {
    const h = harness({ render: async () => Buffer.from('png-bytes') })
    const run = await runOnce(h)
    const link = run.steps[0].exchanges[0].screenshot
    expect(link).toMatch(/^scenarios\/S-1\/S-1-request\.png$/)
    expect(JSON.stringify(h.cards)).not.toContain('tok-secret-123')
    expect(h.cards[0]).toMatchObject({ kind: 'request', title: 'Title S-1' })
    const folder = run.evidence?.folder ?? ''
    expect(await readdir(join(folder, 'scenarios', 'S-1'))).toHaveLength(1)
    const report = await readFile(run.evidence?.reportPath ?? '', 'utf8')
    expect(report).toContain('S-1')
    expect(report).not.toContain('tok-secret-123')
    expect(h.destroyed()).toBe(1)
  })

  it('keeps the step result and still destroys the window when rendering fails', async () => {
    const h = harness({
      render: async () => {
        throw new Error('paint failed')
      }
    })
    const run = await runOnce(h)
    expect(run.steps[0].result).toBe('pass')
    expect(run.steps[0].exchanges[0].screenshot).toBeNull()
    expect(run.evidence?.reportPath).toBeTruthy()
    expect(h.destroyed()).toBe(1)
  })
})
