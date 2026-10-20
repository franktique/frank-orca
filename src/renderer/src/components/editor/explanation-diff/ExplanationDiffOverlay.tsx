import React, { useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import type { editor } from 'monaco-editor'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import type { ExplanationDiffRef } from '@/store/slices/editor'
import { ExplanationCard } from './ExplanationCard'
import { ExplanationMarkerLane } from './ExplanationMarkerLane'
import { resolveExplanationFileItems, type ExplanationFileItem } from './explanation-file-items'
import {
  useExplanationCardZone,
  useExplanationLaneWidth,
  useExplanationMarkerPlacements
} from './use-explanation-diff-decorations'

type ExplanationDiffOverlayProps = {
  diffEditor: editor.IStandaloneDiffEditor
  worktreeId: string
  relativePath: string
  originalContent: string
  modifiedContent: string
  sideBySide: boolean
  explanationRef: ExplanationDiffRef
  /** Rendered inside the open card, below its text. */
  renderCardFooter?: (entry: ExplanationFileItem) => React.ReactNode
}

// Why: a tab restores and remounts; the open-time jump to an item must happen once per open.
const consumedFocusKeys = new Set<string>()

export function useExplanationFileItems(
  worktreeId: string,
  relativePath: string,
  originalContent: string,
  modifiedContent: string
): ExplanationFileItem[] {
  const explanation = useAppStore((s) => s.explanationsByWorkspace[worktreeId]?.explanation ?? null)
  return useMemo(
    () =>
      explanation
        ? resolveExplanationFileItems(explanation, relativePath, {
            original: originalContent,
            modified: modifiedContent
          })
        : [],
    [explanation, relativePath, originalContent, modifiedContent]
  )
}

export function ExplanationDiffOverlay({
  diffEditor,
  worktreeId,
  relativePath,
  originalContent,
  modifiedContent,
  sideBySide,
  explanationRef,
  renderCardFooter
}: ExplanationDiffOverlayProps): React.JSX.Element | null {
  const items = useExplanationFileItems(worktreeId, relativePath, originalContent, modifiedContent)
  const activeItemId = useAppStore(
    (s) => s.explanationsByWorkspace[worktreeId]?.activeItemId ?? null
  )
  const setActiveItem = useAppStore((s) => s.setActiveExplanationItem)

  const placements = useExplanationMarkerPlacements(diffEditor, items, sideBySide)
  useExplanationLaneWidth(diffEditor, placements)

  const activeEntry = useMemo(() => {
    const entry = items.find((candidate) => candidate.item.id === activeItemId)
    return entry?.kind === 'line' ? entry : null
  }, [items, activeItemId])
  const cardHost = useExplanationCardZone(diffEditor, activeEntry, sideBySide)

  // Open-time jump from the Explanations tab or the navigation buttons.
  const focusItemId = explanationRef.focusItemId
  useEffect(() => {
    if (!focusItemId) {
      return
    }
    const key = `${worktreeId}:${relativePath}:${explanationRef.explanationId}:${focusItemId}`
    if (consumedFocusKeys.has(key) || !items.some((entry) => entry.item.id === focusItemId)) {
      return
    }
    consumedFocusKeys.add(key)
    setActiveItem(worktreeId, focusItemId)
  }, [explanationRef.explanationId, focusItemId, items, relativePath, setActiveItem, worktreeId])

  // Bring the opened anchor into view once its zone exists.
  useEffect(() => {
    if (!activeEntry) {
      return
    }
    const target =
      activeEntry.anchor.side === 'old' && sideBySide
        ? diffEditor.getOriginalEditor()
        : diffEditor.getModifiedEditor()
    target.revealLineInCenterIfOutsideViewport(activeEntry.line)
  }, [activeEntry, diffEditor, sideBySide])

  const original = diffEditor.getOriginalEditor()
  const modified = diffEditor.getModifiedEditor()
  return (
    <>
      <ExplanationMarkerLane
        editor={original}
        placements={placements.filter((placement) => placement.editorSide === 'original')}
        activeItemId={activeItemId}
        onSelect={(itemId) => setActiveItem(worktreeId, itemId === activeItemId ? null : itemId)}
      />
      <ExplanationMarkerLane
        editor={modified}
        placements={placements.filter((placement) => placement.editorSide === 'modified')}
        activeItemId={activeItemId}
        onSelect={(itemId) => setActiveItem(worktreeId, itemId === activeItemId ? null : itemId)}
      />
      {cardHost && activeEntry
        ? createPortal(
            <ExplanationCard
              label={activeEntry.label}
              changeTitle={activeEntry.changeTitle}
              text={activeEntry.item.text}
              badge={
                activeEntry.state === 'outdated' ? (
                  <span
                    data-testid="explanation-outdated-badge"
                    className="rounded-full border border-dashed border-border px-1.5 text-[11px] text-muted-foreground"
                  >
                    {translate(
                      'auto.components.right.sidebar.explanations.card.outdated',
                      'Outdated'
                    )}
                  </span>
                ) : null
              }
              onClose={() => setActiveItem(worktreeId, null)}
            >
              {renderCardFooter?.(activeEntry)}
            </ExplanationCard>,
            cardHost
          )
        : null}
    </>
  )
}
