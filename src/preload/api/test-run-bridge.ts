import { ipcRenderer } from 'electron'
import type { TestRunApi } from './test-run-api'

function subscribe<T>(channel: string, callback: (data: T) => void): () => void {
  const listener = (_event: Electron.IpcRendererEvent, data: T): void => callback(data)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

export const testRunApi: TestRunApi = {
  pickTestMapFile: () => ipcRenderer.invoke('testRun:pickTestMapFile', {}),
  loadTestMap: (args) => ipcRenderer.invoke('testRun:loadTestMap', args),
  getTestMap: (args) => ipcRenderer.invoke('testRun:getTestMap', args),
  saveQueries: (args) => ipcRenderer.invoke('testRun:saveQueries', args),
  pickExportFile: (args) => ipcRenderer.invoke('testRun:pickExportFile', args),
  exportTestMap: (args) => ipcRenderer.invoke('testRun:exportTestMap', args),
  removeTestMap: (args) => ipcRenderer.invoke('testRun:removeTestMap', args),
  prepare: (args) => ipcRenderer.invoke('testRun:prepare', args),
  resolveTargets: (args) => ipcRenderer.invoke('testRun:resolveTargets', args),
  testDatabase: (args) => ipcRenderer.invoke('testRun:testDatabase', args),
  listConsoleTabs: (args) => ipcRenderer.invoke('testRun:listConsoleTabs', args),
  clearRememberedSecrets: (args) => ipcRenderer.invoke('testRun:clearRememberedSecrets', args),
  start: (args) => ipcRenderer.invoke('testRun:start', args),
  stop: (args) => ipcRenderer.invoke('testRun:stop', args),
  answerPause: (args) => ipcRenderer.invoke('testRun:answerPause', args),
  getRun: (args) => ipcRenderer.invoke('testRun:getRun', args),
  getStepDetail: (args) => ipcRenderer.invoke('testRun:getStepDetail', args),
  forgetCaptures: (args) => ipcRenderer.invoke('testRun:forgetCaptures', args),
  onChanged: (callback) => subscribe('testRun:changed', callback),
  onPaused: (callback) => subscribe('testRun:paused', callback),
  onFinished: (callback) => subscribe('testRun:finished', callback),
  onTestMapChanged: (callback) => subscribe('testRun:testMapChanged', callback)
}
