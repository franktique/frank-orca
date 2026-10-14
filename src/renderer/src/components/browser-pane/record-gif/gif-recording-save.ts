import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'

const SAVE_CHUNK_BYTES = 1024 * 1024

export function gifRecordingFileName(now: Date): string {
  const stamp = now.toISOString().slice(0, 19).replace(/[:T]/g, '-')
  return `orca-recording-${stamp}.gif`
}

/**
 * Asks where to save first, then streams the encoded GIF in chunks so a long recording never
 * crosses IPC as one giant string. Cancelling the dialog discards the recording.
 */
export async function saveGifRecording(encode: () => Promise<Uint8Array>): Promise<void> {
  const fs = window.api.fs
  let target: Awaited<ReturnType<typeof fs.startDownloadedFile>>
  try {
    target = await fs.startDownloadedFile({ suggestedName: gifRecordingFileName(new Date()) })
  } catch (error) {
    toastSaveFailure(error)
    return
  }
  if (target.canceled) {
    toast(translate('auto.components.browser-pane.recordGif.discarded', 'GIF recording discarded'))
    return
  }
  try {
    const bytes = await encode()
    for (let offset = 0; offset < bytes.length; offset += SAVE_CHUNK_BYTES) {
      const chunk = bytes.subarray(offset, offset + SAVE_CHUNK_BYTES)
      await fs.appendDownloadedFileChunk({
        transferId: target.transferId,
        contentBase64: bytesToBase64(chunk)
      })
    }
    const result = await fs.finishDownloadedFile({ transferId: target.transferId })
    toast.success(
      translate('auto.components.browser-pane.recordGif.saved', 'GIF saved to {{value0}}', {
        value0: result.destinationPath
      })
    )
  } catch (error) {
    await fs.cancelDownloadedFile({ transferId: target.transferId }).catch(() => undefined)
    toastSaveFailure(error)
  }
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  // Why: spreading a whole chunk into fromCharCode overflows the call stack; go in slices.
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  }
  return btoa(binary)
}

function toastSaveFailure(error: unknown): void {
  toast.error(
    translate('auto.components.browser-pane.recordGif.saveFailed', 'Could not save the GIF'),
    { description: error instanceof Error ? error.message : String(error) }
  )
}
