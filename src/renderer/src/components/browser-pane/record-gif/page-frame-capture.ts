import type { MarkupCaptureSource } from '../annotate/markup-base-image'

type DrawableFrame = { image: CanvasImageSource; width: number; height: number }

export type PageFrameCapturer = {
  /**
   * Draws the page opaquely onto one canvas whose size the first capture fixes, and returns its
   * context; null skips the tick.
   */
  capture: (source: MarkupCaptureSource) => Promise<CanvasRenderingContext2D | null>
}

export function createPageFrameCapturer(maxFrameEdge: number): PageFrameCapturer {
  let context: CanvasRenderingContext2D | null = null
  return {
    capture: async (source) => {
      const frame = await readDrawableFrame(source, maxFrameEdge)
      if (!frame) {
        return null
      }
      // Why: a GIF has one canvas size, so the first frame fixes it and later frames
      // (after a pane resize) are letterboxed into it.
      if (!context) {
        context = createFrameContext(fitWithin(frame.width, frame.height, maxFrameEdge))
      }
      const { width, height } = context.canvas
      const scale = Math.min(width / frame.width, height / frame.height)
      const drawWidth = Math.round(frame.width * scale)
      const drawHeight = Math.round(frame.height * scale)
      context.fillStyle = '#ffffff'
      context.fillRect(0, 0, width, height)
      context.drawImage(
        frame.image,
        Math.floor((width - drawWidth) / 2),
        Math.floor((height - drawHeight) / 2),
        drawWidth,
        drawHeight
      )
      return context
    }
  }
}

function createFrameContext(size: { width: number; height: number }): CanvasRenderingContext2D {
  const canvas = document.createElement('canvas')
  canvas.width = size.width
  canvas.height = size.height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) {
    throw new Error('gif: 2d context unavailable')
  }
  return context
}

export function fitWithin(
  width: number,
  height: number,
  maxEdge: number
): { width: number; height: number } {
  const scale = Math.min(1, maxEdge / Math.max(width, height))
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale))
  }
}

async function readDrawableFrame(
  source: MarkupCaptureSource,
  maxFrameEdge: number
): Promise<DrawableFrame | null> {
  if (source.kind === 'image') {
    const element = source.element
    const width = element.naturalWidth || element.width
    const height = element.naturalHeight || element.height
    if (!element.complete || !element.isConnected || width <= 0 || height <= 0) {
      return null
    }
    return { image: element, width, height }
  }
  const native = await source.webview.capturePage()
  if (native.isEmpty()) {
    return null
  }
  const full = native.getSize()
  const target = fitWithin(full.width, full.height, maxFrameEdge)
  // Why: downscale natively before copying pixels; a retina capture is ~4x the bytes we keep.
  const scaled = target.width < full.width ? native.resize(target) : native
  // Why toDataURL, not toBitmap(): toBitmap() crashes the sandboxed renderer (seen in e2e).
  const image = new Image()
  image.src = scaled.toDataURL()
  await image.decode()
  return { image, width: image.naturalWidth, height: image.naturalHeight }
}
