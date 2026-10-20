import type { EditorGet, EditorSet } from '../types/editor-set-get'
import type { EditorSlice } from '../types/editor-slice'
import type { OpenFile } from '../types/open-file'
import { joinPath } from '@/lib/path'
import { buildDiffEditorFileId, withDiffContentReloadRequest } from '../file-ids/editor-file-ids'
import { resolveDiffRuntimeEnvironmentId } from '../git/diff-runtime-owner'
import { resolveEditorOpenTargetGroupId } from '../tabs/editor-open-target-group'
import {
  getReplaceablePreviewFileId,
  openWorkspaceEditorItem,
  removeEditorStateForReplacedPreview
} from '../tabs/workspace-editor-item'

export function createOpenExplanationDiff(
  set: EditorSet,
  get: EditorGet
): Pick<EditorSlice, 'openExplanationDiff'> {
  return {
    openExplanationDiff: (worktreeId, worktreePath, entry, explanationRef, language, options) => {
      const isPreview = options?.preview ?? false
      let editorItemTargetGroupId = options?.targetGroupId
      let editorItemFileId = ''
      set((s) => {
        const runtimeEnvironmentId = resolveDiffRuntimeEnvironmentId(
          s,
          worktreeId,
          options?.runtimeEnvironmentId
        )
        const id = buildDiffEditorFileId(
          worktreeId,
          'explanation',
          entry.path,
          runtimeEnvironmentId
        )
        editorItemFileId = id
        const targetGroupId =
          resolveEditorOpenTargetGroupId(s, worktreeId, options?.targetGroupId) ?? undefined
        editorItemTargetGroupId = targetGroupId
        const activate = {
          activeFileId: id,
          activeTabType: 'editor' as const,
          activeFileIdByWorktree: { ...s.activeFileIdByWorktree, [worktreeId]: id },
          activeTabTypeByWorktree: { ...s.activeTabTypeByWorktree, [worktreeId]: 'editor' as const }
        }
        const existing = s.openFiles.find((f) => f.id === id)
        if (existing) {
          // Why: a re-publish changes the merge base and ref, so the tab re-reads its content.
          const reopened = withDiffContentReloadRequest({
            ...existing,
            mode: 'diff' as const,
            diffSource: 'explanation' as const,
            explanationRef,
            branchOldPath: entry.oldPath,
            isPreview: isPreview ? existing.isPreview : false,
            runtimeEnvironmentId
          })
          return { openFiles: s.openFiles.map((f) => (f.id === id ? reopened : f)), ...activate }
        }
        const newFile: OpenFile = {
          id,
          filePath: joinPath(worktreePath, entry.path),
          relativePath: entry.path,
          worktreeId,
          language,
          isDirty: false,
          mode: 'diff',
          diffSource: 'explanation',
          explanationRef,
          branchOldPath: entry.oldPath,
          isPreview: isPreview || undefined,
          runtimeEnvironmentId
        }
        const replaceablePreviewId = isPreview
          ? getReplaceablePreviewFileId(s, worktreeId, targetGroupId)
          : null
        const replaceableIndex = replaceablePreviewId
          ? s.openFiles.findIndex((file) => file.id === replaceablePreviewId)
          : -1
        if (replaceableIndex !== -1) {
          return {
            openFiles: s.openFiles.map((file, index) =>
              index === replaceableIndex ? newFile : file
            ),
            ...removeEditorStateForReplacedPreview(s, s.openFiles[replaceableIndex], id),
            ...activate
          }
        }
        return { openFiles: [...s.openFiles, newFile], ...activate }
      })
      void openWorkspaceEditorItem(
        get(),
        editorItemFileId,
        worktreeId,
        entry.path,
        'diff',
        isPreview,
        editorItemTargetGroupId
      )
    }
  }
}
