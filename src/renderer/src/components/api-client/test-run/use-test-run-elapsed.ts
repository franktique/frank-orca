import { useEffect, useRef, useState } from 'react'
import type { TestRunSummary } from '../../../../../shared/test-orchestrator/test-orchestrator-types'

const TICK_MS = 1000

/** Elapsed run time without pauses; frozen while the run waits for the user (FR-006d). */
export function useTestRunElapsed(run: TestRunSummary): number {
  const [now, setNow] = useState(() => Date.now())
  const frozenRef = useRef(0)
  const live = run.endedAt === null && run.state !== 'paused'

  useEffect(() => {
    if (!live) {
      return
    }
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), TICK_MS)
    return () => clearInterval(timer)
  }, [live])

  if (run.endedAt !== null) {
    return Math.max(0, run.endedAt - run.startedAt - run.pausedMs)
  }
  if (run.state === 'paused') {
    return frozenRef.current
  }
  frozenRef.current = Math.max(0, now - run.startedAt - run.pausedMs)
  return frozenRef.current
}
