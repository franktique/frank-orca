import { ipcRenderer } from 'electron'
import type { ExplanationsApi, ExplanationsChangedEvent } from './explanations-api'

export const explanationsApi: ExplanationsApi = {
  get: (args) => ipcRenderer.invoke('explanations:get', args),
  changeSet: (args) => ipcRenderer.invoke('explanations:changeSet', args),
  fileDiff: (args) => ipcRenderer.invoke('explanations:fileDiff', args),
  clear: (args) => ipcRenderer.invoke('explanations:clear', args),
  upsertQuestion: (args) => ipcRenderer.invoke('explanations:questions:upsert', args),
  markQuestionsSent: (args) => ipcRenderer.invoke('explanations:questions:markSent', args),
  deleteQuestion: (args) => ipcRenderer.invoke('explanations:questions:delete', args),
  onChanged: (listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, data: ExplanationsChangedEvent): void =>
      listener(data)
    ipcRenderer.on('explanations:changed', wrapped)
    return () => ipcRenderer.removeListener('explanations:changed', wrapped)
  }
}
