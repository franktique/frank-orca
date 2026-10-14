import { describe, expect, it } from 'vitest'
import { createGifRecordingClock, formatGifRecordingElapsed } from './gif-recording-clock'

describe('createGifRecordingClock', () => {
  it('excludes paused time from elapsed', () => {
    const clock = createGifRecordingClock(1000)
    expect(clock.elapsed(4000)).toBe(3000)
    clock.pause(4000)
    expect(clock.elapsed(9000)).toBe(3000)
    clock.resume(9000)
    expect(clock.elapsed(11_500)).toBe(5500)
  })

  it('ignores repeated pause and resume calls', () => {
    const clock = createGifRecordingClock(0)
    clock.pause(1000)
    clock.pause(2000)
    clock.resume(3000)
    clock.resume(4000)
    expect(clock.elapsed(5000)).toBe(3000)
  })
})

describe('formatGifRecordingElapsed', () => {
  it('formats whole seconds as m:ss', () => {
    expect(formatGifRecordingElapsed(0)).toBe('0:00')
    expect(formatGifRecordingElapsed(7999)).toBe('0:07')
    expect(formatGifRecordingElapsed(83_000)).toBe('1:23')
    expect(formatGifRecordingElapsed(180_000)).toBe('3:00')
  })
})
