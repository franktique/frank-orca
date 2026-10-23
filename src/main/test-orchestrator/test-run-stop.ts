// Stop: aborts the active phase and wakes any waiting pause (FR-016).
import type { ActiveRun } from './test-run-orchestrator-types'

export function beginStop(entry: ActiveRun): void {
  if (entry.inCleanup) {
    entry.cleanupAbort.abort()
    entry.pauses.abortAll(new Error('Run stopped'))
    return
  }
  if (entry.abort.signal.aborted) {
    return
  }
  entry.abort.abort()
  entry.run.state = 'stopping'
  entry.pauses.abortAll(new Error('Run stopped'))
  entry.changed.notify(true)
}
