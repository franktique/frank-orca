import type { ApiItem, Collection } from '../../../../../shared/api-client/api-client-types'

export type TreeRow =
  | {
      kind: 'collection' | 'folder'
      id: string
      collectionId: string
      name: string
      depth: number
      expanded: boolean
      hasChildren: boolean
    }
  | {
      kind: 'request'
      id: string
      collectionId: string
      name: string
      depth: number
      method: string
    }

function matches(name: string, needle: string): boolean {
  return name.toLowerCase().includes(needle)
}

function subtreeMatches(items: readonly ApiItem[], needle: string): boolean {
  return items.some(
    (item) =>
      matches(item.name, needle) || (item.kind === 'folder' && subtreeMatches(item.items, needle))
  )
}

/**
 * Flattens the visible part of every collection into rows (FR-006). With a search query the
 * tree shows matches plus their ancestors, expanded, regardless of the user's toggles.
 */
export function buildTreeRows(
  collections: readonly Collection[],
  expandedIds: ReadonlySet<string>,
  query: string
): TreeRow[] {
  const needle = query.trim().toLowerCase()
  const rows: TreeRow[] = []

  const visit = (items: readonly ApiItem[], collectionId: string, depth: number): void => {
    for (const item of items) {
      if (item.kind === 'request') {
        if (!needle || matches(item.name, needle)) {
          rows.push({
            kind: 'request',
            id: item.id,
            collectionId,
            name: item.name,
            depth,
            method: item.method
          })
        }
        continue
      }
      const selfMatches = !needle || matches(item.name, needle)
      const descendantMatches = needle ? subtreeMatches(item.items, needle) : false
      if (!selfMatches && !descendantMatches) {
        continue
      }
      const expanded = needle ? descendantMatches : expandedIds.has(item.id)
      rows.push({
        kind: 'folder',
        id: item.id,
        collectionId,
        name: item.name,
        depth,
        expanded,
        hasChildren: item.items.length > 0
      })
      if (expanded) {
        visit(item.items, collectionId, depth + 1)
      }
    }
  }

  for (const collection of collections) {
    const selfMatches = !needle || matches(collection.name, needle)
    const descendantMatches = needle ? subtreeMatches(collection.items, needle) : false
    if (!selfMatches && !descendantMatches) {
      continue
    }
    const expanded = needle ? descendantMatches : expandedIds.has(collection.id)
    rows.push({
      kind: 'collection',
      id: collection.id,
      collectionId: collection.id,
      name: collection.name,
      depth: 0,
      expanded,
      hasChildren: collection.items.length > 0
    })
    if (expanded) {
      visit(collection.items, collection.id, 1)
    }
  }
  return rows
}
