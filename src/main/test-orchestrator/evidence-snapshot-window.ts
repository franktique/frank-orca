import { app, BrowserWindow, ipcMain } from 'electron'
import { join } from 'node:path'
import { is } from '@electron-toolkit/utils'
import {
  EVIDENCE_SNAPSHOT_PAINTED_CHANNEL,
  EVIDENCE_SNAPSHOT_RENDER_CHANNEL,
  EVIDENCE_SNAPSHOT_WIDTH,
  type EvidenceSnapshotCard,
  type EvidenceSnapshotPaintedMessage
} from '../../shared/test-orchestrator/evidence-snapshot-card'

const PAINT_TIMEOUT_MS = 10_000
const RESEND_INTERVAL_MS = 250
const MAX_CARD_HEIGHT = 8_000
const CAPTURE_ATTEMPTS = 5
const CAPTURE_RETRY_MS = 100
const INITIAL_HEIGHT = 800
// Why: no "persist:" prefix keeps the session in memory, so nothing touches disk.
const SNAPSHOT_PARTITION = 'orca-evidence-snapshot'

// Why: this module is a lazily imported chunk, so `__dirname` is `out/main/chunks`, not `out/main`.
const outPath = (...segments: string[]): string => join(app.getAppPath(), 'out', ...segments)

export type EvidenceSnapshotWindow = {
  render: (card: EvidenceSnapshotCard) => Promise<Buffer>
  destroy: () => void
}

function isPaintedMessage(value: unknown): value is EvidenceSnapshotPaintedMessage {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  return (
    'token' in value &&
    typeof value.token === 'number' &&
    'width' in value &&
    typeof value.width === 'number' &&
    'height' in value &&
    typeof value.height === 'number'
  )
}

function loadSnapshotPage(window: BrowserWindow): Promise<void> {
  // Why: mirror the popout's dev/prod branch for the second HTML entry.
  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    return window.loadURL(`${process.env.ELECTRON_RENDERER_URL}/evidence-snapshot.html`)
  }
  return window.loadFile(outPath('renderer', 'evidence-snapshot.html'))
}

/**
 * One hidden, offscreen window per run that turns an evidence card into a PNG.
 * It is never shown, focused, raised, or activated (R6, SC-008): `capturePage`
 * on an offscreen renderer needs no visible window.
 */
export function createEvidenceSnapshotWindow(): EvidenceSnapshotWindow {
  let window: BrowserWindow | null = null
  let ready: Promise<BrowserWindow> | null = null
  let nextToken = 1
  let queue: Promise<unknown> = Promise.resolve()
  let destroyed = false
  const pending = new Map<number, (message: EvidenceSnapshotPaintedMessage) => void>()

  const onPainted = (event: { sender: unknown }, message: unknown): void => {
    // Why: only the snapshot page may report; ignore every other renderer.
    if (!window || event.sender !== window.webContents || !isPaintedMessage(message)) {
      return
    }
    pending.get(message.token)?.(message)
  }

  function ensureWindow(): Promise<BrowserWindow> {
    if (ready) {
      return ready
    }
    const created = new BrowserWindow({
      show: false,
      width: EVIDENCE_SNAPSHOT_WIDTH,
      height: INITIAL_HEIGHT,
      frame: false,
      skipTaskbar: true,
      focusable: false,
      webPreferences: {
        offscreen: true,
        // Why: a never-shown window would otherwise pause requestAnimationFrame and never paint.
        backgroundThrottling: false,
        sandbox: true,
        webviewTag: false,
        contextIsolation: true,
        nodeIntegration: false,
        partition: SNAPSHOT_PARTITION,
        preload: outPath('main', 'evidence-snapshot-preload.js')
      }
    })
    window = created
    created.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    created.webContents.on('will-navigate', (navigation) => navigation.preventDefault())
    ipcMain.on(EVIDENCE_SNAPSHOT_PAINTED_CHANNEL, onPainted)
    ready = loadSnapshotPage(created).then(() => created)
    return ready
  }

  function waitForPaint(token: number): Promise<EvidenceSnapshotPaintedMessage> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(token)
        reject(new Error('Evidence snapshot did not paint in time.'))
      }, PAINT_TIMEOUT_MS)
      pending.set(token, (message) => {
        clearTimeout(timer)
        pending.delete(token)
        resolve(message)
      })
    })
  }

  async function renderOne(card: EvidenceSnapshotCard): Promise<Buffer> {
    if (destroyed) {
      throw new Error('Evidence snapshot window is destroyed.')
    }
    const target = await ensureWindow()
    const token = nextToken++
    const painted = waitForPaint(token)
    const send = (): void =>
      target.webContents.send(EVIDENCE_SNAPSHOT_RENDER_CHANNEL, { token, card })
    send()
    // Why: the page registers its listener after load, so an early message can be lost; resend until it paints.
    const resend = setInterval(send, RESEND_INTERVAL_MS)
    const { width, height } = await painted.finally(() => clearInterval(resend))
    const captureHeight = Math.min(Math.max(1, height), MAX_CARD_HEIGHT)
    target.setContentSize(width, captureHeight)
    const rect = { x: 0, y: 0, width, height: captureHeight }
    // Why: right after a resize the offscreen compositor has no frame at the new size yet and
    // capturePage rejects with UnknownVizError; a fresh frame arrives a few ms later.
    for (let attempt = 1; ; attempt++) {
      try {
        return (await target.webContents.capturePage(rect)).toPNG()
      } catch (error) {
        if (attempt >= CAPTURE_ATTEMPTS || destroyed) {
          throw error
        }
        target.webContents.invalidate()
        await new Promise((resolve) => setTimeout(resolve, CAPTURE_RETRY_MS))
      }
    }
  }

  return {
    // Why: one page serves every card, so renders run strictly one at a time.
    render: (card) => {
      const result = queue.then(() => renderOne(card))
      queue = result.catch(() => undefined)
      return result
    },
    destroy: () => {
      destroyed = true
      ipcMain.removeListener(EVIDENCE_SNAPSHOT_PAINTED_CHANNEL, onPainted)
      pending.clear()
      if (window && !window.isDestroyed()) {
        window.destroy()
      }
      window = null
    }
  }
}
