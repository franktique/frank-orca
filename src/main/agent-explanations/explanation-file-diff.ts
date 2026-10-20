/**
 * Per-file diff for agent change explanations (specs/002): merge-base (or the
 * uncommitted-only fallback — HEAD, or the empty tree for an unborn repo) blob
 * vs the working tree, through the runtime's provider routing.
 */
import type { GitDiffResult } from '../../shared/git-diff-compare-types'
import type { ChangeSetBase } from '../../shared/agent-explanations/explanation-types'
import { normalizeRuntimeGitRelativePath } from '../runtime/runtime-git-command-target'

export type ExplanationFileDiffDeps = {
  diff(selector: string, filePath: string, leftOid: string): Promise<GitDiffResult>
}

export async function readExplanationFileDiff(
  selector: string,
  rawPath: string,
  base: ChangeSetBase,
  deps: ExplanationFileDiffDeps
): Promise<GitDiffResult> {
  // Why: mergeBase is the left side for every base kind — for uncommitted-only it
  // is HEAD, and for an unborn repo the empty tree (every file then reads as added).
  return deps.diff(selector, normalizeRuntimeGitRelativePath(rawPath), base.mergeBase)
}
