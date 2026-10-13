import { translate } from '@/i18n/i18n'
import type { TreeRow } from './collection-tree-rows'

export type RowAction =
  | 'new-request'
  | 'new-folder'
  | 'rename'
  | 'duplicate'
  | 'move'
  | 'delete'
  | 'run'
  | 'export'

export type RowMenuEntry = {
  action: RowAction
  label: string
  destructive?: boolean
  separatorBefore?: boolean
}

/** One list drives both the right-click menu and the row's "more" button. */
export function buildRowMenuEntries(row: TreeRow): RowMenuEntry[] {
  const entries: RowMenuEntry[] = []
  if (row.kind !== 'request') {
    entries.push(
      { action: 'new-request', label: translate('apiClient.tree.newRequest', 'New request') },
      { action: 'new-folder', label: translate('apiClient.tree.newFolder', 'New folder') },
      { action: 'run', label: translate('apiClient.tree.run', 'Run…'), separatorBefore: true }
    )
  }
  entries.push(
    {
      action: 'rename',
      label: translate('apiClient.tree.rename', 'Rename'),
      separatorBefore: row.kind !== 'request'
    },
    { action: 'duplicate', label: translate('apiClient.tree.duplicate', 'Duplicate') }
  )
  if (row.kind === 'collection') {
    entries.push({ action: 'export', label: translate('apiClient.tree.export', 'Export…') })
  } else {
    entries.push({ action: 'move', label: translate('apiClient.tree.moveTo', 'Move to…') })
  }
  entries.push({
    action: 'delete',
    label: translate('apiClient.tree.delete', 'Delete'),
    destructive: true,
    separatorBefore: true
  })
  return entries
}
