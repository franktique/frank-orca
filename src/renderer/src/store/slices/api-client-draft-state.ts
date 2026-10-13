import type {
  ApiNodeId,
  ApiRequest,
  Collection,
  WorktreeApiData
} from '../../../../shared/api-client/api-client-types'
import { findNode } from '../../../../shared/api-client/collection-tree'
import type { EnvironmentDraft } from './api-client-environment-draft'

/** Unsaved edits of one request in one tab (FR-003a). Saved data stays shared between tabs. */
export type RequestDraft = {
  kind: 'request'
  requestId: ApiNodeId
  collectionId: ApiNodeId
  request: ApiRequest
  /** Revision of the request this draft was started from. */
  baseRevision: number
  /** The saved request moved on while this draft was open. */
  changedElsewhere: boolean
  /** The last save was refused because of `changedElsewhere`. */
  conflict: boolean
}

export type ApiClientDraft = RequestDraft | EnvironmentDraft

export function findStoredRequest(
  snapshot: WorktreeApiData | undefined,
  requestId: ApiNodeId
): { collection: Collection; request: ApiRequest } | null {
  for (const collection of snapshot?.collections ?? []) {
    const found = findNode(collection, requestId)
    if (found?.node.kind === 'request') {
      return { collection, request: found.node }
    }
  }
  return null
}

/** Revision bumps on save, so equality ignores it. */
function comparable(request: ApiRequest): string {
  return JSON.stringify({ ...request, revision: 0 })
}

export function isRequestUnchanged(draft: ApiRequest, stored: ApiRequest): boolean {
  return comparable(draft) === comparable(stored)
}

export function startRequestDraft(
  stored: { collection: Collection; request: ApiRequest },
  edited: ApiRequest
): RequestDraft {
  return {
    kind: 'request',
    requestId: stored.request.id,
    collectionId: stored.collection.id,
    request: edited,
    baseRevision: stored.request.revision,
    changedElsewhere: false,
    conflict: false
  }
}

/**
 * Marks drafts whose saved request changed in another tab, so the editor can offer a reload
 * instead of silently overwriting (multi-tab edge case).
 */
export function flagChangedDrafts(
  drafts: Record<string, ApiClientDraft | undefined>,
  worktreeId: string,
  tabWorktreeIds: Record<string, string | undefined>,
  snapshot: WorktreeApiData
): Record<string, ApiClientDraft | undefined> {
  let changed = false
  const next = { ...drafts }
  for (const [tabId, draft] of Object.entries(drafts)) {
    if (!draft || tabWorktreeIds[tabId] !== worktreeId) {
      continue
    }
    const moved =
      draft.kind === 'request'
        ? (findStoredRequest(snapshot, draft.requestId)?.request.revision ?? null) !==
          draft.baseRevision
        : (snapshot.environments.find((env) => env.id === draft.environmentId)?.revision ??
            null) !== draft.baseRevision
    if (moved !== draft.changedElsewhere) {
      next[tabId] = { ...draft, changedElsewhere: moved }
      changed = true
    }
  }
  return changed ? next : drafts
}
