import { createGifEncodeWorkerClient } from './gif-encode-worker-client'
import { resolveVideoMimeType, type RecordingFormat } from './recording-format'
import { createVideoRecordingSink } from './video-recording-sink'

/** Where captured frames go; each output format encodes them its own way. */
export type RecordingSink = {
  addFrame: (context: CanvasRenderingContext2D, atMs: number) => void
  pause: () => void
  resume: () => void
  /** The encoded file; empty when no frame was ever added. */
  finish: () => Promise<Uint8Array>
  dispose: () => void
}

export function createRecordingSink(format: RecordingFormat): RecordingSink {
  if (format === 'gif') {
    return createGifRecordingSink()
  }
  const mimeType = resolveVideoMimeType(format)
  if (!mimeType) {
    throw new Error(`${format} recording is not supported on this system`)
  }
  return createVideoRecordingSink(mimeType)
}

function createGifRecordingSink(): RecordingSink {
  const encoder = createGifEncodeWorkerClient()
  return {
    addFrame: (context, atMs) => {
      const { width, height } = context.canvas
      encoder.addFrame(context.getImageData(0, 0, width, height), atMs)
    },
    // Frame delays come from pause-excluded timestamps, so the encoder needs no pause signal.
    pause: () => undefined,
    resume: () => undefined,
    finish: encoder.finish,
    dispose: encoder.dispose
  }
}
