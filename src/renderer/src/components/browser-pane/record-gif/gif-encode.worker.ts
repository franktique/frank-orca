import { createGifEncoderSession } from './gif-encoder-session'
import type { GifEncodeWorkerRequest, GifEncodeWorkerResponse } from './gif-encode-worker-protocol'

// Why a worker: palette quantization costs tens of ms per frame and would stall the UI at 10 fps.
const session = createGifEncoderSession()
let failure: string | null = null

function respond(message: GifEncodeWorkerResponse, transfer: Transferable[] = []): void {
  self.postMessage(message, { transfer })
}

self.addEventListener('message', (event: MessageEvent<GifEncodeWorkerRequest>) => {
  const request = event.data
  if (request.type === 'frame') {
    if (failure) {
      return
    }
    try {
      session.addFrame(request)
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error)
    }
    return
  }
  if (failure) {
    respond({ type: 'error', message: failure })
    return
  }
  try {
    const bytes = session.finish()
    respond({ type: 'done', bytes }, [bytes.buffer])
  } catch (error) {
    respond({ type: 'error', message: error instanceof Error ? error.message : String(error) })
  }
})
