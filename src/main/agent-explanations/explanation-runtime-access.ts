import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import type { ChangeSetBase } from '../../shared/agent-explanations/explanation-types'
import type { TerminalWorkspaceLaunchScope } from '../runtime/runtime-legacy-worker-terminal-recovery-types'
import { readEmptyTreeOidForTarget, type ExplanationChangeSetDeps } from './explanation-change-set'
import type { ExplanationFileDiffDeps } from './explanation-file-diff'

// Runtime wiring shared by the explanation.* RPC methods and the renderer IPC channels,
// so both transports read the same change set and diffs.
export type ExplanationFailure = { ok: false; code: string; message: string }
export const explanationFailure = (code: string, message: string): ExplanationFailure => ({
  ok: false,
  code,
  message
})

type Resolved = { ok: true; workspaceId: string } | ExplanationFailure

/** Where explanations anchor: only git workspaces. Folder workspaces are refused up
 *  front so publish rejects before parsing, per contracts/cli-rpc.md. */
export async function resolveExplanationWorkspace(
  runtime: OrcaRuntimeService,
  worktree?: string
): Promise<Resolved> {
  if (!worktree) {
    return explanationFailure(
      'selector_not_found',
      'No worktree was given and none could be inferred.'
    )
  }
  let scope: TerminalWorkspaceLaunchScope
  try {
    scope = await runtime.showTerminalWorkspaceLaunchScope(worktree)
  } catch {
    return explanationFailure('selector_not_found', `No workspace matches "${worktree}".`)
  }
  if (scope.folderWorkspace) {
    return explanationFailure(
      'not_git_workspace',
      'This workspace is a folder, not a git repository, so there is no change set to explain.'
    )
  }
  return { ok: true, workspaceId: scope.id }
}

export function explanationChangeSetDeps(runtime: OrcaRuntimeService): ExplanationChangeSetDeps {
  return {
    resolveTarget: (selector) => runtime.showRuntimeGitTarget(selector),
    branchCompare: (selector, baseRef) => runtime.getRuntimeGitBranchCompare(selector, baseRef),
    status: (selector) => runtime.getRuntimeGitStatus(selector),
    worktreeMeta: (target) => {
      try {
        return runtime.showManagedWorktreeMetaForHost(target.worktree.id, target.executionHostId)
      } catch {
        // Why: without a store, the base ref still resolves from the repo row.
        return undefined
      }
    },
    emptyTreeOid: (target) => readEmptyTreeOidForTarget(target)
  }
}

export function explanationFileDiffDeps(
  runtime: OrcaRuntimeService,
  maxContentBytes?: number
): ExplanationFileDiffDeps {
  return {
    diff: (selector, filePath, leftOid) =>
      runtime.getRuntimeGitDiff(selector, filePath, false, false, maxContentBytes, leftOid)
  }
}

export function explanationFileDiffBase(mergeBase: string): ChangeSetBase {
  // Why: only `mergeBase` is read here — the left side is the merge base for every base kind.
  return { kind: 'uncommitted-only', baseRef: null, mergeBase, headOid: null }
}
