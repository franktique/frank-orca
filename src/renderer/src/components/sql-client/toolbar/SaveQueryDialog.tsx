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
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { translate } from '@/i18n/i18n'
import { defaultSavedQueryName } from '@/lib/sql-saved-query-actions'
import { SQL_CLIENT_LIMITS } from '../../../../../shared/sql-client/sql-client-schemas'
import type { SqlQueryCollection } from '../../../../../shared/sql-client/sql-client-types'

const NO_COLLECTION = '__none__'
const NEW_COLLECTION = '__new__'

export type SaveQueryInput = {
  name: string
  collectionId: string | null
  newCollectionName?: string
}

export default function SaveQueryDialog({
  sql,
  collections,
  onSave,
  onClose
}: {
  sql: string
  collections: SqlQueryCollection[]
  onSave: (input: SaveQueryInput) => Promise<boolean>
  onClose: () => void
}): React.JSX.Element {
  const [name, setName] = useState(() => defaultSavedQueryName(sql))
  const [collection, setCollection] = useState(NO_COLLECTION)
  const [newCollectionName, setNewCollectionName] = useState('')
  const [busy, setBusy] = useState(false)
  const trimmed = name.trim()
  const nameInvalid = trimmed.length === 0 || trimmed.length > SQL_CLIENT_LIMITS.queryNameMax
  const collectionInvalid = collection === NEW_COLLECTION && newCollectionName.trim().length === 0

  const submit = async (): Promise<void> => {
    setBusy(true)
    const saved = await onSave({
      name: trimmed,
      collectionId:
        collection === NO_COLLECTION || collection === NEW_COLLECTION ? null : collection,
      ...(collection === NEW_COLLECTION ? { newCollectionName: newCollectionName.trim() } : {})
    })
    setBusy(false)
    if (saved) {
      onClose()
    }
  }

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{translate('sqlClient.saved.saveTitle', 'Save query')}</DialogTitle>
          <DialogDescription>
            {translate('sqlClient.saved.saveDescription', 'Saved under the selected connection.')}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="sql-save-name">{translate('sqlClient.saved.name', 'Name')}</Label>
            <Input
              id="sql-save-name"
              value={name}
              autoFocus
              aria-invalid={nameInvalid ? true : undefined}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !nameInvalid && !collectionInvalid && !busy) {
                  void submit()
                }
              }}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="sql-save-collection">
              {translate('sqlClient.saved.collection', 'Collection')}
            </Label>
            <Select value={collection} onValueChange={setCollection}>
              <SelectTrigger id="sql-save-collection" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_COLLECTION}>
                  {translate('sqlClient.saved.noCollection', 'No collection')}
                </SelectItem>
                {collections.map((entry) => (
                  <SelectItem key={entry.id} value={entry.id}>
                    {entry.name}
                  </SelectItem>
                ))}
                <SelectItem value={NEW_COLLECTION}>
                  {translate('sqlClient.saved.newCollection', 'New collection…')}
                </SelectItem>
              </SelectContent>
            </Select>
            {collection === NEW_COLLECTION ? (
              <Input
                aria-label={translate('sqlClient.saved.newCollectionName', 'New collection name')}
                value={newCollectionName}
                onChange={(event) => setNewCollectionName(event.target.value)}
              />
            ) : null}
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {translate('sqlClient.common.cancel', 'Cancel')}
          </Button>
          <Button disabled={busy || nameInvalid || collectionInvalid} onClick={() => void submit()}>
            {translate('sqlClient.common.save', 'Save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
