import { useState } from 'react'
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
import type { Collection } from '../../../../../shared/api-client/api-client-types'
import { listMoveTargets } from '../../../../../shared/api-client/collection-tree'

export function ConfirmDeleteDialog({
  name,
  onConfirm,
  onCancel
}: {
  name: string
  onConfirm: () => void
  onCancel: () => void
}): React.JSX.Element {
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onCancel())}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{translate('apiClient.tree.deleteTitle', 'Delete this item?')}</DialogTitle>
          <DialogDescription>
            {translate(
              'apiClient.tree.deleteDescription',
              '"{{name}}" and everything inside it will be removed from this workspace.',
              { name }
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel}>
            {translate('apiClient.common.cancel', 'Cancel')}
          </Button>
          <Button variant="destructive" onClick={onConfirm}>
            {translate('apiClient.tree.delete', 'Delete')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Lists the collection root plus every folder except the node and its descendants. */
export function MoveToDialog({
  collection,
  nodeId,
  onMove,
  onCancel
}: {
  collection: Collection
  nodeId: string
  onMove: (parentId: string | null) => void
  onCancel: () => void
}): React.JSX.Element {
  const targets = listMoveTargets(collection, nodeId)
  const [selected, setSelected] = useState<string | null>(null)
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onCancel())}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{translate('apiClient.tree.moveTitle', 'Move to')}</DialogTitle>
          <DialogDescription>
            {translate(
              'apiClient.tree.moveDescription',
              'Choose the folder to move this item into.'
            )}
          </DialogDescription>
        </DialogHeader>
        <ul
          role="listbox"
          aria-label={translate('apiClient.tree.moveTitle', 'Move to')}
          className="scrollbar-sleek max-h-64 space-y-0.5 overflow-y-auto"
        >
          {targets.map((target) => (
            <li key={target.id ?? 'root'} role="presentation">
              <button
                type="button"
                role="option"
                aria-selected={selected === target.id}
                onClick={() => setSelected(target.id)}
                onDoubleClick={() => onMove(target.id)}
                className="flex w-full items-center rounded-md px-2 py-1 text-left text-sm hover:bg-accent aria-selected:bg-accent"
                style={{ paddingLeft: 8 + target.depth * 12 }}
              >
                <span className="truncate">{target.name}</span>
              </button>
            </li>
          ))}
        </ul>
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel}>
            {translate('apiClient.common.cancel', 'Cancel')}
          </Button>
          <Button onClick={() => onMove(selected)}>
            {translate('apiClient.tree.moveConfirm', 'Move')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
