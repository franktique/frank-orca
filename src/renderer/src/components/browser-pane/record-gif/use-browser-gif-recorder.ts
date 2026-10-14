import { useCallback, useEffect, useRef, useState } from 'react'
import type { MarkupCaptureSource } from '../annotate/markup-base-image'
import { createGifEncodeWorkerClient, type GifEncodeWorkerClient } from './gif-encode-worker-client'
import { createGifFrameCapturer, type GifFrameCapturer } from './gif-frame-capture'
import { createGifRecordingClock, type GifRecordingClock } from './gif-recording-clock'
import { saveGifRecording } from './gif-recording-save'

export type GifRecorderStatus = 'idle' | 'recording' | 'paused' | 'saving'

const FRAME_INTERVAL_MS = 100
const ELAPSED_TICK_MS = 250
// Why: a cap keeps the encoded GIF (and the worker's memory) bounded if a recording is forgotten.
export const MAX_GIF_RECORDING_MS = 3 * 60 * 1000

type RecordingSession = {
  clock: GifRecordingClock
  capturer: GifFrameCapturer
  encoder: GifEncodeWorkerClient
  captureInFlight: boolean
  frameCount: number
}

export type BrowserGifRecorder = {
  status: GifRecorderStatus
  elapsedMs: number
  frameCount: number
  start: () => void
  pause: () => void
  resume: () => void
  stop: () => Promise<void>
}

export function useBrowserGifRecorder(
  getSource: () => MarkupCaptureSource | null
): BrowserGifRecorder {
  const [status, setStatus] = useState<GifRecorderStatus>('idle')
  const [elapsedMs, setElapsedMs] = useState(0)
  const [frameCount, setFrameCount] = useState(0)
  const sessionRef = useRef<RecordingSession | null>(null)
  const getSourceRef = useRef(getSource)
  getSourceRef.current = getSource

  const captureFrame = useCallback(async (session: RecordingSession): Promise<void> => {
    const source = getSourceRef.current()
    if (session.captureInFlight || !source) {
      return
    }
    session.captureInFlight = true
    const atMs = session.clock.elapsed(performance.now())
    try {
      const frame = await session.capturer.capture(source)
      if (frame && sessionRef.current === session) {
        session.encoder.addFrame(frame, atMs)
        session.frameCount += 1
      }
    } catch {
      // A hidden or reloading guest can fail one capture; the next tick retries.
    } finally {
      session.captureInFlight = false
    }
  }, [])

  const start = useCallback((): void => {
    if (sessionRef.current || !getSourceRef.current()) {
      return
    }
    sessionRef.current = {
      clock: createGifRecordingClock(performance.now()),
      capturer: createGifFrameCapturer(),
      encoder: createGifEncodeWorkerClient(),
      captureInFlight: false,
      frameCount: 0
    }
    setElapsedMs(0)
    setFrameCount(0)
    setStatus('recording')
  }, [])

  const pause = useCallback((): void => {
    const session = sessionRef.current
    if (!session || status !== 'recording') {
      return
    }
    session.clock.pause(performance.now())
    setElapsedMs(session.clock.elapsed(performance.now()))
    setStatus('paused')
  }, [status])

  const resume = useCallback((): void => {
    const session = sessionRef.current
    if (!session || status !== 'paused') {
      return
    }
    session.clock.resume(performance.now())
    setStatus('recording')
  }, [status])

  const stop = useCallback(async (): Promise<void> => {
    const session = sessionRef.current
    if (!session) {
      return
    }
    sessionRef.current = null
    setStatus('saving')
    try {
      if (session.frameCount > 0) {
        await saveGifRecording(() => session.encoder.finish())
      }
    } finally {
      session.encoder.dispose()
      setElapsedMs(0)
      setFrameCount(0)
      setStatus('idle')
    }
  }, [])

  const stopRef = useRef(stop)
  stopRef.current = stop

  // Why: timers run only while recording, so pausing freezes both capture and the elapsed counter.
  useEffect(() => {
    const session = sessionRef.current
    if (status !== 'recording' || !session) {
      return
    }
    void captureFrame(session)
    const frameTimer = setInterval(() => void captureFrame(session), FRAME_INTERVAL_MS)
    const elapsedTimer = setInterval(() => {
      const elapsed = session.clock.elapsed(performance.now())
      setElapsedMs(elapsed)
      setFrameCount(session.frameCount)
      if (elapsed >= MAX_GIF_RECORDING_MS) {
        void stopRef.current()
      }
    }, ELAPSED_TICK_MS)
    return () => {
      clearInterval(frameTimer)
      clearInterval(elapsedTimer)
    }
  }, [status, captureFrame])

  // Why: an unmounted pane can't show the save outcome, so its recording is dropped.
  useEffect(
    () => () => {
      sessionRef.current?.encoder.dispose()
      sessionRef.current = null
    },
    []
  )

  return { status, elapsedMs, frameCount, start, pause, resume, stop }
}
