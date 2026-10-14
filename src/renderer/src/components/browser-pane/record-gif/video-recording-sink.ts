import type { RecordingSink } from './recording-sink'

const VIDEO_BITS_PER_SECOND = 4_000_000
const CHUNK_TIMESLICE_MS = 1000

/**
 * Encodes frames with MediaRecorder from a manual-frame canvas stream: each requestFrame() pushes
 * exactly the frame we captured, and recorder.pause() keeps paused time out of the file.
 */
export function createVideoRecordingSink(mimeType: string): RecordingSink {
  let recorder: MediaRecorder | null = null
  let track: MediaStreamTrack | null = null
  const chunks: Blob[] = []

  const stopTracks = (): void => {
    track?.stop()
  }

  return {
    addFrame: (context) => {
      if (!recorder) {
        // Why 0 fps: frames are pushed only on requestFrame(), so the video holds exactly our captures.
        const stream = context.canvas.captureStream(0)
        track = stream.getVideoTracks()[0] ?? null
        recorder = new MediaRecorder(stream, {
          mimeType,
          videoBitsPerSecond: VIDEO_BITS_PER_SECOND
        })
        recorder.addEventListener('dataavailable', (event) => {
          if (event.data.size > 0) {
            chunks.push(event.data)
          }
        })
        recorder.start(CHUNK_TIMESLICE_MS)
      }
      if (track && 'requestFrame' in track && typeof track.requestFrame === 'function') {
        track.requestFrame()
      }
    },
    pause: () => {
      if (recorder?.state === 'recording') {
        recorder.pause()
      }
    },
    resume: () => {
      if (recorder?.state === 'paused') {
        recorder.resume()
      }
    },
    finish: async () => {
      const active = recorder
      if (!active) {
        return new Uint8Array()
      }
      if (active.state !== 'inactive') {
        await new Promise<void>((resolve) => {
          active.addEventListener('stop', () => resolve(), { once: true })
          active.stop()
        })
      }
      stopTracks()
      const blob = new Blob(chunks, { type: mimeType })
      return new Uint8Array(await blob.arrayBuffer())
    },
    dispose: () => {
      if (recorder && recorder.state !== 'inactive') {
        recorder.stop()
      }
      stopTracks()
      chunks.length = 0
    }
  }
}
