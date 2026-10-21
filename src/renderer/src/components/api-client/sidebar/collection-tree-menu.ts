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
  | 'run-as-test'
  | 'run-cleanup-only'
  | 'export'
  | 'load-test-map'
  | 'export-test-map'
  | 'remove-test-map'

export type RowMenuEntry = {
  action: RowAction
  label: string
  destructive?: boolean
  separatorBefore?: boolean
}

export type TestMapMenuState = 'unavailable' | 'none' | 'loaded'

/** One list drives both the right-click menu and the row's "more" button. */
export function buildRowMenuEntries(
  row: TreeRow,
  testMap: TestMapMenuState = 'unavailable',
  hasUncleaned = false
): RowMenuEntry[] {
  const entries: RowMenuEntry[] = []
  if (row.kind !== 'request') {
    entries.push(
      { action: 'new-request', label: translate('apiClient.tree.newRequest', 'New request') },
      { action: 'new-folder', label: translate('apiClient.tree.newFolder', 'New folder') },
      { action: 'run', label: translate('apiClient.tree.run', 'Run…'), separatorBefore: true }
    )
    if (row.kind === 'collection' && testMap !== 'unavailable') {
      entries.push({
        action: 'run-as-test',
        label: translate('apiClient.testRun.runAsTest', 'Run as test…')
      })
      if (hasUncleaned) {
        entries.push({
          action: 'run-cleanup-only',
          label: translate('apiClient.testRun.cleanupOnly', 'Run cleanup only')
        })
      }
    }
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
    if (testMap !== 'unavailable') {
      entries.push({
        action: 'load-test-map',
        label: translate('apiClient.testMap.load', 'Load test map…'),
        separatorBefore: true
      })
      if (testMap === 'loaded') {
        entries.push(
          {
            action: 'export-test-map',
            label: translate('apiClient.testMap.export', 'Export test map…')
          },
          {
            action: 'remove-test-map',
            label: translate('apiClient.testMap.remove', 'Remove test map')
          }
        )
      }
    }
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
