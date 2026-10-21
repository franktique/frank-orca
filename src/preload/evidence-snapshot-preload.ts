import type { ContextBridge, IpcRenderer } from 'electron'
import type { EvidenceSnapshotPaintedMessage } from '../shared/test-orchestrator/evidence-snapshot-card'

// Why: raw require keeps the sandboxed preload standalone; an import emits a Rollup interop chunk it cannot load.
const {
  contextBridge,
  ipcRenderer
}: { contextBridge: ContextBridge; ipcRenderer: IpcRenderer } = require('electron')

// Why: literals, not imports, so the sandboxed bundle needs no shared chunk.
const RENDER_CHANNEL = 'evidenceSnapshot:render'
const PAINTED_CHANNEL = 'evidenceSnapshot:painted'

// Only these two channels are reachable from the snapshot page.
contextBridge.exposeInMainWorld('evidenceSnapshot', {
  // Why: payload stays unknown; the page validates it before rendering.
  onRender: (listener: (message: unknown) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, message: unknown): void => {
      listener(message)
    }
    ipcRenderer.on(RENDER_CHANNEL, handler)
    return () => ipcRenderer.removeListener(RENDER_CHANNEL, handler)
  },
  painted: (message: EvidenceSnapshotPaintedMessage): void => {
    ipcRenderer.send(PAINTED_CHANNEL, message)
  }
})
