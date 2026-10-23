// @vitest-environment happy-dom
import { act, Suspense } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { OpenFile } from '@/store/slices/editor'
import type { DiffContent } from './editor-panel-content-types'

vi.mock('./DiffViewer', () => ({
  default: () => <div data-testid="diff-viewer" />
}))
vi.mock('./explanation-diff/ExplanationDiffFrame', () => ({
  default: ({
    children
  }: {
    children: (props: {
      renderEditorOverlay: undefined
      onAddLineComment: () => void
    }) => React.ReactNode
  }) => (
    <div data-testid="explanation-frame">
      {children({ renderEditorOverlay: undefined, onAddLineComment: () => {} })}
    </div>
  )
}))

import { EditorDiffFileSurface } from './EditorDiffFileSurface'

const diffContent: DiffContent = {
  kind: 'text',
  originalContent: 'a\n',
  modifiedContent: 'b\n',
  originalIsBinary: false,
  modifiedIsBinary: false
}

function renderSurface(activeFile: OpenFile): Promise<void> {
  return act(async () => {
    root?.render(
      <Suspense fallback={null}>
        <EditorDiffFileSurface
          activeFile={activeFile}
          diffContent={diffContent}
          editBuffer={undefined}
          resolvedLanguage="plaintext"
          sideBySide
          viewStateScopeId="scope"
          diffViewStateKey="key"
          mdViewMode="source"
          isMarkdown={false}
          showMarkdownTableOfContents={false}
          onCloseMarkdownTableOfContents={() => {}}
          markdownAnnotationsEnabled={false}
          // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the plain-text diff path never reads the markdown controller.
          markdownDocuments={{} as never}
          onContentChange={() => {}}
          onSave={async () => true}
          reloadContent={() => {}}
        />
      </Suspense>
    )
  })
}

function diffFile(diffSource: OpenFile['diffSource'], withRef: boolean): OpenFile {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: test double only needs the members the surface reads.
  return {
    id: 'file-1',
    filePath: '/repo/a.ts',
    relativePath: 'a.ts',
    worktreeId: 'repo::/repo',
    language: 'typescript',
    isDirty: false,
    mode: 'diff',
    diffSource,
    ...(withRef ? { explanationRef: { explanationId: 'e1', mergeBase: 'abc' } } : {})
  } as OpenFile
}

let container: HTMLDivElement | null = null
let root: Root | null = null

describe('EditorDiffFileSurface explanation gating (FR-015)', () => {
  afterEach(() => {
    act(() => root?.unmount())
    container?.remove()
    container = null
    root = null
  })

  function mount(): void {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  }

  it('wraps the diff in the explanation frame only for explanation diffs', async () => {
    mount()
    await renderSurface(diffFile('explanation', true))
    expect(container?.querySelector('[data-testid="explanation-frame"]')).not.toBeNull()
    expect(container?.querySelector('[data-testid="diff-viewer"]')).not.toBeNull()
  })

  it.each(['unstaged', 'staged', 'branch', 'combined-uncommitted'] as const)(
    'never mounts the explanation frame for %s diffs, even with a stray explanationRef',
    async (source) => {
      mount()
      await renderSurface(diffFile(source, true))
      expect(container?.querySelector('[data-testid="explanation-frame"]')).toBeNull()
      expect(container?.querySelector('[data-testid="diff-viewer"]')).not.toBeNull()
    }
  )

  it('does not mount the frame for an explanation diff that has no reference', async () => {
    mount()
    await renderSurface(diffFile('explanation', false))
    expect(container?.querySelector('[data-testid="explanation-frame"]')).toBeNull()
  })
})
