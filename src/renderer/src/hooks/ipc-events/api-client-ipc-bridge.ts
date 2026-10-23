import { ensureApiClientTab } from '@/lib/ensure-api-client-tab'
import { useAppStore } from '../../store'

export function registerApiClientIpcBridge(unsubs: (() => void)[]): void {
  // Why guarded: partial preload mocks and older web shells do not carry the API Client bridge.
  const unsubscribeChanged = window.api.apiClient?.onChanged((event) => {
    void useAppStore.getState().applyApiClientChanged(event)
  })
  if (unsubscribeChanged) {
    unsubs.push(unsubscribeChanged)
  }
  const unsubscribeFinished = window.api.apiClient?.onExecutionFinished((event) => {
    useAppStore.getState().applyApiClientExecutionFinished(event)
  })
  if (unsubscribeFinished) {
    unsubs.push(unsubscribeFinished)
  }
  const unsubscribeShow = window.api.apiClient?.onShow(({ replyId, worktreeId, requestId }) => {
    try {
      // Why: the target worktree may not be the visible one; the tab is created or updated in its
      // own tab set and the visible worktree never changes (ensureApiClientTab only surfaces a
      // tab in the worktree that is already on screen).
      const tabId = ensureApiClientTab(worktreeId, { view: { kind: 'request', requestId } })
      // Why: a tab already on this request does not remount, so its result is refreshed here.
      void useAppStore.getState().loadApiClientResult(worktreeId, requestId)
      window.api.apiClient.replyShow({ replyId, tabId })
    } catch (error) {
      window.api.apiClient.replyShow({
        replyId,
        error: error instanceof Error ? error.message : 'The request could not be shown.'
      })
    }
  })
  if (unsubscribeShow) {
    unsubs.push(unsubscribeShow)
  }
  const unsubscribeProgress = window.api.apiClient?.onRunProgress((event) => {
    useAppStore.getState().applyApiClientRunProgress(event)
  })
  if (unsubscribeProgress) {
    unsubs.push(unsubscribeProgress)
  }
  const unsubscribeRunFinished = window.api.apiClient?.onRunFinished((event) => {
    useAppStore.getState().applyApiClientRunFinished(event)
  })
  if (unsubscribeRunFinished) {
    unsubs.push(unsubscribeRunFinished)
  }
  const testRunApi = window.api.testRun
  const testRunUnsubs = [
    testRunApi?.onChanged((event) => useAppStore.getState().applyTestRunChanged(event)),
    testRunApi?.onPaused((event) => useAppStore.getState().applyTestRunPaused(event)),
    testRunApi?.onFinished((event) => useAppStore.getState().applyTestRunFinished(event)),
    testRunApi?.onTestMapChanged((event) => useAppStore.getState().applyTestMapChanged(event))
  ]
  for (const unsubscribe of testRunUnsubs) {
    if (unsubscribe) {
      unsubs.push(unsubscribe)
    }
  }
  const unsubscribeConsole = window.api.apiClient?.onConsoleAppended((event) => {
    useAppStore.getState().applyApiClientConsoleAppended(event)
  })
  if (unsubscribeConsole) {
    unsubs.push(unsubscribeConsole)
  }
}
