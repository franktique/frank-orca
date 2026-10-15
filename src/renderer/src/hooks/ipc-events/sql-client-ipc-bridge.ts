import { useAppStore } from '../../store'

export function registerSqlClientIpcBridge(unsubs: (() => void)[]): void {
  // Why guarded: partial preload mocks and older web shells do not carry the SQL bridge.
  const unsubscribeChanged = window.api.sqlClient?.onChanged((event) => {
    useAppStore.getState().applySqlChanged(event)
  })
  if (unsubscribeChanged) {
    unsubs.push(unsubscribeChanged)
  }
  const unsubscribeStatus = window.api.sqlClient?.onConnectionStatus((event) => {
    useAppStore.getState().applySqlConnectionStatus(event)
  })
  if (unsubscribeStatus) {
    unsubs.push(unsubscribeStatus)
  }
}
