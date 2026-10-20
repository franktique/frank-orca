import React, { useCallback, useMemo } from 'react'
import { useAppStore } from '@/store'
import { ExplanationDiffOverlay, useExplanationFileItems } from './ExplanationDiffOverlay'
import { ExplanationNavFooter, useExplanationNavShortcuts } from './ExplanationNavFooter'
import { ExplanationQuestionSection } from './ExplanationQuestionSection'
import { resolveExplanationNoteScope } from './explanation-review-note-scope'
import { ExplanationDetachedList } from './explanation-detached-list'
import type { DiffViewerProps } from '../diff-viewer-props'
import type { ExplanationDiffRef } from '@/store/slices/editor'

type ExplanationDiffFrameProps = {
  worktreeId: string
  relativePath: string
  originalContent: string
  modifiedContent: string
  sideBySide: boolean
  explanationRef: ExplanationDiffRef
  children: (props: {
    renderEditorOverlay: DiffViewerProps['renderEditorOverlay']
    onAddLineComment: NonNullable<DiffViewerProps['onAddLineComment']>
  }) => React.ReactNode
}

function ExplanationItemFooter({
  workspaceId,
  itemId
}: {
  workspaceId: string
  itemId: string
}): React.JSX.Element {
  return (
    <>
      <ExplanationQuestionSection workspaceId={workspaceId} itemId={itemId} />
      <ExplanationNavFooter workspaceId={workspaceId} itemId={itemId} />
    </>
  )
}

/** Explanation diff chrome: items with no line to point at sit above the editor, markers inside it. */
export default function ExplanationDiffFrame({
  worktreeId,
  relativePath,
  originalContent,
  modifiedContent,
  sideBySide,
  explanationRef,
  children
}: ExplanationDiffFrameProps): React.JSX.Element {
  const items = useExplanationFileItems(worktreeId, relativePath, originalContent, modifiedContent)
  const detached = useMemo(() => items.filter((entry) => entry.kind === 'detached'), [items])
  useExplanationNavShortcuts(worktreeId)
  const addDiffComment = useAppStore((s) => s.addDiffComment)
  const gitStatusEntries = useAppStore((s) => s.gitStatusByWorktree?.[worktreeId])
  // Why: notes join the workspace's single collection; the scope names the Source Control view
  // that shows the same line so mobile review keeps resolving them.
  const noteScope = resolveExplanationNoteScope(gitStatusEntries, relativePath)
  const handleAddLineComment = useCallback<NonNullable<DiffViewerProps['onAddLineComment']>>(
    async ({ lineNumber, startLine, body }) => {
      const result = await addDiffComment({
        worktreeId,
        filePath: relativePath,
        source: 'diff',
        startLine,
        lineNumber,
        body,
        side: 'modified',
        scope: noteScope
      })
      return result !== null
    },
    [addDiffComment, noteScope, relativePath, worktreeId]
  )
  return (
    <div className="flex h-full min-h-0 flex-col">
      <ExplanationDetachedList
        items={detached}
        renderItemFooter={(entry) => (
          <ExplanationItemFooter workspaceId={worktreeId} itemId={entry.item.id} />
        )}
      />
      <div className="flex min-h-0 flex-1 flex-col">
        {children({
          onAddLineComment: handleAddLineComment,
          renderEditorOverlay: (diffEditor) => (
            <ExplanationDiffOverlay
              diffEditor={diffEditor}
              worktreeId={worktreeId}
              relativePath={relativePath}
              originalContent={originalContent}
              modifiedContent={modifiedContent}
              sideBySide={sideBySide}
              explanationRef={explanationRef}
              renderCardFooter={(entry) => (
                <ExplanationItemFooter workspaceId={worktreeId} itemId={entry.item.id} />
              )}
            />
          )
        })}
      </div>
    </div>
  )
}
