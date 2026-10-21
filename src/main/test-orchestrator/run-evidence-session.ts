// Per-run evidence plumbing: folder writer + hidden snapshot window behind one EvidenceSink (T054).
import type { TestRun } from '../../shared/test-orchestrator/test-orchestrator-types'
import type { EvidenceSnapshotWindow } from './evidence-snapshot-window'
import { createEvidenceWriter, type EvidenceWriter } from './evidence-writer'
import type { EvidenceSink } from './test-run-orchestrator-types'

export type RunEvidenceSessionOptions = {
  worktreeId: string
  planName: string
  isFolderWorkspace: boolean
  orcaVersion: string
  guideLink?: { text: string; href: string }
  /** Injected in tests; defaults to the real hidden window and writer. */
  createWriter?: typeof createEvidenceWriter
  createSnapshotWindow?: () => Pick<EvidenceSnapshotWindow, 'render' | 'destroy'>
}

/** Returns the `openEvidence` dep: each call makes a fresh run folder and snapshot window. */
export function createRunEvidenceSession(
  options: RunEvidenceSessionOptions
): (run: TestRun) => Promise<EvidenceSink> {
  return async () => {
    const writer: EvidenceWriter = await (options.createWriter ?? createEvidenceWriter)({
      worktreeId: options.worktreeId,
      planName: options.planName,
      isFolderWorkspace: options.isFolderWorkspace
    })
    // Why: lazy import keeps electron out of non-Electron test and CLI loads.
    const snapshotWindow = options.createSnapshotWindow
      ? options.createSnapshotWindow()
      : (await import('./evidence-snapshot-window')).createEvidenceSnapshotWindow()
    return {
      writeReport: (run) =>
        writer.writeReport(run, {
          orcaVersion: options.orcaVersion,
          utcOffsetMinutes: -new Date(run.startedAt).getTimezoneOffset(),
          guideLink: options.guideLink
        }),
      capture: {
        renderer: { render: (card) => snapshotWindow.render(card) },
        writeImage: (order, stepId, role, png) => writer.writeImage(order, stepId, role, png)
      },
      close: () => snapshotWindow.destroy()
    }
  }
}
