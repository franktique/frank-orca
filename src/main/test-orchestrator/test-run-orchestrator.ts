// Run lifecycle and RunState machine: specs/003-e2e-test-orchestrator/data-model.md
import { randomUUID } from 'node:crypto'
import type { TestRun } from '../../shared/test-orchestrator/test-orchestrator-types'
import { TestRunPauses, type PauseAnswerResult } from './test-run-pauses'
import { runRunPhases } from './test-run-phase-runner'
import { beginStop } from './test-run-stop'
import { createChangedEmitter, summarizeRun } from './test-run-progress'
import type {
  ActiveRun,
  EvidenceSink,
  StartRunInput,
  StartRunResult,
  TestRunOrchestratorDeps
} from './test-run-orchestrator-types'

export type {
  CleanupExpander,
  EvidenceSink,
  StartRunInput,
  StartRunResult,
  TestRunOrchestratorDeps
} from './test-run-orchestrator-types'
export { summarizeRun } from './test-run-progress'

const CHANGED_THROTTLE_MS = 100

const keyOf = (worktreeId: string, collectionId: string): string =>
  `${worktreeId}\u0000${collectionId}`

export class TestRunOrchestrator {
  private readonly active = new Map<string, ActiveRun>()
  private readonly latest = new Map<string, TestRun>()
  private readonly now: () => number

  constructor(private readonly deps: TestRunOrchestratorDeps) {
    this.now = deps.now ?? Date.now
  }

  /** One active run per (worktree, collection); cleanup-only runs count too (FR-020). */
  start(input: StartRunInput): StartRunResult {
    const key = keyOf(input.worktreeId, input.collectionId)
    if (this.active.has(key)) {
      return { ok: false, code: 'busy', message: 'A test run is already active for this plan.' }
    }
    const run: TestRun = {
      id: randomUUID(),
      collectionId: input.collectionId,
      kind: input.kind ?? 'full',
      environmentId: input.environmentId,
      targetHosts: input.targetHosts,
      databaseMode: input.databaseMode,
      state: 'setup',
      ending: null,
      startedAt: this.now(),
      endedAt: null,
      pausedMs: 0,
      currentStepIndex: null,
      steps: [],
      pause: null,
      evidence: null,
      cleanup: { cleaned: 0, notCleaned: [], keptByUser: false }
    }
    const pauses = new TestRunPauses(this.now)
    const changed = createChangedEmitter({
      now: this.now,
      intervalMs: this.deps.changedThrottleMs ?? CHANGED_THROTTLE_MS,
      send: () => {
        run.pausedMs = pauses.pausedMs()
        this.deps.emit.changed({
          worktreeId: input.worktreeId,
          collectionId: input.collectionId,
          run: summarizeRun(run)
        })
      }
    })
    const entry: ActiveRun = {
      run,
      pauses,
      abort: new AbortController(),
      cleanupAbort: new AbortController(),
      changed,
      inCleanup: false
    }
    this.active.set(key, entry)
    this.latest.set(key, run)
    const finished = this.execute(input, entry).then(() => {
      this.active.delete(key)
      return run
    })
    return { ok: true, runId: run.id, finished }
  }

  /** Aborts the in-flight request; the run then asks Run cleanup or Keep data (US6). */
  stop(worktreeId: string, collectionId: string): { ok: boolean } {
    const entry = this.active.get(keyOf(worktreeId, collectionId))
    if (!entry) {
      return { ok: false }
    }
    beginStop(entry)
    return { ok: true }
  }

  getRun(worktreeId: string, collectionId: string): TestRun | null {
    return this.latest.get(keyOf(worktreeId, collectionId)) ?? null
  }

  activeRunId(worktreeId: string, collectionId: string): string | null {
    return this.active.get(keyOf(worktreeId, collectionId))?.run.id ?? null
  }

  answerPause(
    worktreeId: string,
    collectionId: string,
    pauseId: string,
    answer: unknown
  ): PauseAnswerResult {
    const entry = this.active.get(keyOf(worktreeId, collectionId))
    return (
      entry?.pauses.answer(pauseId, answer) ?? {
        ok: false,
        code: 'no-pause',
        message: 'That pause is no longer waiting.'
      }
    )
  }

  private async execute(input: StartRunInput, entry: ActiveRun): Promise<void> {
    let sink: EvidenceSink | null = null
    try {
      sink = (await this.deps.openEvidence?.(entry.run, input)) ?? null
    } catch {
      // Why: a run still has value without evidence files, so it proceeds and the report stays absent.
    }
    try {
      await runRunPhases(this.deps, input, entry, sink)
      await this.finalize(input.worktreeId, entry, sink)
    } finally {
      sink?.close?.()
    }
  }

  private async finalize(
    worktreeId: string,
    entry: ActiveRun,
    sink: EvidenceSink | null
  ): Promise<void> {
    const { run } = entry
    entry.changed.cancel()
    run.endedAt = this.now()
    run.pausedMs = entry.pauses.pausedMs()
    run.currentStepIndex = null
    run.pause = null
    run.state = 'finished'
    try {
      run.evidence = (await sink?.writeReport(run)) ?? run.evidence
    } catch {
      // Why: a failed report write must not block persisting the run or the finished event.
    }
    try {
      await this.deps.store.saveRun(worktreeId, run.collectionId, run)
    } catch {
      // Why: the in-memory run and events still reach the UI when the latest-run file cannot be written.
    }
    const summary = summarizeRun(run)
    this.deps.emit.changed({ worktreeId, collectionId: run.collectionId, run: summary })
    this.deps.emit.finished({
      worktreeId,
      collectionId: run.collectionId,
      run: summary,
      evidence: run.evidence ?? { folder: '', reportPath: '', ignoredByGit: false }
    })
  }
}
