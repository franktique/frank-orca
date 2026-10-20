/**
 * Workspace change set for agent change explanations (specs/002): merge-base →
 * working tree, per research R2. Pure logic plus one git probe (`readEmptyTreeOidForTarget`)
 * so tests can stub every dependency.
 */
import type { GitBranchCompareResult } from '../../shared/git-diff-compare-types'
import { projectGroupIdFromRepoId } from '../../shared/folder-workspace-worktree'
import type { GitFileStatus, GitStatusResult } from '../../shared/git-status-types'
import type { WorktreeMeta } from '../../shared/worktree/meta-types'
import type {
  ChangeSetBase,
  ChangeSetFile,
  ChangeSetFileStatus
} from '../../shared/agent-explanations/explanation-types'
import { gitExecFileAsync } from '../git/command-runner/git-exec-file'
import { getBaseRefDefault } from '../git/repo-default-base-ref'
import {
  localGitOptionsForTarget,
  requireRuntimeGitProvider,
  type RuntimeGitTarget
} from '../runtime/runtime-git-command-target'

export const NOT_GIT_WORKSPACE_ERROR = 'not_git_workspace'

export type ExplanationChangeSetDeps = {
  resolveTarget(selector: string): Promise<RuntimeGitTarget>
  branchCompare(selector: string, baseRef: string): Promise<GitBranchCompareResult>
  status(selector: string): Promise<GitStatusResult>
  /** Host-qualified: reads the metadata row the target's execution host owns. */
  worktreeMeta(target: RuntimeGitTarget): WorktreeMeta | undefined
  emptyTreeOid(target: RuntimeGitTarget): Promise<string>
}

export type ExplanationChangeSetSnapshot = {
  workspaceId: string
  base: ChangeSetBase
  files: ChangeSetFile[]
}

/**
 * The empty-tree oid for the repo's object format (SHA-1 and SHA-256 differ). Empty stdin
 * instead of /dev/null so it works on Windows; `hash-object` reads EOF as an empty object.
 */
export async function readEmptyTreeOidForTarget(target: RuntimeGitTarget): Promise<string> {
  const args = ['hash-object', '-t', 'tree', '--stdin']
  const provider = requireRuntimeGitProvider(target)
  if (provider) {
    const { stdout } = await provider.exec(args, target.worktree.path)
    return stdout.trim()
  }
  const { stdout } = await gitExecFileAsync(args, {
    cwd: target.worktree.path,
    stdin: '',
    ...localGitOptionsForTarget(target)
  })
  return stdout.trim()
}

/** `WorktreeMeta.baseRef` → `Repo.worktreeBaseRef` → repo default; null when unresolvable (SSH). */
async function resolveExplanationBaseRef(
  target: RuntimeGitTarget,
  deps: ExplanationChangeSetDeps
): Promise<string | null> {
  const meta = deps.worktreeMeta(target)
  if (meta?.baseRef) {
    return meta.baseRef
  }
  if (target.repo?.worktreeBaseRef) {
    return target.repo.worktreeBaseRef
  }
  // Why: the default-base probes run local Git, so a remote worktree without a pinned base
  // degrades to uncommitted-only instead of probing the wrong machine.
  if (!target.repo || target.executionHostId !== 'local') {
    return null
  }
  return getBaseRefDefault(target.repo.path, localGitOptionsForTarget(target))
}

function toChangeSetFileStatus(status: GitFileStatus): ChangeSetFileStatus {
  return status === 'untracked' ? 'added' : status
}

function fileFromEntry(entry: {
  path: string
  oldPath?: string
  status: GitFileStatus
}): ChangeSetFile {
  return entry.oldPath && entry.status === 'renamed'
    ? { path: entry.path, oldPath: entry.oldPath, status: 'renamed' }
    : { path: entry.path, status: toChangeSetFileStatus(entry.status) }
}

function filesFromStatus(status: GitStatusResult): ChangeSetFile[] {
  return status.entries.map(fileFromEntry)
}

function uncommittedOnly(
  workspaceId: string,
  headOid: string | null,
  mergeBase: string,
  status: GitStatusResult,
  forceAdded: boolean
): ExplanationChangeSetSnapshot {
  const files = filesFromStatus(status)
  if (forceAdded) {
    for (const file of files) {
      file.status = 'added'
      delete file.oldPath
    }
  }
  return {
    workspaceId,
    base: { kind: 'uncommitted-only', baseRef: null, mergeBase, headOid },
    files
  }
}

function unionWithUncommitted(
  committed: { path: string; status: ChangeSetFileStatus; oldPath?: string }[],
  status: GitStatusResult
): ChangeSetFile[] {
  const files = new Map<string, ChangeSetFile>()
  for (const entry of committed) {
    files.set(entry.path, fileFromEntry(entry))
  }
  for (const entry of status.entries) {
    const uncommittedStatus = toChangeSetFileStatus(entry.status)
    const existing = files.get(entry.path)
    if (!existing) {
      files.set(entry.path, fileFromEntry(entry))
      continue
    }
    // Why: merge-base → working tree is the ground truth, so a working-tree deletion outranks
    // the committed kind and a re-added branch deletion reads as modified, not deleted.
    if (uncommittedStatus === 'deleted') {
      existing.status = 'deleted'
      delete existing.oldPath
    } else if (existing.status === 'deleted') {
      existing.status = 'modified'
    }
  }
  return [...files.values()]
}

/**
 * Build the change set a publish validates against. Throws `not_git_workspace` for folder
 * workspaces; every other failure to establish a branch base degrades to `uncommitted-only`.
 */
export async function buildExplanationChangeSet(
  selector: string,
  deps: ExplanationChangeSetDeps
): Promise<ExplanationChangeSetSnapshot> {
  const target = await deps.resolveTarget(selector)
  if (projectGroupIdFromRepoId(target.worktree.repoId) !== null) {
    throw new Error(NOT_GIT_WORKSPACE_ERROR)
  }

  const workspaceId = target.worktree.id
  const status = await deps.status(selector)

  // Why: an unborn HEAD has no oid anywhere in the runtime, so an empty head is the cheapest
  // unborn signal; the empty tree stands in as merge-base for every unborn path.
  const headOid = status.head || target.worktree.git.head || null
  if (!headOid) {
    return uncommittedOnly(workspaceId, null, await deps.emptyTreeOid(target), status, true)
  }

  const baseRef = await resolveExplanationBaseRef(target, deps)
  if (!baseRef) {
    return uncommittedOnly(workspaceId, headOid, headOid, status, false)
  }

  const compare = await deps.branchCompare(selector, baseRef)
  const { summary } = compare
  if (summary.status === 'unborn-head') {
    return uncommittedOnly(workspaceId, null, await deps.emptyTreeOid(target), status, true)
  }
  if (summary.status !== 'ready' || !summary.mergeBase || !summary.headOid) {
    // invalid-base / no-merge-base / no usable base: only uncommitted changes are explainable.
    return uncommittedOnly(workspaceId, headOid, headOid, status, false)
  }
  if (summary.mergeBase === summary.headOid) {
    // Working directly on the base branch: the committed range is empty.
    return uncommittedOnly(workspaceId, headOid, headOid, status, false)
  }
  return {
    workspaceId,
    base: {
      kind: 'branch-and-uncommitted',
      baseRef,
      mergeBase: summary.mergeBase,
      headOid: summary.headOid
    },
    files: unionWithUncommitted(compare.entries, status)
  }
}
