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
import type { TestMapRef } from '../../../../../shared/test-orchestrator/test-orchestrator-types'
import type { TestMapDialogState } from './use-api-client-test-map-actions'

const formatRef = (ref: TestMapRef): string => ('path' in ref ? ref.path.join(' / ') : ref.id)

function CloseFooter({ onClose }: { onClose: () => void }): React.JSX.Element {
  return (
    <DialogFooter>
      <Button onClick={onClose}>{translate('apiClient.common.close', 'Close')}</Button>
    </DialogFooter>
  )
}

function WarningList({
  title,
  items
}: {
  title: string
  items: string[]
}): React.JSX.Element | null {
  if (items.length === 0) {
    return null
  }
  return (
    <section className="space-y-1">
      <h4 className="text-xs font-semibold">{title}</h4>
      <ul className="list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">
        {items.map((item) => (
          <li key={item} className="break-words">
            {item}
          </li>
        ))}
      </ul>
    </section>
  )
}

type TestMapDialogsProps = {
  state: TestMapDialogState
  onConfirmReplace: () => void
  onConfirmRemove: () => void
  onClose: () => void
}

export default function TestMapDialogs({
  state,
  onConfirmReplace,
  onConfirmRemove,
  onClose
}: TestMapDialogsProps): React.JSX.Element | null {
  if (state.phase === 'closed') {
    return null
  }
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="sm:max-w-md">
        {state.phase === 'replace' ? (
          <>
            <DialogHeader>
              <DialogTitle>
                {translate('apiClient.testMap.replaceTitle', 'Replace the test map?')}
              </DialogTitle>
              <DialogDescription>
                {translate(
                  'apiClient.testMap.replaceBody',
                  'This collection already has a test map. Loading this file replaces it, including any verification queries you added here.'
                )}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="ghost" onClick={onClose}>
                {translate('apiClient.common.cancel', 'Cancel')}
              </Button>
              <Button onClick={onConfirmReplace}>
                {translate('apiClient.testMap.replaceConfirm', 'Replace')}
              </Button>
            </DialogFooter>
          </>
        ) : state.phase === 'remove' ? (
          <>
            <DialogHeader>
              <DialogTitle>
                {translate('apiClient.testMap.removeTitle', 'Remove the test map?')}
              </DialogTitle>
              <DialogDescription>
                {translate(
                  'apiClient.testMap.removeBody',
                  'The test map and its verification queries for "{{name}}" will be removed. The collection itself is not changed.',
                  { name: state.name }
                )}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="ghost" onClick={onClose}>
                {translate('apiClient.common.cancel', 'Cancel')}
              </Button>
              <Button variant="destructive" onClick={onConfirmRemove}>
                {translate('apiClient.testMap.remove', 'Remove test map')}
              </Button>
            </DialogFooter>
          </>
        ) : state.phase === 'invalid' ? (
          <>
            <DialogHeader>
              <DialogTitle>
                {translate('apiClient.testMap.invalidTitle', 'Test map not loaded')}
              </DialogTitle>
              <DialogDescription>{state.message}</DialogDescription>
            </DialogHeader>
            <ul
              className="scrollbar-sleek max-h-64 list-disc space-y-1 overflow-y-auto pl-5 text-xs"
              role="alert"
            >
              {state.issues.map((issue) => (
                <li key={`${issue.path}:${issue.message}`} className="break-words">
                  <code className="font-mono">{issue.path}</code>
                  {': '}
                  {issue.message}
                </li>
              ))}
            </ul>
            <CloseFooter onClose={onClose} />
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>
                {translate('apiClient.testMap.warningsTitle', 'Test map loaded with warnings')}
              </DialogTitle>
              <DialogDescription>
                {translate(
                  'apiClient.testMap.warningsBody',
                  'Some entries could not be matched to a request. They are kept but will not run.'
                )}
              </DialogDescription>
            </DialogHeader>
            <div className="scrollbar-sleek max-h-64 space-y-3 overflow-y-auto">
              <WarningList
                title={translate('apiClient.testMap.unmatched', 'No matching request')}
                items={state.warnings.unmatched.map(formatRef)}
              />
              <WarningList
                title={translate('apiClient.testMap.ambiguous', 'More than one matching request')}
                items={state.warnings.ambiguous.map(
                  ({ ref, candidates }) =>
                    `${formatRef(ref)} (${candidates.map(formatRef).join(', ')})`
                )}
              />
              <WarningList
                title={translate('apiClient.testMap.unknownFields', 'Unknown fields (ignored)')}
                items={state.warnings.unknownFields}
              />
            </div>
            <CloseFooter onClose={onClose} />
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
