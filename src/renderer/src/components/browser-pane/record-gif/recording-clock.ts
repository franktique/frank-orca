/** Recorded time that excludes pauses, so the timer and frame delays match what the GIF plays back. */
export type RecordingClock = {
  pause: (now: number) => void
  resume: (now: number) => void
  elapsed: (now: number) => number
}

export function createRecordingClock(startedAt: number): RecordingClock {
  let accumulatedMs = 0
  let runningSince: number | null = startedAt
  return {
    pause: (now) => {
      if (runningSince === null) {
        return
      }
      accumulatedMs += Math.max(0, now - runningSince)
      runningSince = null
    },
    resume: (now) => {
      if (runningSince === null) {
        runningSince = now
      }
    },
    elapsed: (now) => accumulatedMs + (runningSince === null ? 0 : Math.max(0, now - runningSince))
  }
}

export function formatRecordingElapsed(elapsedMs: number): string {
  const totalSeconds = Math.floor(Math.max(0, elapsedMs) / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}
