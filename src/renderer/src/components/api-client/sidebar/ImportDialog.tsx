import { Loader2 } from 'lucide-react'
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
import type { ImportDialogState } from './use-api-client-import'

type ImportDialogProps = {
  state: ImportDialogState
  onResolveDuplicate: (mode: 'replace' | 'keep-both') => void
  onClose: () => void
}

export default function ImportDialog({
  state,
  onResolveDuplicate,
  onClose
}: ImportDialogProps): React.JSX.Element | null {
  if (state.phase === 'closed') {
    return null
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => (open || state.phase === 'working' ? undefined : onClose())}
    >
      <DialogContent className="sm:max-w-md" showCloseButton={state.phase !== 'working'}>
        {state.phase === 'working' ? (
          <DialogHeader>
            <DialogTitle>
              <span className="flex items-center gap-2">
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                {translate('apiClient.import.working', 'Importing…')}
              </span>
            </DialogTitle>
          </DialogHeader>
        ) : null}

        {state.phase === 'error' ? (
          <>
            <DialogHeader>
              <DialogTitle>
                {translate('apiClient.import.failedTitle', 'Import failed')}
              </DialogTitle>
              <DialogDescription className="break-words" role="alert">
                {state.message}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button onClick={onClose}>{translate('apiClient.common.close', 'Close')}</Button>
            </DialogFooter>
          </>
        ) : null}

        {state.phase === 'duplicate' ? (
          <>
            <DialogHeader>
              <DialogTitle>
                {translate('apiClient.import.duplicateTitle', 'Name already exists')}
              </DialogTitle>
              <DialogDescription>{state.message}</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="ghost" onClick={onClose}>
                {translate('apiClient.common.cancel', 'Cancel')}
              </Button>
              <Button variant="secondary" onClick={() => onResolveDuplicate('keep-both')}>
                {translate('apiClient.import.keepBoth', 'Keep both')}
              </Button>
              <Button onClick={() => onResolveDuplicate('replace')}>
                {translate('apiClient.import.replace', 'Replace')}
              </Button>
            </DialogFooter>
          </>
        ) : null}

        {state.phase === 'done' ? (
          <>
            <DialogHeader>
              <DialogTitle>{translate('apiClient.import.doneTitle', 'Imported')}</DialogTitle>
              <DialogDescription>
                {state.warnings.length > 0
                  ? translate(
                      'apiClient.import.warningsIntro',
                      'Some features are not supported yet. They are kept for export.'
                    )
                  : translate('apiClient.import.doneBody', 'The file was imported.')}
              </DialogDescription>
            </DialogHeader>
            {state.secretProtection ? (
              <p className="text-xs text-muted-foreground" role="status">
                {state.secretProtection.message}
              </p>
            ) : null}
            {state.warnings.length > 0 ? (
              <ul className="scrollbar-sleek max-h-48 list-disc space-y-1 overflow-y-auto pl-4 text-xs text-muted-foreground">
                {state.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            ) : null}
            <DialogFooter>
              <Button onClick={onClose}>{translate('apiClient.common.close', 'Close')}</Button>
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
