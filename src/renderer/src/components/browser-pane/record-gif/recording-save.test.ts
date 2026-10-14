import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const toastMock = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }))
vi.mock('sonner', () => ({ toast: toastMock }))

import { bytesToBase64, recordingFileName, saveRecording } from './recording-save'

function installFsApi(startResult: unknown) {
  const fs = {
    startDownloadedFile: vi.fn().mockResolvedValue(startResult),
    appendDownloadedFileChunk: vi.fn().mockResolvedValue({ ok: true }),
    finishDownloadedFile: vi
      .fn()
      .mockResolvedValue({ canceled: false, destinationPath: '/tmp/a.gif' }),
    cancelDownloadedFile: vi.fn().mockResolvedValue({ ok: true })
  }
  vi.stubGlobal('window', { api: { fs } })
  return fs
}

describe('saveRecording', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => vi.unstubAllGlobals())

  it('asks for a destination, streams the bytes, and confirms the saved path', async () => {
    const fs = installFsApi({ canceled: false, transferId: 't1', destinationPath: '/tmp/a.gif' })
    const encode = vi.fn().mockResolvedValue(new Uint8Array([71, 73, 70]))

    await saveRecording('gif', encode)

    expect(fs.startDownloadedFile).toHaveBeenCalledWith({
      suggestedName: expect.stringMatching(/^orca-recording-.*\.gif$/)
    })
    expect(fs.appendDownloadedFileChunk).toHaveBeenCalledWith({
      transferId: 't1',
      contentBase64: 'R0lG'
    })
    expect(fs.finishDownloadedFile).toHaveBeenCalledWith({ transferId: 't1' })
    expect(toastMock.success).toHaveBeenCalledOnce()
  })

  it('discards the recording without encoding when the dialog is cancelled', async () => {
    const fs = installFsApi({ canceled: true })
    const encode = vi.fn()

    await saveRecording('gif', encode)

    expect(encode).not.toHaveBeenCalled()
    expect(fs.appendDownloadedFileChunk).not.toHaveBeenCalled()
    expect(toastMock).toHaveBeenCalledOnce()
  })

  it('cancels the transfer and reports when encoding fails', async () => {
    const fs = installFsApi({ canceled: false, transferId: 't2', destinationPath: '/tmp/b.gif' })

    await saveRecording('gif', () => Promise.reject(new Error('boom')))

    expect(fs.cancelDownloadedFile).toHaveBeenCalledWith({ transferId: 't2' })
    expect(fs.finishDownloadedFile).not.toHaveBeenCalled()
    expect(toastMock.error).toHaveBeenCalledOnce()
  })
})

describe('gif recording file helpers', () => {
  it('names the file with a filesystem-safe timestamp', () => {
    const now = new Date('2026-10-13T09:08:07.123Z')
    expect(recordingFileName(now, 'gif')).toBe('orca-recording-2026-10-13-09-08-07.gif')
    expect(recordingFileName(now, 'mp4')).toBe('orca-recording-2026-10-13-09-08-07.mp4')
    expect(recordingFileName(now, 'webm')).toBe('orca-recording-2026-10-13-09-08-07.webm')
  })

  it('base64-encodes chunks larger than one fromCharCode slice', () => {
    const bytes = new Uint8Array(0x8000 * 2 + 3).map((_, i) => i % 256)
    expect(bytesToBase64(bytes)).toBe(Buffer.from(bytes).toString('base64'))
  })
})
