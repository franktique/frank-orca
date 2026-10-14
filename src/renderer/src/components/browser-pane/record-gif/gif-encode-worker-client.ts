import GifEncodeWorker from './gif-encode.worker?worker'
import type { GifEncodeWorkerRequest, GifEncodeWorkerResponse } from './gif-encode-worker-protocol'

export type GifEncodeWorkerClient = {
  addFrame: (frame: ImageData, atMs: number) => void
  finish: () => Promise<Uint8Array>
  dispose: () => void
}

export function createGifEncodeWorkerClient(): GifEncodeWorkerClient {
  const worker = new GifEncodeWorker()
  const post = (request: GifEncodeWorkerRequest, transfer: Transferable[] = []): void => {
    worker.postMessage(request, transfer)
  }
  return {
    addFrame: (frame, atMs) => {
      post({ type: 'frame', rgba: frame.data, width: frame.width, height: frame.height, atMs }, [
        frame.data.buffer
      ])
    },
    finish: () =>
      new Promise<Uint8Array>((resolve, reject) => {
        worker.addEventListener('message', (event: MessageEvent<GifEncodeWorkerResponse>) => {
          const response = event.data
          if (response.type === 'done') {
            resolve(response.bytes)
          } else {
            reject(new Error(response.message))
          }
        })
        worker.addEventListener('error', (event) => reject(new Error(event.message)))
        post({ type: 'finish' })
      }),
    dispose: () => worker.terminate()
  }
}
