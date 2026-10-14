import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createVideoRecordingSink } from './video-recording-sink'

class FakeMediaRecorder extends EventTarget {
  static instances: FakeMediaRecorder[] = []
  state: 'inactive' | 'recording' | 'paused' = 'inactive'
  readonly calls: string[] = []

  constructor(
    readonly stream: unknown,
    readonly options: { mimeType: string }
  ) {
    super()
    FakeMediaRecorder.instances.push(this)
  }

  start(): void {
    this.state = 'recording'
    this.calls.push('start')
  }

  pause(): void {
    this.state = 'paused'
    this.calls.push('pause')
  }

  resume(): void {
    this.state = 'recording'
    this.calls.push('resume')
  }

  stop(): void {
    this.state = 'inactive'
    this.calls.push('stop')
    this.emitData('tail')
    this.dispatchEvent(new Event('stop'))
  }

  emitData(text: string): void {
    const event = Object.assign(new Event('dataavailable'), { data: new Blob([text]) })
    this.dispatchEvent(event)
  }
}

function fakeContext() {
  const track = { requestFrame: vi.fn(), stop: vi.fn() }
  const canvas = { captureStream: vi.fn(() => ({ getVideoTracks: () => [track] })) }
  return {
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the sink only reads context.canvas.captureStream, which this stub provides.
    context: { canvas } as unknown as CanvasRenderingContext2D,
    track,
    canvas
  }
}

describe('createVideoRecordingSink', () => {
  beforeEach(() => {
    FakeMediaRecorder.instances = []
    vi.stubGlobal('MediaRecorder', FakeMediaRecorder)
  })
  afterEach(() => vi.unstubAllGlobals())

  it('starts one recorder on the first frame and pushes every frame', () => {
    const sink = createVideoRecordingSink('video/mp4')
    const { context, track, canvas } = fakeContext()

    sink.addFrame(context, 0)
    sink.addFrame(context, 100)

    expect(canvas.captureStream).toHaveBeenCalledWith(0)
    expect(FakeMediaRecorder.instances).toHaveLength(1)
    expect(FakeMediaRecorder.instances[0].options.mimeType).toBe('video/mp4')
    expect(track.requestFrame).toHaveBeenCalledTimes(2)
  })

  it('pauses and resumes the recorder and joins every chunk on finish', async () => {
    const sink = createVideoRecordingSink('video/webm')
    const { context, track } = fakeContext()
    sink.addFrame(context, 0)
    const recorder = FakeMediaRecorder.instances[0]
    recorder.emitData('head-')

    sink.pause()
    sink.resume()
    const bytes = await sink.finish()

    expect(recorder.calls).toEqual(['start', 'pause', 'resume', 'stop'])
    expect(new TextDecoder().decode(bytes)).toBe('head-tail')
    expect(track.stop).toHaveBeenCalled()
  })

  it('returns an empty file when no frame was recorded', async () => {
    const sink = createVideoRecordingSink('video/webm')
    expect((await sink.finish()).length).toBe(0)
  })
})
