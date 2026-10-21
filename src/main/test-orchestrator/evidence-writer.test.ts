import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { TestRun } from '../../shared/test-orchestrator/test-orchestrator-types'
import { evidenceImageName, slugifyForEvidence } from './evidence-names'
import { createEvidenceWriter } from './evidence-writer'

const context = { orcaVersion: '1.0.0', utcOffsetMinutes: 0 }
const startedAt = new Date(2026, 9, 19, 14, 32, 5)
let root: string

function makeRun(overrides: Partial<TestRun> = {}): TestRun {
  return {
    id: 'run-1',
    collectionId: 'c1',
    kind: 'full',
    environmentId: null,
    targetHosts: ['qa.example.com'],
    databaseMode: { mode: 'none' },
    state: 'running',
    ending: null,
    startedAt: startedAt.getTime(),
    endedAt: null,
    pausedMs: 0,
    currentStepIndex: 0,
    steps: [],
    pause: null,
    evidence: null,
    cleanup: { cleaned: 0, notCleaned: [], keptByUser: false },
    ...overrides
  }
}

function writerFor(rootPath: string, planName = 'Plan A', isFolderWorkspace = false) {
  return createEvidenceWriter({
    worktreeId: `repo::${rootPath}`,
    planName,
    isFolderWorkspace,
    now: startedAt
  })
}

function git(...args: string[]): string {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' })
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'evidence-writer-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('slugifyForEvidence', () => {
  it('produces ASCII [a-z0-9-] up to 60 chars', () => {
    expect(slugifyForEvidence('Crème brûlée / Plan: v2?', 'plan')).toBe('creme-brulee-plan-v2')
    expect(slugifyForEvidence('x'.repeat(100), 'plan')).toHaveLength(60)
    expect(slugifyForEvidence('日本語', 'plan')).toBe('plan')
  })

  it('avoids Windows reserved device names', () => {
    expect(slugifyForEvidence('NUL', 'plan')).toBe('nul-plan')
  })
})

describe('evidenceImageName', () => {
  it('follows NN-step-role[-n].png', () => {
    expect(evidenceImageName(3, 'SC-1', { kind: 'request' })).toBe('03-sc-1-request.png')
    expect(evidenceImageName(3, 'SC-1', { kind: 'request', concurrentIndex: 2 })).toBe(
      '03-sc-1-request-2.png'
    )
    expect(evidenceImageName(104, 'SC-1', { kind: 'after', queryIndex: 2 })).toBe(
      '104-sc-1-after-2.png'
    )
  })
})

describe('createEvidenceWriter', () => {
  it('creates evidencias/<slug>/<timestamp>/ and a second same-second run gets -2', async () => {
    const first = await writerFor(root)
    await first.writeReport(makeRun(), context)
    const second = await writerFor(root)
    expect(first.folder).toBe(join(root, 'evidencias', 'plan-a', '2026-10-19_14-32-05'))
    expect(second.folder).toBe(`${first.folder}-2`)
    expect((await readFile(first.reportPath, 'utf8')).length).toBeGreaterThan(0)
    expect(await readdir(join(root, 'evidencias', 'plan-a'))).toHaveLength(2)
  })

  it('links images relatively with forward slashes', async () => {
    const writer = await writerFor(root)
    const link = await writer.writeImage(3, 'SC-1', { kind: 'request' }, new Uint8Array([1, 2]))
    expect(link).toBe('images/03-sc-1-request.png')
    expect(link).not.toContain('\\')
    expect((await readdir(join(writer.folder, 'images')))[0]).toBe('03-sc-1-request.png')
  })

  it('keeps Windows path separators and device names out of image links', async () => {
    const writer = await writerFor(root)
    for (const stepId of ['SC\\1:2', 'CON', 'a/b']) {
      const link = await writer.writeImage(1, stepId, { kind: 'request' }, new Uint8Array([1]))
      expect(link).toMatch(/^images\/[a-z0-9-]+\.png$/)
    }
    expect(evidenceImageName(1, 'NUL', { kind: 'before', queryIndex: 1 })).toBe(
      '01-nul-plan-before-1.png'
    )
  })

  it('keeps report.md for a failed and a stopped run', async () => {
    for (const ending of ['failed', 'stopped-by-user'] as const) {
      const writer = await writerFor(root, `Plan ${ending}`)
      await writer.writeReport(makeRun({ state: 'finished', ending, endedAt: Date.now() }), context)
      const report = await readFile(writer.reportPath, 'utf8')
      expect(report).toContain(ending === 'failed' ? 'Failed' : 'Stopped by user')
    }
  })

  it('keeps Windows-hostile plan titles and timestamps path-safe', async () => {
    const writer = await createEvidenceWriter({
      worktreeId: `repo::${root}`,
      planName: 'C:\\Plans\\Con*fig? "v2"',
      isFolderWorkspace: true,
      now: startedAt
    })
    const relative = writer.folder.slice(root.length + 1).replaceAll('\\', '/')
    expect(relative).toBe('evidencias/c-plans-con-fig-v2/2026-10-19_14-32-05')
    expect(relative).not.toMatch(/[:*?"<>|]/)
  })

  it('sets ignoredByGit for an ignored evidencias/ and never touches the index', async () => {
    git('init', '-q')
    await writeFile(join(root, '.gitignore'), 'evidencias/\n')
    git('add', '.gitignore')
    const before = git('ls-files', '--stage')
    const writer = await writerFor(root)
    const evidence = await writer.writeReport(makeRun(), context)
    expect(evidence.ignoredByGit).toBe(true)
    expect(await readFile(writer.reportPath, 'utf8')).toContain('is ignored by source control')
    expect(git('ls-files', '--stage')).toBe(before)
    expect(git('status', '--porcelain')).not.toContain('evidencias')
  })

  it('leaves ignoredByGit false when not ignored, and skips the check for folder workspaces', async () => {
    git('init', '-q')
    const tracked = await (await writerFor(root)).writeReport(makeRun(), context)
    expect(tracked.ignoredByGit).toBe(false)

    const folderRoot = await mkdtemp(join(tmpdir(), 'evidence-folder-'))
    try {
      await mkdir(folderRoot, { recursive: true })
      await writeFile(join(folderRoot, '.gitignore'), 'evidencias/\n')
      const evidence = await (
        await writerFor(folderRoot, 'Plan A', true)
      ).writeReport(makeRun(), context)
      expect(evidence.ignoredByGit).toBe(false)
    } finally {
      await rm(folderRoot, { recursive: true, force: true })
    }
  })
})
