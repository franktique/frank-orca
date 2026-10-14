import { applyPalette, GIFEncoder, quantize } from 'gifenc'

export type GifFrameInput = {
  rgba: Uint8ClampedArray
  width: number
  height: number
  /** Recorded time (pauses excluded) at which this frame was captured. */
  atMs: number
}

const LAST_FRAME_DELAY_MS = 100
// Why: most GIF players clamp delays under 20ms up to ~100ms, which would slow playback down.
const MIN_FRAME_DELAY_MS = 20

/**
 * Encodes frames as they arrive so memory holds compressed GIF bytes, not raw RGBA.
 * A frame is written once the next one arrives because its delay is only known then;
 * an unchanged frame is dropped so the previous one simply stays on screen longer.
 */
export function createGifEncoderSession(): {
  addFrame: (frame: GifFrameInput) => void
  finish: () => Uint8Array
  frameCount: () => number
} {
  const encoder = GIFEncoder()
  let pending: GifFrameInput | null = null
  let written = 0

  const write = (frame: GifFrameInput, delay: number): void => {
    const palette = quantize(frame.rgba, 256)
    const index = applyPalette(frame.rgba, palette)
    encoder.writeFrame(index, frame.width, frame.height, {
      palette,
      delay: Math.max(MIN_FRAME_DELAY_MS, Math.round(delay)),
      repeat: 0
    })
    written += 1
  }

  return {
    addFrame: (frame) => {
      if (pending) {
        if (isSameFrame(pending, frame)) {
          return
        }
        write(pending, frame.atMs - pending.atMs)
      }
      pending = frame
    },
    finish: () => {
      if (pending) {
        write(pending, LAST_FRAME_DELAY_MS)
        pending = null
      }
      encoder.finish()
      return encoder.bytes()
    },
    frameCount: () => written + (pending ? 1 : 0)
  }
}

function isSameFrame(a: GifFrameInput, b: GifFrameInput): boolean {
  if (a.width !== b.width || a.height !== b.height || a.rgba.length !== b.rgba.length) {
    return false
  }
  const left = new Uint32Array(a.rgba.buffer, a.rgba.byteOffset, a.rgba.length >> 2)
  const right = new Uint32Array(b.rgba.buffer, b.rgba.byteOffset, b.rgba.length >> 2)
  for (let i = 0; i < left.length; i += 1) {
    if (left[i] !== right[i]) {
      return false
    }
  }
  return true
}
