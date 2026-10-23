import { useAppStore } from '../../store'

export function registerExplanationsIpcBridge(unsubs: (() => void)[]): void {
  // Why guarded: partial preload mocks and older web shells do not carry the bridge.
  const unsubscribe = window.api.explanations?.onChanged((event) => {
    void useAppStore.getState().applyExplanationsChanged(event)
  })
  if (unsubscribe) {
    unsubs.push(unsubscribe)
  }
}
