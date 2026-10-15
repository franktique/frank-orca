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

export default function ConnectionDeleteDialog({
  name,
  queryCount,
  collectionCount,
  onConfirm,
  onCancel
}: {
  name: string
  queryCount: number
  collectionCount: number
  onConfirm: () => void
  onCancel: () => void
}): React.JSX.Element {
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onCancel())}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>
            {translate('sqlClient.connection.deleteTitle', 'Delete this connection?')}
          </DialogTitle>
          <DialogDescription>
            {translate(
              'sqlClient.connection.deleteDescription',
              '"{{name}}" and its {{queries}} saved queries and {{collections}} collections will be deleted. Open SQL tabs keep their text.',
              { name, queries: queryCount, collections: collectionCount }
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel}>
            {translate('sqlClient.common.cancel', 'Cancel')}
          </Button>
          <Button variant="destructive" onClick={onConfirm}>
            {translate('sqlClient.common.delete', 'Delete')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
