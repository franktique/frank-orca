import type { StateCreator } from 'zustand'
import type { AppState } from '../types'
import type { FileReviewRecord } from '../../../../shared/file-review-types'
import type { FolderWorkspace } from '../../../../shared/folder-workspace-types'
import type { Worktree } from '../../../../shared/worktree/types'
import { getRepoIdFromWorktreeId } from './worktree-helpers'
import { callRuntimeRpc, getActiveRuntimeTarget } from '../../runtime/runtime-rpc-client'
import { toRuntimeWorktreeSelector } from '../../runtime/runtime-worktree-selector'
import { settingsForWorktreeOwner } from './worktree-settings-owner'
import {
  findFolderWorkspaceOwner,
  getExecutionHostIdForFolderWorkspace,
  getRuntimeEnvironmentIdForFolderWorkspace
} from '@/lib/folder-workspace-runtime-owner'
import { parseWorkspaceKey } from '../../../../shared/workspace-scope'

// Why: the Source Control panel tracks a "reviewed" checkbox for two independent
// sections (uncommitted Changes vs. Committed on Branch); each gets its own field
// and its own persistence queue below so a write to one never blocks or races the other.
export type ReviewedFilesField = 'reviewedChangedFiles' | 'reviewedBranchFiles'

async function persist(
  state: AppState,
  settings: AppState['settings'],
  worktreeId: string,
  field: ReviewedFilesField,
  value: FileReviewRecord,
  folderExecutionHostId?: ReturnType<typeof getExecutionHostIdForFolderWorkspace>
): Promise<void> {
  const scope = parseWorkspaceKey(worktreeId)
  if (scope?.type === 'folder') {
    const executionHostId =
      folderExecutionHostId ?? getExecutionHostIdForFolderWorkspace(state, scope.folderWorkspaceId)
    const runtimeEnvironmentId = getRuntimeEnvironmentIdForFolderWorkspace(
      state,
      scope.folderWorkspaceId,
      executionHostId
    )
    const target = getActiveRuntimeTarget({
      activeRuntimeEnvironmentId: runtimeEnvironmentId
    })
    const updated =
      target.kind === 'local'
        ? await window.api.folderWorkspaces.update({
            folderWorkspaceId: scope.folderWorkspaceId,
            updates: { [field]: value }
          })
        : (
            await callRuntimeRpc<{ folderWorkspace: FolderWorkspace | null }>(
              target,
              'folderWorkspace.update',
              {
                folderWorkspaceId: scope.folderWorkspaceId,
                updates: { [field]: value }
              },
              { timeoutMs: 15_000 }
            )
          ).folderWorkspace
    if (!updated || updated[field] === undefined) {
      throw new Error(`Failed to persist ${field}`)
    }
    return
  }
  const target = getActiveRuntimeTarget(settings)
  if (target.kind === 'local') {
    await window.api.worktrees.updateMeta({
      worktreeId,
      updates: { [field]: value }
    })
    return
  }
  await callRuntimeRpc(
    target,
    'worktree.set',
    { worktree: toRuntimeWorktreeSelector(worktreeId), [field]: value },
    { timeoutMs: 15_000 }
  )
}

// Why: IPC writes aren't ordered, so serialize per worktree+field to stop an older
// snapshot from overwriting a newer one on disk (mirrors diff-comment-persistence.ts).
const persistQueueByKey = new Map<string, Promise<void>>()
const lastPersistedByQueue = new Map<string, FileReviewRecord | undefined>()
const lastMutationNextByQueue = new Map<string, FileReviewRecord>()
const floorSeedEpochByQueue = new Map<string, number>()

export type ReviewedFilesMutation = {
  previous: FileReviewRecord | undefined
  next: FileReviewRecord
  folderExecutionHostId?: ReturnType<typeof getExecutionHostIdForFolderWorkspace>
}

function persistQueueKey(
  worktreeId: string,
  field: ReviewedFilesField,
  folderExecutionHostId?: ReturnType<typeof getExecutionHostIdForFolderWorkspace>
): string {
  const base = folderExecutionHostId ? `${folderExecutionHostId}\0${worktreeId}` : worktreeId
  return `${base}\0${field}`
}

// Why: same ordering/rollback contract as enqueueDiffCommentPersist — see that file's
// comments for the reasoning behind each bookkeeping map.
export function enqueueReviewedFilesPersist(
  set: Parameters<StateCreator<AppState>>[0],
  worktreeId: string,
  field: ReviewedFilesField,
  get: () => AppState,
  mutation: ReviewedFilesMutation
): Promise<void> {
  const folderExecutionHostId = mutation.folderExecutionHostId
  const queueKey = persistQueueKey(worktreeId, field, folderExecutionHostId)
  const prior = persistQueueByKey.get(queueKey) ?? Promise.resolve()
  const chainBroken = lastMutationNextByQueue.get(queueKey) !== mutation.previous
  if (!persistQueueByKey.has(queueKey) || chainBroken) {
    lastPersistedByQueue.set(queueKey, mutation.previous)
    floorSeedEpochByQueue.set(queueKey, (floorSeedEpochByQueue.get(queueKey) ?? 0) + 1)
  }
  lastMutationNextByQueue.set(queueKey, mutation.next)
  const run = async (): Promise<void> => {
    const seedEpoch = floorSeedEpochByQueue.get(queueKey)
    let stateValue: FileReviewRecord | undefined
    try {
      const scope = parseWorkspaceKey(worktreeId)
      if (scope?.type === 'folder') {
        const state = get()
        const folderWorkspace = findFolderWorkspaceOwner(
          state,
          scope.folderWorkspaceId,
          folderExecutionHostId
        )
        stateValue = folderWorkspace?.[field]
        await persist(
          state,
          state.settings,
          worktreeId,
          field,
          stateValue ?? {},
          folderExecutionHostId
        )
      } else {
        const repoId = getRepoIdFromWorktreeId(worktreeId)
        const target = get().worktreesByRepo[repoId]?.find((w) => w.id === worktreeId)
        stateValue = target?.[field]
        const state = get()
        await persist(
          state,
          settingsForWorktreeOwner(state, worktreeId),
          worktreeId,
          field,
          stateValue ?? {}
        )
      }
    } catch (err) {
      const floor = lastPersistedByQueue.has(queueKey)
        ? lastPersistedByQueue.get(queueKey)
        : mutation.previous
      rollback(set, worktreeId, field, floor, mutation.next, folderExecutionHostId)
      throw err
    }
    if (floorSeedEpochByQueue.get(queueKey) === seedEpoch) {
      lastPersistedByQueue.set(queueKey, stateValue)
    }
  }
  const next = prior.then(run, run)
  persistQueueByKey.set(queueKey, next)
  const cleanup = (): void => {
    if (persistQueueByKey.get(queueKey) === next) {
      persistQueueByKey.delete(queueKey)
      lastPersistedByQueue.delete(queueKey)
      lastMutationNextByQueue.delete(queueKey)
      floorSeedEpochByQueue.delete(queueKey)
    }
  }
  next.then(cleanup, cleanup)
  return next
}

// Why: derive the next record inside the `set` updater so concurrent writes can't clobber each other via a stale closure.
export function mutateReviewedFiles(
  set: Parameters<StateCreator<AppState>>[0],
  worktreeId: string,
  field: ReviewedFilesField,
  mutate: (existing: FileReviewRecord) => FileReviewRecord | null
): ReviewedFilesMutation | null {
  const repoId = getRepoIdFromWorktreeId(worktreeId)
  let previous: FileReviewRecord | undefined
  let next: FileReviewRecord | null = null
  let folderExecutionHostId: ReturnType<typeof getExecutionHostIdForFolderWorkspace> | undefined
  set((s) => {
    const scope = parseWorkspaceKey(worktreeId)
    if (scope?.type === 'folder') {
      const target = findFolderWorkspaceOwner(s, scope.folderWorkspaceId)
      if (!target) {
        return s
      }
      folderExecutionHostId = getExecutionHostIdForFolderWorkspace(s, scope.folderWorkspaceId)
      previous = target[field]
      const computed = mutate(previous ?? {})
      if (computed === null) {
        return s
      }
      next = computed
      return {
        folderWorkspaces: s.folderWorkspaces.map((workspace) =>
          workspace === target ? { ...workspace, [field]: computed } : workspace
        )
      }
    }
    const repoList = s.worktreesByRepo[repoId]
    if (!repoList) {
      return s
    }
    const target = repoList.find((w) => w.id === worktreeId)
    if (!target) {
      return s
    }
    previous = target[field]
    const computed = mutate(previous ?? {})
    if (computed === null) {
      return s
    }
    next = computed
    const nextList: Worktree[] = repoList.map((w) =>
      w.id === worktreeId ? { ...w, [field]: computed } : w
    )
    return { worktreesByRepo: { ...s.worktreesByRepo, [repoId]: nextList } }
  })
  if (next === null) {
    return null
  }
  return { previous, next, folderExecutionHostId }
}

function rollback(
  set: Parameters<StateCreator<AppState>>[0],
  worktreeId: string,
  field: ReviewedFilesField,
  previous: FileReviewRecord | undefined,
  expectedCurrent: FileReviewRecord,
  folderExecutionHostId?: ReturnType<typeof getExecutionHostIdForFolderWorkspace>
): void {
  const repoId = getRepoIdFromWorktreeId(worktreeId)
  set((s) => {
    const scope = parseWorkspaceKey(worktreeId)
    if (scope?.type === 'folder') {
      const target = findFolderWorkspaceOwner(s, scope.folderWorkspaceId, folderExecutionHostId)
      if (!target || target[field] !== expectedCurrent) {
        return s
      }
      return {
        folderWorkspaces: s.folderWorkspaces.map((workspace) =>
          workspace === target ? { ...workspace, [field]: previous } : workspace
        )
      }
    }
    const repoList = s.worktreesByRepo[repoId]
    if (!repoList) {
      return s
    }
    const target = repoList.find((w) => w.id === worktreeId)
    if (!target) {
      return s
    }
    if (target[field] !== expectedCurrent) {
      return s
    }
    const nextList: Worktree[] = repoList.map((w) =>
      w.id === worktreeId ? { ...w, [field]: previous } : w
    )
    return { worktreesByRepo: { ...s.worktreesByRepo, [repoId]: nextList } }
  })
}
