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

/** The "changed in another tab" notice, and the conflict dialog a refused save opens (FR-003). */
export function RequestDraftNotices({
  tabId,
  subject = 'request'
}: {
  tabId: string
  subject?: 'request' | 'environment'
}): React.JSX.Element | null {
  const draft = useAppStore((state) => state.apiClientDraftsByTab[tabId])
  const reload = useAppStore((state) => state.reloadApiClientDraft)
  const dismissConflict = useAppStore((state) => state.dismissApiClientConflict)
  if (!draft?.changedElsewhere) {
    return null
  }
  return (
    <>
      <div
        className="flex items-center justify-between gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs"
        role="status"
      >
        <span>
          {subject === 'request'
            ? translate(
                'apiClient.request.changedElsewhere',
                'This request was changed in another tab. Your unsaved edits are kept.'
              )
            : translate(
                'apiClient.environments.changedElsewhere',
                'This environment was changed in another tab. Your unsaved edits are kept.'
              )}
        </span>
        <Button size="xs" variant="outline" onClick={() => reload(tabId)}>
          {translate('apiClient.request.reload', 'Reload')}
        </Button>
      </div>
      {draft.conflict ? (
        <Dialog open onOpenChange={(open) => (open ? undefined : dismissConflict(tabId))}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>
                {translate('apiClient.request.conflictTitle', 'Could not save')}
              </DialogTitle>
              <DialogDescription>
                {subject === 'request'
                  ? translate(
                      'apiClient.request.conflictBody',
                      'This request was changed elsewhere since you started editing. Reload to discard your edits and see the latest version, or cancel to keep editing.'
                    )
                  : translate(
                      'apiClient.environments.conflictBody',
                      'This environment was changed elsewhere since you started editing. Reload to discard your edits and see the latest version, or cancel to keep editing.'
                    )}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="ghost" onClick={() => dismissConflict(tabId)}>
                {translate('apiClient.common.cancel', 'Cancel')}
              </Button>
              <Button variant="destructive" onClick={() => reload(tabId)}>
                {translate('apiClient.request.reload', 'Reload')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  )
}
