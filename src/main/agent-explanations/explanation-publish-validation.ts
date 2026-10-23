/** Per-item payload validation against the workspace change set (research R4). */
import type { ExplanationPublishPayload } from '../../shared/agent-explanations/explanation-schemas'
import { EXPLANATION_ITEM_TEXT_MAX } from '../../shared/agent-explanations/explanation-schemas'
import type {
  ChangeSetFile,
  LineAnchor,
  PublishIssue
} from '../../shared/agent-explanations/explanation-types'
import type { ExplanationChangeSetSnapshot } from './explanation-change-set'
import type { ExplanationPublishDeps } from './explanation-publish'
import { readSides, resolveLineAnchors } from './explanation-line-anchor-resolution'
import { normalizeRuntimeGitRelativePath } from '../runtime/runtime-git-command-target'

/** Contract: leading `./` and backslashes are normalized; anything unsafe is rejected. */
function normalizePayloadPath(rawPath: string): string | null {
  try {
    return normalizeRuntimeGitRelativePath(rawPath.replace(/\\/g, '/').replace(/^(\.\/)+/, ''))
  } catch {
    return null
  }
}

type PendingItem = {
  itemIndex: number
  clientId?: string
  side: 'new' | 'old'
  text: string
  startLine?: number
  endLine?: number
}

export type ResolvedItem = {
  clientId?: string
  text: string
  anchor: LineAnchor | { fileLevel: true }
}

export type PendingFile = {
  path: string
  changeSetFile: ChangeSetFile
  items: PendingItem[]
  resolved: ResolvedItem[]
}

export type SurvivingChange = {
  title: string
  summary: string
  files: PendingFile[]
}

type Validation = {
  surviving: SurvivingChange[]
  rejected: PublishIssue[]
  warnings: PublishIssue[]
}

export async function validatePayload(
  selector: string,
  changes: ExplanationPublishPayload['changes'],
  snapshot: ExplanationChangeSetSnapshot,
  deps: ExplanationPublishDeps
): Promise<Validation> {
  const rejected: PublishIssue[] = []
  const warnings: PublishIssue[] = []
  const filesByPath = new Map(snapshot.files.map((file) => [file.path, file]))
  const renamedToPath = new Map(
    snapshot.files.flatMap((file) => (file.oldPath ? [[file.oldPath, file.path] as const] : []))
  )
  const surviving: SurvivingChange[] = changes.map((change) => ({
    title: change.title,
    summary: change.summary,
    files: []
  }))
  const pathsNeedingContent = new Set<string>()

  for (const [changeIndex, change] of changes.entries()) {
    for (const [fileIndex, file] of change.files.entries()) {
      const normalizedPath = normalizePayloadPath(file.path)
      if (!normalizedPath) {
        rejected.push({
          code: 'file_not_in_change_set',
          message: `Path "${file.path}" is not a valid repo-relative path.`,
          changeIndex,
          fileIndex,
          path: file.path
        })
        continue
      }
      const changeSetFile = filesByPath.get(normalizedPath)
      if (!changeSetFile) {
        const renamedTo = renamedToPath.get(normalizedPath)
        rejected.push({
          code: 'file_not_in_change_set',
          message: renamedTo
            ? `Path "${normalizedPath}" is not in the change set; it was renamed to "${renamedTo}". Anchor the new path.`
            : `Path "${normalizedPath}" is not in the change set.`,
          changeIndex,
          fileIndex,
          path: normalizedPath
        })
        continue
      }
      let target = surviving[changeIndex].files.find((entry) => entry.path === normalizedPath)
      if (target) {
        warnings.push({
          code: 'duplicate_file_in_change',
          message: `Path "${normalizedPath}" appears more than once in change ${changeIndex + 1}; its items are merged into the first entry.`,
          changeIndex,
          fileIndex,
          path: normalizedPath
        })
      } else {
        target = { path: normalizedPath, changeSetFile, items: [], resolved: [] }
        surviving[changeIndex].files.push(target)
      }
      for (const [itemIndex, item] of file.items.entries()) {
        collectItem(
          item,
          itemIndex,
          changeIndex,
          fileIndex,
          target,
          changeSetFile,
          rejected,
          pathsNeedingContent
        )
      }
    }
  }

  const sidesByPath = await readSides(
    selector,
    [...pathsNeedingContent],
    snapshot.base.mergeBase,
    deps
  )
  resolveLineAnchors(surviving, sidesByPath, rejected, warnings)

  // Path rejections happen during the walk, line rejections after; report both in payload order.
  const byPosition = (issue: PublishIssue): number =>
    (issue.changeIndex ?? -1) * 10_000 + (issue.fileIndex ?? -1) * 100 + (issue.itemIndex ?? -1)
  return {
    surviving,
    rejected: rejected.sort((a, b) => byPosition(a) - byPosition(b)),
    warnings: warnings.sort((a, b) => byPosition(a) - byPosition(b))
  }
}

function collectItem(
  item: ExplanationPublishPayload['changes'][number]['files'][number]['items'][number],
  itemIndex: number,
  changeIndex: number,
  fileIndex: number,
  target: PendingFile,
  changeSetFile: ChangeSetFile,
  rejected: PublishIssue[],
  pathsNeedingContent: Set<string>
): void {
  const issueBase = {
    changeIndex,
    fileIndex,
    itemIndex,
    path: target.path,
    ...(item.id ? { clientId: item.id } : {})
  }
  if (item.side === 'old' && changeSetFile.status === 'added') {
    rejected.push({
      code: 'side_unavailable',
      message: `File "${target.path}" is added, so there is no old side to anchor.`,
      ...issueBase
    })
    return
  }
  if (item.side === 'new' && changeSetFile.status === 'deleted') {
    rejected.push({
      code: 'side_unavailable',
      message: `File "${target.path}" is deleted, so there is no new side to anchor.`,
      ...issueBase
    })
    return
  }
  if (item.text.length === 0) {
    rejected.push({ code: 'text_empty', message: 'Item text must not be empty.', ...issueBase })
    return
  }
  if (item.text.length > EXPLANATION_ITEM_TEXT_MAX) {
    rejected.push({
      code: 'text_too_long',
      message: `Item text is ${item.text.length} characters; the limit is ${EXPLANATION_ITEM_TEXT_MAX}.`,
      ...issueBase
    })
    return
  }
  if (item.startLine !== undefined || item.endLine !== undefined) {
    pathsNeedingContent.add(target.path)
  }
  target.items.push({
    itemIndex,
    ...(item.id ? { clientId: item.id } : {}),
    side: item.side,
    text: item.text,
    startLine: item.startLine,
    endLine: item.endLine
  })
}
