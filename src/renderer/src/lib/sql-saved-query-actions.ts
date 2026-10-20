import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'

/** First 40 characters of the SQL after collapsing whitespace — the default name of a new query. */
export function defaultSavedQueryName(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim().slice(0, 40)
}

function report(message: string): void {
  toast.error(message)
}

/** Saves the draft into the query it was loaded from; false when it could not be saved. */
export async function saveSqlTabInPlace(tabId: string): Promise<boolean> {
  const state = useAppStore.getState()
  const tab = state.sqlTabsById[tabId]
  const projectKey = tab ? state.sqlProjectKeyByWorktree[tab.worktreeId] : undefined
  const query = projectKey
    ? state.sqlSnapshotsByProject[projectKey]?.queries.find((q) => q.id === tab?.savedQueryId)
    : undefined
  if (!tab || !tab.connectionId || !query) {
    return false
  }
  const result = await window.api.sqlClient.saveQuery({
    worktreeId: tab.worktreeId,
    id: query.id,
    baseRevision: tab.savedQueryRevision ?? query.revision,
    connectionId: tab.connectionId,
    collectionId: query.collectionId,
    name: query.name,
    sql: tab.draftText
  })
  if (!result.ok) {
    report(
      result.code === 'conflict'
        ? translate(
            'sqlClient.saved.conflict',
            'This query was changed elsewhere. Reload it, or save as a new query.'
          )
        : result.message
    )
    return false
  }
  state.updateSqlTab(tabId, {
    savedQueryId: result.query.id,
    savedQueryRevision: result.query.revision
  })
  await state.loadSqlSnapshot(tab.worktreeId)
  return true
}

/** Saves the draft as a new query, creating `newCollectionName` first when given. */
export async function saveSqlTabAs(
  tabId: string,
  input: { name: string; collectionId: string | null; newCollectionName?: string }
): Promise<boolean> {
  const state = useAppStore.getState()
  const tab = state.sqlTabsById[tabId]
  if (!tab?.connectionId) {
    return false
  }
  let collectionId = input.collectionId
  if (input.newCollectionName) {
    const created = await window.api.sqlClient.createCollection({
      worktreeId: tab.worktreeId,
      connectionId: tab.connectionId,
      name: input.newCollectionName
    })
    if (!created.ok) {
      report(created.message)
      return false
    }
    collectionId = created.collection.id
  }
  const result = await window.api.sqlClient.saveQuery({
    worktreeId: tab.worktreeId,
    connectionId: tab.connectionId,
    collectionId,
    name: input.name,
    sql: tab.draftText
  })
  if (!result.ok) {
    report(result.message)
    return false
  }
  state.updateSqlTab(tabId, {
    savedQueryId: result.query.id,
    savedQueryRevision: result.query.revision
  })
  await state.loadSqlSnapshot(tab.worktreeId)
  return true
}
