import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import type { MarkupCaptureSource } from '../annotate/markup-base-image'
import { createRecordingClock, type RecordingClock } from './recording-clock'
import { createPageFrameCapturer, type PageFrameCapturer } from './page-frame-capture'
import type { RecordingFormat } from './recording-format'
import { saveRecording } from './recording-save'
import { createRecordingSink, type RecordingSink } from './recording-sink'

export type PageRecorderStatus = 'idle' | 'recording' | 'paused' | 'saving'

// Why per format: GIF size grows with every pixel and frame; video codecs keep both cheap, but each
// frame is still PNG-encoded on the main thread, which bounds video size and rate (1920px stalled the UI).
const CAPTURE_PROFILE: Record<RecordingFormat, { frameIntervalMs: number; maxFrameEdge: number }> =
  {
    gif: { frameIntervalMs: 100, maxFrameEdge: 960 },
    mp4: { frameIntervalMs: 83, maxFrameEdge: 1280 },
    webm: { frameIntervalMs: 83, maxFrameEdge: 1280 }
  }
const ELAPSED_TICK_MS = 250
// Why: a cap keeps the encoded file (and the encoder's memory) bounded if a recording is forgotten.
export const MAX_PAGE_RECORDING_MS = 3 * 60 * 1000

type RecordingSession = {
  format: RecordingFormat
  clock: RecordingClock
  capturer: PageFrameCapturer
  sink: RecordingSink
  captureInFlight: boolean
  frameCount: number
}

export type BrowserPageRecorder = {
  status: PageRecorderStatus
  /** Format of the recording in progress; null while idle. */
  format: RecordingFormat | null
  elapsedMs: number
  frameCount: number
  start: (format: RecordingFormat) => void
  pause: () => void
  resume: () => void
  stop: () => Promise<void>
}

export function useBrowserPageRecorder(
  getSource: () => MarkupCaptureSource | null
): BrowserPageRecorder {
  const [status, setStatus] = useState<PageRecorderStatus>('idle')
  const [format, setFormat] = useState<RecordingFormat | null>(null)
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
      const context = await session.capturer.capture(source)
      if (context && sessionRef.current === session) {
        session.sink.addFrame(context, atMs)
        session.frameCount += 1
      }
    } catch {
      // A hidden or reloading guest can fail one capture; the next tick retries.
    } finally {
      session.captureInFlight = false
    }
  }, [])

  const start = useCallback((nextFormat: RecordingFormat): void => {
    if (sessionRef.current || !getSourceRef.current()) {
      return
    }
    let sink: RecordingSink
    try {
      sink = createRecordingSink(nextFormat)
    } catch (error) {
      toast.error(
        translate(
          'auto.components.browser-pane.recording.startFailed',
          'Could not start recording'
        ),
        { description: error instanceof Error ? error.message : String(error) }
      )
      return
    }
    sessionRef.current = {
      format: nextFormat,
      clock: createRecordingClock(performance.now()),
      capturer: createPageFrameCapturer(CAPTURE_PROFILE[nextFormat].maxFrameEdge),
      sink,
      captureInFlight: false,
      frameCount: 0
    }
    setFormat(nextFormat)
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
    session.sink.pause()
    setElapsedMs(session.clock.elapsed(performance.now()))
    setStatus('paused')
  }, [status])

  const resume = useCallback((): void => {
    const session = sessionRef.current
    if (!session || status !== 'paused') {
      return
    }
    session.clock.resume(performance.now())
    session.sink.resume()
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
        await saveRecording(session.format, () => session.sink.finish())
      }
    } finally {
      session.sink.dispose()
      setFormat(null)
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
    const frameTimer = setInterval(
      () => void captureFrame(session),
      CAPTURE_PROFILE[session.format].frameIntervalMs
    )
    const elapsedTimer = setInterval(() => {
      const elapsed = session.clock.elapsed(performance.now())
      setElapsedMs(elapsed)
      setFrameCount(session.frameCount)
      if (elapsed >= MAX_PAGE_RECORDING_MS) {
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
      sessionRef.current?.sink.dispose()
      sessionRef.current = null
    },
    []
  )

  return { status, format, elapsedMs, frameCount, start, pause, resume, stop }
}
