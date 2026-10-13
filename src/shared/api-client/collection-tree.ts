import type { ApiFolder, ApiItem, ApiNodeId, ApiRequest, Collection } from './api-client-types'

export type TreeContainer = Pick<Collection | ApiFolder, 'items'>

export type FoundNode = {
  node: ApiItem
  /** Folders from the outermost down to the node's direct parent. */
  ancestors: ApiFolder[]
  parent: TreeContainer
  index: number
}

export function findNode(root: TreeContainer, nodeId: ApiNodeId): FoundNode | null {
  const walk = (container: TreeContainer, ancestors: ApiFolder[]): FoundNode | null => {
    for (let index = 0; index < container.items.length; index++) {
      const node = container.items[index]
      if (node.id === nodeId) {
        return { node, ancestors, parent: container, index }
      }
      if (node.kind === 'folder') {
        const found = walk(node, [...ancestors, node])
        if (found) {
          return found
        }
      }
    }
    return null
  }
  return walk(root, [])
}

/** Collection → outer folder → inner folder → the node itself (inclusive). */
export function getAncestorChain(
  collection: Collection,
  nodeId: ApiNodeId
): (Collection | ApiFolder | ApiRequest)[] | null {
  if (collection.id === nodeId) {
    return [collection]
  }
  const found = findNode(collection, nodeId)
  if (!found) {
    return null
  }
  return [collection, ...found.ancestors, found.node]
}

function collectRequests(items: ApiItem[], into: ApiRequest[]): void {
  for (const item of items) {
    if (item.kind === 'request') {
      into.push(item)
    } else {
      collectRequests(item.items, into)
    }
  }
}

/** Depth-first, in stored order (FR-021). A request scope yields just that request. */
export function flattenRequestsDepthFirst(
  scope: Collection | ApiFolder | ApiRequest
): ApiRequest[] {
  if ('kind' in scope && scope.kind === 'request') {
    return [scope]
  }
  const requests: ApiRequest[] = []
  collectRequests(scope.items, requests)
  return requests
}

export function flattenFolderPath(
  collection: Collection,
  requestId: ApiNodeId
): { request: ApiRequest; folderPath: string[] } | null {
  const found = findNode(collection, requestId)
  if (!found || found.node.kind !== 'request') {
    return null
  }
  return { request: found.node, folderPath: found.ancestors.map((folder) => folder.name) }
}

function resolveContainer(root: TreeContainer, parentId: ApiNodeId | null): TreeContainer | null {
  if (parentId === null) {
    return root
  }
  const found = findNode(root, parentId)
  return found && found.node.kind === 'folder' ? found.node : null
}

export function insertNode(
  root: TreeContainer,
  parentId: ApiNodeId | null,
  node: ApiItem,
  index?: number
): boolean {
  const container = resolveContainer(root, parentId)
  if (!container) {
    return false
  }
  const at = index === undefined ? container.items.length : Math.min(index, container.items.length)
  container.items.splice(at, 0, node)
  return true
}

function requestIdsOf(node: ApiItem): ApiNodeId[] {
  return flattenRequestsDepthFirst(node).map((request) => request.id)
}

export function removeNode(
  root: TreeContainer,
  nodeId: ApiNodeId
): { node: ApiItem; removedRequestIds: ApiNodeId[] } | null {
  const found = findNode(root, nodeId)
  if (!found) {
    return null
  }
  found.parent.items.splice(found.index, 1)
  return { node: found.node, removedRequestIds: requestIdsOf(found.node) }
}

export function moveNode(
  root: TreeContainer,
  nodeId: ApiNodeId,
  targetParentId: ApiNodeId | null,
  index?: number
): boolean {
  const found = findNode(root, nodeId)
  if (!found) {
    return false
  }
  // Why: moving a folder into itself or a descendant would detach the subtree.
  if (found.node.kind === 'folder') {
    if (targetParentId === nodeId || findNode(found.node, targetParentId ?? '') !== null) {
      return false
    }
  }
  if (!resolveContainer(root, targetParentId)) {
    return false
  }
  found.parent.items.splice(found.index, 1)
  return insertNode(root, targetParentId, found.node, index)
}

export function cloneWithFreshIds<T extends ApiItem>(node: T, newId: () => ApiNodeId): T {
  const copy = structuredClone(node)
  const reassign = (item: ApiItem): void => {
    item.id = newId()
    if (item.kind === 'folder') {
      item.items.forEach(reassign)
    }
  }
  reassign(copy)
  return copy
}

export function duplicateNode(
  root: TreeContainer,
  nodeId: ApiNodeId,
  newId: () => ApiNodeId
): ApiItem | null {
  const found = findNode(root, nodeId)
  if (!found) {
    return null
  }
  const copy = cloneWithFreshIds(found.node, newId)
  copy.name = `${copy.name} copy`
  found.parent.items.splice(found.index + 1, 0, copy)
  return copy
}

export function renameNode(root: TreeContainer, nodeId: ApiNodeId, name: string): boolean {
  const found = findNode(root, nodeId)
  if (!found) {
    return false
  }
  found.node.name = name
  return true
}

/** Folders a node may be moved into: every folder except the node and its descendants. */
export function listMoveTargets(
  collection: Collection,
  nodeId: ApiNodeId
): { id: ApiNodeId | null; name: string; depth: number }[] {
  const targets: { id: ApiNodeId | null; name: string; depth: number }[] = [
    { id: null, name: collection.name, depth: 0 }
  ]
  const walk = (items: ApiItem[], depth: number): void => {
    for (const item of items) {
      if (item.kind !== 'folder' || item.id === nodeId) {
        continue
      }
      targets.push({ id: item.id, name: item.name, depth })
      walk(item.items, depth + 1)
    }
  }
  walk(collection.items, 1)
  return targets
}

/** Ids of the node itself (when a folder) and every folder beneath it. */
export function collectFolderIds(root: TreeContainer | ApiItem): ApiNodeId[] {
  const ids: ApiNodeId[] = []
  const walk = (items: ApiItem[]): void => {
    for (const item of items) {
      if (item.kind === 'folder') {
        ids.push(item.id)
        walk(item.items)
      }
    }
  }
  if ('kind' in root) {
    if (root.kind === 'folder') {
      ids.push(root.id)
      walk(root.items)
    }
  } else {
    walk(root.items)
  }
  return ids
}
