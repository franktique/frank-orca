import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  isRecordingFormatSupported,
  readPreferredRecordingFormat,
  resolveVideoMimeType,
  writePreferredRecordingFormat
} from './recording-format'

function installEnvironment(supportedMimes: string[]): Map<string, string> {
  const storage = new Map<string, string>()
  vi.stubGlobal('MediaRecorder', {
    isTypeSupported: (mime: string) => supportedMimes.includes(mime)
  })
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value)
    }
  })
  return storage
}

describe('recording format support', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('picks the first MIME type the encoder supports', () => {
    installEnvironment(['video/webm;codecs=vp8', 'video/mp4'])
    expect(resolveVideoMimeType('webm')).toBe('video/webm;codecs=vp8')
    expect(resolveVideoMimeType('mp4')).toBe('video/mp4')
  })

  it('always supports GIF and reports missing video encoders', () => {
    installEnvironment([])
    expect(isRecordingFormatSupported('gif')).toBe(true)
    expect(isRecordingFormatSupported('mp4')).toBe(false)
  })
})

describe('preferred recording format', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('defaults to GIF and remembers the last choice', () => {
    installEnvironment(['video/mp4;codecs=avc1'])
    expect(readPreferredRecordingFormat()).toBe('gif')
    writePreferredRecordingFormat('mp4')
    expect(readPreferredRecordingFormat()).toBe('mp4')
  })

  it('falls back to GIF when the stored format is unknown or unsupported', () => {
    const storage = installEnvironment([])
    storage.set('orca.browserRecording.format', 'mp4')
    expect(readPreferredRecordingFormat()).toBe('gif')
    storage.set('orca.browserRecording.format', 'avi')
    expect(readPreferredRecordingFormat()).toBe('gif')
  })

  it('falls back to GIF when storage throws', () => {
    vi.stubGlobal('window', {
      localStorage: {
        getItem: () => {
          throw new Error('blocked')
        }
      }
    })
    expect(readPreferredRecordingFormat()).toBe('gif')
  })
})
