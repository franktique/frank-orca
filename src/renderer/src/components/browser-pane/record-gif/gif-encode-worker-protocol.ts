export type GifEncodeWorkerRequest =
  | { type: 'frame'; rgba: Uint8ClampedArray; width: number; height: number; atMs: number }
  | { type: 'finish' }

export type GifEncodeWorkerResponse =
  | { type: 'done'; bytes: Uint8Array }
  | { type: 'error'; message: string }
