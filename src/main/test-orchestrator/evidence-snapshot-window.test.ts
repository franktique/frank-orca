import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EvidenceSnapshotCard } from '../../shared/test-orchestrator/evidence-snapshot-card'

const FORBIDDEN_METHODS = [
  'show',
  'showInactive',
  'focus',
  'moveTop',
  'restore',
  'setAlwaysOnTop'
] as const

const { instances, ipcHandlers, ipcMainMock, BrowserWindowMock, replyFrom } = vi.hoisted(() => {
  const replyFrom: { sender: 'page' | 'foreign' } = { sender: 'page' }
  const created: FakeWindow[] = []
  const handlers = new Map<string, (event: { sender: unknown }, message: unknown) => void>()

  class FakeWindow {
    options: Electron.BrowserWindowConstructorOptions
    destroyed = false
    show = vi.fn()
    showInactive = vi.fn()
    focus = vi.fn()
    moveTop = vi.fn()
    restore = vi.fn()
    setAlwaysOnTop = vi.fn()
    setContentSize = vi.fn()
    loadFile = vi.fn(async () => undefined)
    loadURL = vi.fn(async () => undefined)
    isDestroyed = (): boolean => this.destroyed
    destroy = vi.fn(() => {
      this.destroyed = true
    })
    webContents = {
      setWindowOpenHandler: vi.fn(),
      on: vi.fn(),
      send: vi.fn((_channel: string, payload: { token: number }) => {
        // Simulate the page reporting after painting.
        queueMicrotask(() =>
          handlers.get('evidenceSnapshot:painted')?.(
            { sender: replyFrom.sender === 'page' ? this.webContents : {} },
            { token: payload.token, width: 900, height: 321 }
          )
        )
      }),
      capturePage: vi.fn(async () => ({ toPNG: () => Buffer.from('png') }))
    }
    constructor(options: Electron.BrowserWindowConstructorOptions) {
      this.options = options
      created.push(this)
    }
  }

  return {
    instances: created,
    ipcHandlers: handlers,
    ipcMainMock: {
      on: vi.fn((channel: string, handler: never) => handlers.set(channel, handler)),
      removeListener: vi.fn((channel: string) => handlers.delete(channel))
    },
    BrowserWindowMock: FakeWindow,
    replyFrom
  }
})

vi.mock('electron', () => ({
  app: { getAppPath: () => '/app' },
  BrowserWindow: BrowserWindowMock,
  ipcMain: ipcMainMock
}))
vi.mock('@electron-toolkit/utils', () => ({ is: { dev: false } }))

import { createEvidenceSnapshotWindow } from './evidence-snapshot-window'

const card: EvidenceSnapshotCard = {
  kind: 'request',
  title: 'SC-1',
  resolvedRequest: { method: 'GET', url: 'https://qa.example.com/a', headers: [], body: null },
  outcome: { kind: 'error', code: 'network', message: 'boom' },
  durationMs: 12
}

describe('createEvidenceSnapshotWindow', () => {
  beforeEach(() => {
    instances.length = 0
    ipcHandlers.clear()
  })

  it('creates a hidden, offscreen, sandboxed window', async () => {
    const snapshot = createEvidenceSnapshotWindow()
    await snapshot.render(card)
    const { options } = instances[0]
    expect(options.show).toBe(false)
    expect(options.webPreferences).toMatchObject({
      offscreen: true,
      sandbox: true,
      webviewTag: false
    })
    expect(options.webPreferences?.partition).not.toMatch(/^persist:/)
    expect(options.webPreferences?.preload).toBe(
      join('/app', 'out', 'main', 'evidence-snapshot-preload.js')
    )
    snapshot.destroy()
  })

  it('returns the captured PNG sized to the painted card', async () => {
    const snapshot = createEvidenceSnapshotWindow()
    const png = await snapshot.render(card)
    expect(png.toString()).toBe('png')
    expect(instances[0].setContentSize).toHaveBeenCalledWith(900, 321)
    expect(instances[0].webContents.capturePage).toHaveBeenCalledWith({
      x: 0,
      y: 0,
      width: 900,
      height: 321
    })
    snapshot.destroy()
  })

  it('never shows, focuses, or raises the window across render and destroy', async () => {
    const snapshot = createEvidenceSnapshotWindow()
    await snapshot.render(card)
    await snapshot.render(card)
    snapshot.destroy()
    expect(instances).toHaveLength(1)
    for (const method of FORBIDDEN_METHODS) {
      expect(instances[0][method]).not.toHaveBeenCalled()
    }
    expect(instances[0].destroy).toHaveBeenCalledTimes(1)
  })

  it('ignores painted reports from other senders', async () => {
    vi.useFakeTimers()
    replyFrom.sender = 'foreign'
    const snapshot = createEvidenceSnapshotWindow()
    const rejection = expect(snapshot.render(card)).rejects.toThrow('did not paint')
    await vi.advanceTimersByTimeAsync(11_000)
    await rejection
    snapshot.destroy()
    replyFrom.sender = 'page'
    vi.useRealTimers()
  })

  it('rejects renders after destroy', async () => {
    const snapshot = createEvidenceSnapshotWindow()
    snapshot.destroy()
    await expect(snapshot.render(card)).rejects.toThrow('destroyed')
  })
})
