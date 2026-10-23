import type { DiffReviewScope } from '../../../../../shared/diff-comment-types'
import type { GitStatusEntry } from '../../../../../shared/git-status-types'

/**
 * Review-note scope for a note added on the modified side of an explanation diff, which always
 * shows the working tree. It names the Source Control view that shows the same line: the
 * unstaged diff while the working tree differs from the index, the staged diff once everything
 * is staged, and the branch diff when the change is already committed.
 */
export function resolveExplanationNoteScope(
  entries: readonly GitStatusEntry[] | undefined,
  relativePath: string
): DiffReviewScope {
  const forFile = (entries ?? []).filter((entry) => entry.path === relativePath)
  if (forFile.some((entry) => entry.area === 'unstaged' || entry.area === 'untracked')) {
    return 'unstaged'
  }
  return forFile.some((entry) => entry.area === 'staged') ? 'staged' : 'branch'
}
