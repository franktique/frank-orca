export type RecordingFormat = 'gif' | 'mp4' | 'webm'

export const RECORDING_FORMATS: readonly RecordingFormat[] = ['gif', 'mp4', 'webm']

const VIDEO_MIME_CANDIDATES: Record<Exclude<RecordingFormat, 'gif'>, readonly string[]> = {
  mp4: ['video/mp4;codecs=avc1', 'video/mp4'],
  webm: ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']
}

const PREFERRED_FORMAT_KEY = 'orca.browserRecording.format'

/** The first MIME type MediaRecorder can encode for a video format, or null when it can't. */
export function resolveVideoMimeType(format: Exclude<RecordingFormat, 'gif'>): string | null {
  if (typeof MediaRecorder === 'undefined') {
    return null
  }
  return VIDEO_MIME_CANDIDATES[format].find((mime) => MediaRecorder.isTypeSupported(mime)) ?? null
}

export function isRecordingFormatSupported(format: RecordingFormat): boolean {
  return format === 'gif' || resolveVideoMimeType(format) !== null
}

function isRecordingFormat(value: unknown): value is RecordingFormat {
  return RECORDING_FORMATS.some((format) => format === value)
}

export function readPreferredRecordingFormat(): RecordingFormat {
  try {
    const stored = window.localStorage.getItem(PREFERRED_FORMAT_KEY)
    if (isRecordingFormat(stored) && isRecordingFormatSupported(stored)) {
      return stored
    }
  } catch {
    // Storage can be unavailable (private mode, blocked site data); fall back to GIF.
  }
  return 'gif'
}

export function writePreferredRecordingFormat(format: RecordingFormat): void {
  try {
    window.localStorage.setItem(PREFERRED_FORMAT_KEY, format)
  } catch {
    // Best effort: the choice just won't survive a restart.
  }
}
