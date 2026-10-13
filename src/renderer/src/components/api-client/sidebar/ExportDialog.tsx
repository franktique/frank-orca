import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { translate } from '@/i18n/i18n'
import type { ExportDialogState } from './use-api-client-export'

type ExportDialogProps = {
  state: ExportDialogState
  onConfirmSecrets: () => void
  onClose: () => void
}

export default function ExportDialog({
  state,
  onConfirmSecrets,
  onClose
}: ExportDialogProps): React.JSX.Element | null {
  if (state.phase === 'closed') {
    return null
  }
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="sm:max-w-md">
        {state.phase === 'secrets-warning' ? (
          <>
            <DialogHeader>
              <DialogTitle>
                {translate('apiClient.export.secretsTitle', 'Export includes secrets')}
              </DialogTitle>
              <DialogDescription>
                {translate(
                  'apiClient.export.secretsBody',
                  'This environment has secret variables. The file will contain their values as plain text.'
                )}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="ghost" onClick={onClose}>
                {translate('apiClient.common.cancel', 'Cancel')}
              </Button>
              <Button onClick={onConfirmSecrets}>
                {translate('apiClient.export.continue', 'Export anyway')}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>
                {translate('apiClient.export.failedTitle', 'Export failed')}
              </DialogTitle>
              <DialogDescription className="break-words" role="alert">
                {state.message}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button onClick={onClose}>{translate('apiClient.common.close', 'Close')}</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
