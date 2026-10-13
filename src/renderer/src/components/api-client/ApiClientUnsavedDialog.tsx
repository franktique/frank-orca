import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'

/** Save / Discard / Cancel before a view switch or a tab close would drop unsaved edits (FR-003a). */
export default function ApiClientUnsavedDialog({
  tabId
}: {
  tabId: string
}): React.JSX.Element | null {
  const pendingView = useAppStore((state) => state.apiClientPendingViewByTab[tabId])
  const pendingClose = useAppStore((state) => state.apiClientPendingCloseTabId === tabId)
  const confirmView = useAppStore((state) => state.confirmApiClientPendingView)
  const cancelView = useAppStore((state) => state.cancelApiClientPendingView)
  const clearClose = useAppStore((state) => state.clearApiClientPendingClose)
  const save = useAppStore((state) => state.saveApiClientDraft)
  const closeUnifiedTab = useAppStore((state) => state.closeUnifiedTab)
  const draftKind = useAppStore((state) => state.apiClientDraftsByTab[tabId]?.kind)

  if (!pendingView && !pendingClose) {
    return null
  }

  const cancel = (): void => {
    cancelView(tabId)
    clearClose()
  }
  const resolve = async (saveFirst: boolean): Promise<void> => {
    if (pendingView) {
      await confirmView(tabId, saveFirst)
    }
    if (pendingClose) {
      if (saveFirst && !(await save(tabId))) {
        return
      }
      clearClose()
      closeUnifiedTab(tabId, { discardApiClientDraft: true })
    }
  }

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : cancel())}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{translate('apiClient.unsaved.title', 'Unsaved changes')}</DialogTitle>
          <DialogDescription>
            {draftKind === 'environment'
              ? translate(
                  'apiClient.unsaved.bodyEnvironment',
                  'This environment has changes that are not saved. Save them or discard them to continue.'
                )
              : translate(
                  'apiClient.unsaved.body',
                  'This request has changes that are not saved. Save them or discard them to continue.'
                )}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={cancel}>
            {translate('apiClient.common.cancel', 'Cancel')}
          </Button>
          <Button variant="secondary" onClick={() => void resolve(false)}>
            {translate('apiClient.unsaved.discard', 'Discard')}
          </Button>
          <Button onClick={() => void resolve(true)}>
            {translate('apiClient.unsaved.save', 'Save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
