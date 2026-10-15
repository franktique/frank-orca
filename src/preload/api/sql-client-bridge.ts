import { ipcRenderer } from 'electron'
import type { SqlClientApi } from './sql-client-api'

function subscribe<T>(channel: string, callback: (data: T) => void): () => void {
  const listener = (_event: Electron.IpcRendererEvent, data: T): void => callback(data)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

export const sqlClientApi: SqlClientApi = {
  getSnapshot: (args) => ipcRenderer.invoke('sqlClient:getSnapshot', args),
  createConnection: (args) => ipcRenderer.invoke('sqlClient:createConnection', args),
  updateConnection: (args) => ipcRenderer.invoke('sqlClient:updateConnection', args),
  deleteConnection: (args) => ipcRenderer.invoke('sqlClient:deleteConnection', args),
  testConnection: (args) => ipcRenderer.invoke('sqlClient:testConnection', args),
  saveQuery: (args) => ipcRenderer.invoke('sqlClient:saveQuery', args),
  renameQuery: (args) => ipcRenderer.invoke('sqlClient:renameQuery', args),
  moveQuery: (args) => ipcRenderer.invoke('sqlClient:moveQuery', args),
  deleteQuery: (args) => ipcRenderer.invoke('sqlClient:deleteQuery', args),
  createCollection: (args) => ipcRenderer.invoke('sqlClient:createCollection', args),
  renameCollection: (args) => ipcRenderer.invoke('sqlClient:renameCollection', args),
  deleteCollection: (args) => ipcRenderer.invoke('sqlClient:deleteCollection', args),
  connect: (args) => ipcRenderer.invoke('sqlClient:connect', args),
  disconnect: (args) => ipcRenderer.invoke('sqlClient:disconnect', args),
  listSchemas: (args) => ipcRenderer.invoke('sqlClient:listSchemas', args),
  listRelations: (args) => ipcRenderer.invoke('sqlClient:listRelations', args),
  listColumns: (args) => ipcRenderer.invoke('sqlClient:listColumns', args),
  run: (args) => ipcRenderer.invoke('sqlClient:run', args),
  cancel: (args) => ipcRenderer.invoke('sqlClient:cancel', args),
  closeTabSession: (args) => ipcRenderer.invoke('sqlClient:closeTabSession', args),
  onChanged: (callback) => subscribe('sqlClient:changed', callback),
  onConnectionStatus: (callback) => subscribe('sqlClient:connectionStatus', callback)
}
