// Writes the evidence bundle: specs/003-e2e-test-orchestrator/contracts/evidence-bundle-format.md
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { checkIgnoredPaths } from '../git/check-ignored-paths'
import { writeFileDurable } from '../durable-file-write'
import { splitWorktreeIdForFilesystem } from '../../shared/worktree/id'
import { renderEvidenceReport } from '../../shared/test-orchestrator/evidence-markdown'
import type { EvidenceReportContext } from '../../shared/test-orchestrator/evidence-markdown'
import type { TestRun } from '../../shared/test-orchestrator/test-orchestrator-types'
import { evidenceImageName, formatRunFolderTimestamp, slugifyForEvidence } from './evidence-names'
import type { EvidenceImageRole, EvidenceStep } from './evidence-names'

const EVIDENCE_DIR = 'evidencias'
const MAX_FOLDER_ATTEMPTS = 1000

export type EvidenceWriterOptions = {
  worktreeId: string
  planName: string
  isFolderWorkspace: boolean
  now?: Date
}

export type EvidenceWriter = {
  folder: string
  reportPath: string
  /** Writes the PNG into the case's folder and returns its relative link for `report.md`. */
  writeImage: (step: EvidenceStep, role: EvidenceImageRole, png: Uint8Array) => Promise<string>
  /** Rewrites `report.md`; returns the evidence location to store on the run. */
  writeReport: (
    run: TestRun,
    context: Omit<EvidenceReportContext, 'planName'>
  ) => Promise<NonNullable<TestRun['evidence']>>
}

async function createRunFolder(planDir: string, timestamp: string): Promise<string> {
  await mkdir(planDir, { recursive: true })
  for (let attempt = 1; attempt <= MAX_FOLDER_ATTEMPTS; attempt++) {
    const candidate = join(planDir, attempt === 1 ? timestamp : `${timestamp}-${attempt}`)
    try {
      // Why: non-recursive mkdir is an atomic claim, so a same-second run never reuses a folder.
      await mkdir(candidate)
      return candidate
    } catch (error) {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'EEXIST') {
        throw error
      }
    }
  }
  throw new Error('Could not create a unique evidence folder.')
}

async function detectIgnoredByGit(root: string): Promise<boolean> {
  try {
    return (await checkIgnoredPaths(root, [`${EVIDENCE_DIR}/`])).length > 0
  } catch {
    return false
  }
}

export async function createEvidenceWriter(
  options: EvidenceWriterOptions
): Promise<EvidenceWriter> {
  const parsed = splitWorktreeIdForFilesystem(options.worktreeId)
  if (!parsed) {
    throw new Error(`Invalid worktree id: ${options.worktreeId}`)
  }
  const root = parsed.worktreePath
  const now = options.now ?? new Date()
  const planDir = join(root, EVIDENCE_DIR, slugifyForEvidence(options.planName, 'plan'))
  const folder = await createRunFolder(planDir, formatRunFolderTimestamp(now))
  const reportPath = join(folder, 'report.md')
  let ignoredByGit = false
  let gitChecked = options.isFolderWorkspace
  let queue: Promise<unknown> = Promise.resolve()

  const render = (run: TestRun, context: Omit<EvidenceReportContext, 'planName'>): string =>
    renderEvidenceReport(
      { ...run, evidence: { folder, reportPath, ignoredByGit } },
      { ...context, planName: options.planName }
    )

  const writeReportNow = async (
    run: TestRun,
    context: Omit<EvidenceReportContext, 'planName'>
  ): Promise<NonNullable<TestRun['evidence']>> => {
    await writeFileDurable(`${reportPath}.tmp`, reportPath, render(run, context))
    if (!gitChecked) {
      gitChecked = true
      ignoredByGit = await detectIgnoredByGit(root)
      if (ignoredByGit) {
        await writeFileDurable(`${reportPath}.tmp`, reportPath, render(run, context))
      }
    }
    return { folder, reportPath, ignoredByGit }
  }

  return {
    folder,
    reportPath,
    async writeImage(step, role, png) {
      const link = evidenceImageName(step, role)
      const target = join(folder, ...link.split('/'))
      await mkdir(dirname(target), { recursive: true })
      await writeFile(target, png)
      return link
    },
    writeReport(run, context) {
      // Why: serialize so overlapping step updates cannot race on the same temp file.
      const next = queue.then(() => writeReportNow(run, context))
      queue = next.catch(() => {})
      return next
    }
  }
}
