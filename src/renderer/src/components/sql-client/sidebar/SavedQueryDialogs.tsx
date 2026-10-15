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
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { translate } from '@/i18n/i18n'
import type { SqlQueryCollection } from '../../../../../shared/sql-client/sql-client-types'

const Cancel = ({ onClick }: { onClick: () => void }): React.JSX.Element => (
  <Button variant="ghost" onClick={onClick}>
    {translate('sqlClient.common.cancel', 'Cancel')}
  </Button>
)

export function NameDialog({
  title,
  label,
  initialValue,
  confirmLabel,
  maxLength,
  onSubmit,
  onCancel
}: {
  title: string
  label: string
  initialValue: string
  confirmLabel: string
  maxLength: number
  onSubmit: (name: string) => void
  onCancel: () => void
}): React.JSX.Element {
  const [value, setValue] = useState(initialValue)
  const trimmed = value.trim()
  const invalid = trimmed.length === 0 || trimmed.length > maxLength
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onCancel())}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="sr-only">{title}</DialogDescription>
        </DialogHeader>
        <Input
          aria-label={label}
          value={value}
          autoFocus
          aria-invalid={invalid ? true : undefined}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !invalid) {
              onSubmit(trimmed)
            }
          }}
        />
        <DialogFooter>
          <Cancel onClick={onCancel} />
          <Button disabled={invalid} onClick={() => onSubmit(trimmed)}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

const UNGROUPED = '__none__'

export function MoveQueryDialog({
  collections,
  currentCollectionId,
  onMove,
  onCancel
}: {
  collections: SqlQueryCollection[]
  currentCollectionId: string | null
  onMove: (collectionId: string | null) => void
  onCancel: () => void
}): React.JSX.Element {
  const [selected, setSelected] = useState(currentCollectionId ?? UNGROUPED)
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onCancel())}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{translate('sqlClient.saved.moveTitle', 'Move to collection')}</DialogTitle>
          <DialogDescription className="sr-only">
            {translate('sqlClient.saved.moveTitle', 'Move to collection')}
          </DialogDescription>
        </DialogHeader>
        <Select value={selected} onValueChange={setSelected}>
          <SelectTrigger
            className="w-full"
            aria-label={translate('sqlClient.saved.collection', 'Collection')}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={UNGROUPED}>
              {translate('sqlClient.saved.noCollection', 'No collection')}
            </SelectItem>
            {collections.map((collection) => (
              <SelectItem key={collection.id} value={collection.id}>
                {collection.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <DialogFooter>
          <Cancel onClick={onCancel} />
          <Button onClick={() => onMove(selected === UNGROUPED ? null : selected)}>
            {translate('sqlClient.saved.move', 'Move')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function DeleteQueryDialog({
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
          <DialogTitle>
            {translate('sqlClient.saved.deleteQueryTitle', 'Delete this query?')}
          </DialogTitle>
          <DialogDescription>
            {translate('sqlClient.saved.deleteQueryDescription', '"{{name}}" will be deleted.', {
              name
            })}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Cancel onClick={onCancel} />
          <Button variant="destructive" onClick={onConfirm}>
            {translate('sqlClient.common.delete', 'Delete')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function DeleteCollectionDialog({
  name,
  queryCount,
  onUngroup,
  onDeleteAll,
  onCancel
}: {
  name: string
  queryCount: number
  onUngroup: () => void
  onDeleteAll: () => void
  onCancel: () => void
}): React.JSX.Element {
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onCancel())}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>
            {translate('sqlClient.saved.deleteCollectionTitle', 'Delete this collection?')}
          </DialogTitle>
          <DialogDescription>
            {queryCount === 0
              ? translate('sqlClient.saved.deleteCollectionEmpty', '"{{name}}" is empty.', { name })
              : translate(
                  'sqlClient.saved.deleteCollectionDescription',
                  '"{{name}}" holds {{count}} saved queries. Keep them without a collection, or delete them too.',
                  { name, count: queryCount }
                )}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Cancel onClick={onCancel} />
          {queryCount === 0 ? (
            <Button variant="destructive" onClick={onUngroup}>
              {translate('sqlClient.common.delete', 'Delete')}
            </Button>
          ) : (
            <>
              <Button variant="outline" onClick={onUngroup}>
                {translate('sqlClient.saved.keepQueries', 'Keep queries')}
              </Button>
              <Button variant="destructive" onClick={onDeleteAll}>
                {translate('sqlClient.saved.deleteQueriesToo', 'Delete queries too')}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function UnsavedQueryDialog({
  onSave,
  onDiscard,
  onCancel
}: {
  onSave: () => void
  onDiscard: () => void
  onCancel: () => void
}): React.JSX.Element {
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onCancel())}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{translate('sqlClient.saved.unsavedTitle', 'Unsaved changes')}</DialogTitle>
          <DialogDescription>
            {translate(
              'sqlClient.saved.unsavedDescription',
              'The current query has changes that are not saved. Save them before opening another query?'
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Cancel onClick={onCancel} />
          <Button variant="outline" onClick={onDiscard}>
            {translate('sqlClient.saved.discard', 'Discard')}
          </Button>
          <Button onClick={onSave}>{translate('sqlClient.common.save', 'Save')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
