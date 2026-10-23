import { randomUUID } from 'node:crypto'
import { pauseAnswerSchema } from '../../shared/test-orchestrator/test-orchestrator-schemas'
import type {
  PauseAnswer,
  RaisedPause
} from '../../shared/test-orchestrator/test-orchestrator-types'

export type RaisablePause = RaisedPause

export type PauseAnswerResult =
  | { ok: true }
  | { ok: false; code: 'no-pause' | 'pause-mismatch'; message: string }

type PendingPause = {
  request: RaisablePause
  resolve: (answer: PauseAnswer) => void
  reject: (error: Error) => void
}

type PauseInterval = { start: number; end: number | null }

export class TestRunPauses {
  private readonly pending = new Map<string, PendingPause>()
  private readonly intervals: PauseInterval[] = []

  constructor(private readonly now: () => number = Date.now) {}

  /** Waits with no timeout until answered; `onRaised` fires once the pauseId exists. */
  raise(request: RaisablePause, onRaised?: (pauseId: string) => void): Promise<PauseAnswer> {
    const pauseId = randomUUID()
    return new Promise<PauseAnswer>((resolve, reject) => {
      if (this.pending.size === 0) {
        this.intervals.push({ start: this.now(), end: null })
      }
      this.pending.set(pauseId, { request, resolve, reject })
      onRaised?.(pauseId)
    })
  }

  answer(pauseId: string, raw: unknown): PauseAnswerResult {
    const entry = this.pending.get(pauseId)
    if (!entry) {
      return { ok: false, code: 'no-pause', message: 'That pause is no longer waiting.' }
    }
    const parsed = pauseAnswerSchema.safeParse(raw)
    if (!parsed.success || parsed.data.kind !== entry.request.kind) {
      return {
        ok: false,
        code: 'pause-mismatch',
        message: `The answer does not match the ${entry.request.kind} pause.`
      }
    }
    this.settle(pauseId)
    entry.resolve(parsed.data)
    return { ok: true }
  }

  pendingPauseIds(): string[] {
    return [...this.pending.keys()]
  }

  /** Rejects every waiting pause, for example when the run is torn down. */
  abortAll(reason: Error): void {
    for (const [pauseId, entry] of this.pending) {
      this.settle(pauseId)
      entry.reject(reason)
    }
  }

  /** Total time spent paused (overlapping pauses count once). */
  pausedMs(): number {
    return this.pausedWithin(Number.NEGATIVE_INFINITY, this.now())
  }

  /** Paused time inside [startMs, endMs], so step durations can exclude pauses. */
  pausedWithin(startMs: number, endMs: number): number {
    const current = this.now()
    let total = 0
    for (const interval of this.intervals) {
      const overlap = Math.min(interval.end ?? current, endMs) - Math.max(interval.start, startMs)
      total += Math.max(0, overlap)
    }
    return total
  }

  private settle(pauseId: string): void {
    this.pending.delete(pauseId)
    if (this.pending.size === 0) {
      const open = this.intervals.at(-1)
      if (open && open.end === null) {
        open.end = this.now()
      }
    }
  }
}
