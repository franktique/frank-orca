import { ipcRenderer } from 'electron'
import type { ApiClientChangedEvent } from '../../shared/api-client/api-client-ipc-schemas'
import type { ApiClientApi } from './api-client-api'

function subscribe<T>(channel: string, callback: (data: T) => void): () => void {
  const listener = (_event: Electron.IpcRendererEvent, data: T): void => callback(data)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

export const apiClientApi: ApiClientApi = {
  getSnapshot: (args) => ipcRenderer.invoke('apiClient:getSnapshot', args),
  setActiveEnvironment: (args) => ipcRenderer.invoke('apiClient:setActiveEnvironment', args),
  pickImportFile: () => ipcRenderer.invoke('apiClient:pickImportFile'),
  importFile: (args) => ipcRenderer.invoke('apiClient:importFile', args),
  pickExportFile: (defaultName) => ipcRenderer.invoke('apiClient:pickExportFile', defaultName),
  exportFile: (args) => ipcRenderer.invoke('apiClient:export', args),
  treeOp: (args) => ipcRenderer.invoke('apiClient:treeOp', args),
  saveRequest: (args) => ipcRenderer.invoke('apiClient:saveRequest', args),
  send: (args) => ipcRenderer.invoke('apiClient:send', args),
  envOp: (args) => ipcRenderer.invoke('apiClient:envOp', args),
  saveEnvironment: (args) => ipcRenderer.invoke('apiClient:saveEnvironment', args),
  getLatestRun: (args) => ipcRenderer.invoke('apiClient:getLatestRun', args),
  startRun: (args) => ipcRenderer.invoke('apiClient:startRun', args),
  stopRun: (args) => ipcRenderer.invoke('apiClient:stopRun', args),
  clearRun: (args) => ipcRenderer.invoke('apiClient:clearRun', args),
  onRunProgress: (callback) => subscribe('apiClient:runProgress', callback),
  onRunFinished: (callback) => subscribe('apiClient:runFinished', callback),
  onShow: (callback) => subscribe('apiClient:show', callback),
  replyShow: (reply) => ipcRenderer.send('apiClient:showReply', reply),
  cancel: (args) => ipcRenderer.invoke('apiClient:cancel', args),
  getLatestResult: (args) => ipcRenderer.invoke('apiClient:getLatestResult', args),
  getConsole: (args) => ipcRenderer.invoke('apiClient:getConsole', args),
  clearConsole: (args) => ipcRenderer.invoke('apiClient:clearConsole', args),
  onExecutionFinished: (callback) => subscribe('apiClient:executionFinished', callback),
  onConsoleAppended: (callback) => subscribe('apiClient:consoleAppended', callback),
  onChanged: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, data: ApiClientChangedEvent): void =>
      callback(data)
    ipcRenderer.on('apiClient:changed', listener)
    return () => ipcRenderer.removeListener('apiClient:changed', listener)
  }
}
