import type { editor } from 'monaco-editor'
import type { ReactNode } from 'react'
import type { LargeDiffRenderLimit } from './large-diff-render-limit'

export type DiffViewerProps = {
  modelKey: string
  originalModelKey?: string
  modifiedModelKey?: string
  originalContent: string
  modifiedContent: string
  language: string
  filePath: string
  relativePath: string
  sideBySide: boolean
  editable?: boolean
  // Why: optional because DiffViewer is also used by GitHubItemDialog for PR
  // review, where there is no local worktree to attach comments to.
  worktreeId?: string
  onAddLineComment?: (args: {
    lineNumber: number
    startLine?: number
    body: string
  }) => Promise<boolean>
  commentableLineNumbers?: readonly number[]
  addLineCommentLabel?: string
  addLineCommentPlaceholder?: string
  onContentChange?: (content: string) => void
  onSave?: (content: string) => void
  largeDiffRenderLimit?: LargeDiffRenderLimit
  // Why: main-process limited diffs intentionally blank text bodies before IPC;
  // the fallback must not treat that placeholder as a saveable draft.
  largeDiffSaveContentAvailable?: boolean
  // Why: lets a diff source (agent explanations) draw on the mounted editor without DiffViewer knowing it.
  renderEditorOverlay?: (diffEditor: editor.IStandaloneDiffEditor) => ReactNode
}
