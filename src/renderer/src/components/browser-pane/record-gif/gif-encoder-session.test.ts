import { describe, expect, it } from 'vitest'
import { createGifEncoderSession } from './gif-encoder-session'

function solidFrame(
  width: number,
  height: number,
  rgb: [number, number, number]
): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < rgba.length; i += 4) {
    rgba.set([...rgb, 255], i)
  }
  return rgba
}

function countFrames(bytes: Uint8Array): number {
  // Each frame starts with a graphic control extension (0x21 0xF9) in gifenc's output.
  let count = 0
  for (let i = 0; i < bytes.length - 1; i += 1) {
    if (bytes[i] === 0x21 && bytes[i + 1] === 0xf9) {
      count += 1
    }
  }
  return count
}

function frameDelays(bytes: Uint8Array): number[] {
  const delays: number[] = []
  for (let i = 0; i < bytes.length - 5; i += 1) {
    if (bytes[i] === 0x21 && bytes[i + 1] === 0xf9 && bytes[i + 2] === 0x04) {
      delays.push((bytes[i + 4] | (bytes[i + 5] << 8)) * 10)
    }
  }
  return delays
}

describe('createGifEncoderSession', () => {
  it('writes a looping GIF with one frame per distinct capture', () => {
    const session = createGifEncoderSession()
    session.addFrame({ rgba: solidFrame(4, 3, [255, 0, 0]), width: 4, height: 3, atMs: 0 })
    session.addFrame({ rgba: solidFrame(4, 3, [0, 0, 255]), width: 4, height: 3, atMs: 200 })
    const bytes = session.finish()

    expect(new TextDecoder().decode(bytes.subarray(0, 6))).toBe('GIF89a')
    expect(bytes[6] | (bytes[7] << 8)).toBe(4)
    expect(bytes[8] | (bytes[9] << 8)).toBe(3)
    expect(countFrames(bytes)).toBe(2)
    expect(bytes.at(-1)).toBe(0x3b)
  })

  it('folds an unchanged frame into the previous frame delay', () => {
    const session = createGifEncoderSession()
    session.addFrame({ rgba: solidFrame(2, 2, [255, 0, 0]), width: 2, height: 2, atMs: 0 })
    session.addFrame({ rgba: solidFrame(2, 2, [255, 0, 0]), width: 2, height: 2, atMs: 100 })
    session.addFrame({ rgba: solidFrame(2, 2, [0, 255, 0]), width: 2, height: 2, atMs: 500 })
    expect(session.frameCount()).toBe(2)

    expect(frameDelays(session.finish())).toEqual([500, 100])
  })
})
