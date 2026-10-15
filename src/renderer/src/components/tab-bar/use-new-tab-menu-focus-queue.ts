import { useRef } from 'react'
import { focusTerminalTabSurface } from '@/lib/focus-terminal-tab-surface'
import { useAppStore } from '../../store'

const NEW_TAB_MENU_TERMINAL_FOCUS_RETRY_MS = 50
const NEW_TAB_MENU_TERMINAL_FOCUS_TIMEOUT_MS = 5000

/** Focus handed over once the '+' menu has closed, so the menu does not steal it back. */
export function useNewTabMenuFocusQueue() {
  const pendingNewTabMenuFocusRef = useRef<(() => void) | null>(null)
  const pendingNewTabMenuFocusAnimationRef = useRef<number | null>(null)
  const pendingNewTabMenuFocusRetryRef = useRef<number | null>(null)
  const clearPendingNewTabMenuFocusTimers = (): void => {
    if (pendingNewTabMenuFocusAnimationRef.current !== null) {
      cancelAnimationFrame(pendingNewTabMenuFocusAnimationRef.current)
      pendingNewTabMenuFocusAnimationRef.current = null
    }
    if (pendingNewTabMenuFocusRetryRef.current !== null) {
      window.clearTimeout(pendingNewTabMenuFocusRetryRef.current)
      pendingNewTabMenuFocusRetryRef.current = null
    }
  }
  const focusNewActiveTerminalWhenReady = (
    previousActiveTabId: string | null,
    expiresAt: number,
    now: number
  ): void => {
    const state = useAppStore.getState()
    if (
      (state.activeTabType === 'terminal' || state.activeTabType === 'simulator') &&
      state.activeTabId &&
      state.activeTabId !== previousActiveTabId
    ) {
      focusTerminalTabSurface(state.activeTabId)
      return
    }
    if (now >= expiresAt) {
      return
    }
    pendingNewTabMenuFocusRetryRef.current = window.setTimeout(() => {
      pendingNewTabMenuFocusRetryRef.current = null
      focusNewActiveTerminalWhenReady(previousActiveTabId, expiresAt, Date.now())
    }, NEW_TAB_MENU_TERMINAL_FOCUS_RETRY_MS)
  }
  const queueNewActiveTerminalFocusAfterNewTabMenuClose = (): void => {
    const previousActiveTabId = useAppStore.getState().activeTabId
    pendingNewTabMenuFocusRef.current = () => {
      // Why: paired web/SSH tab creation is async; await the host snapshot's new terminal instead of the pre-existing active tab.
      focusNewActiveTerminalWhenReady(
        previousActiveTabId,
        Date.now() + NEW_TAB_MENU_TERMINAL_FOCUS_TIMEOUT_MS,
        Date.now()
      )
    }
  }
  const queueTerminalTabFocusAfterNewTabMenuClose = (tabId: string): void => {
    pendingNewTabMenuFocusRef.current = () => focusTerminalTabSurface(tabId)
  }
  const queueFocusAfterNewTabMenuClose = (focus: () => void): void => {
    pendingNewTabMenuFocusRef.current = focus
  }
  const runPendingNewTabMenuFocusAfterClose = (): void => {
    const pendingFocus = pendingNewTabMenuFocusRef.current
    pendingNewTabMenuFocusRef.current = null
    clearPendingNewTabMenuFocusTimers()
    if (pendingFocus) {
      pendingNewTabMenuFocusAnimationRef.current = requestAnimationFrame(() => {
        pendingNewTabMenuFocusAnimationRef.current = null
        pendingFocus()
      })
    }
  }
  const clearPendingNewTabMenuFocusOnUnmountRef = useRef<
    ((node: HTMLDivElement | null) => void) | null
  >(null)
  if (clearPendingNewTabMenuFocusOnUnmountRef.current === null) {
    clearPendingNewTabMenuFocusOnUnmountRef.current = (node: HTMLDivElement | null): void => {
      if (node !== null) {
        return
      }
      // Why: cancel the delayed focus handoff via this root ref cleanup, avoiding an otherwise cleanup-only React Effect.
      clearPendingNewTabMenuFocusTimers()
    }
  }
  const clearPendingNewTabMenuFocusOnUnmount = clearPendingNewTabMenuFocusOnUnmountRef.current

  return {
    queueNewActiveTerminalFocusAfterNewTabMenuClose,
    queueTerminalTabFocusAfterNewTabMenuClose,
    queueFocusAfterNewTabMenuClose,
    runPendingNewTabMenuFocusAfterClose,
    clearPendingNewTabMenuFocusOnUnmount
  }
}
