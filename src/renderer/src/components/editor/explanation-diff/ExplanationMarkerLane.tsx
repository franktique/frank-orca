import React, { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { editor } from 'monaco-editor'
import { monaco } from '@/lib/monaco-setup'
import type { MarkerPlacement } from './explanation-marker-layout'

export const EXPLANATION_MARKER_SIZE_PX = 16
export const EXPLANATION_MARKER_GAP_PX = 2

type ExplanationMarkerLaneProps = {
  editor: editor.ICodeEditor
  placements: readonly MarkerPlacement[]
  activeItemId: string | null
  onSelect: (itemId: string) => void
}

function useScrollTop(target: editor.ICodeEditor): number {
  const [scrollTop, setScrollTop] = useState(() => target.getScrollTop())
  useEffect(() => {
    setScrollTop(target.getScrollTop())
    const sub = target.onDidScrollChange((event) => {
      if (event.scrollTopChanged) {
        setScrollTop(event.scrollTop)
      }
    })
    return () => sub.dispose()
  }, [target])
  return scrollTop
}

/** Round markers drawn over one pane's line-decorations strip, following its scroll. */
export function ExplanationMarkerLane({
  editor: target,
  placements,
  activeItemId,
  onSelect
}: ExplanationMarkerLaneProps): React.JSX.Element | null {
  const scrollTop = useScrollTop(target)
  const host = target.getDomNode()
  if (!host || placements.length === 0) {
    return null
  }
  const laneLeft = target.getLayoutInfo().decorationsLeft
  const lineHeight = target.getOption(monaco.editor.EditorOption.lineHeight)
  return createPortal(
    <>
      {placements.map((placement) => (
        <button
          key={placement.itemId}
          type="button"
          className="orca-explanation-marker"
          data-testid="explanation-marker"
          data-explanation-label={placement.label}
          data-state={placement.state}
          data-active={placement.itemId === activeItemId ? 'true' : undefined}
          aria-label={placement.label}
          style={{
            top: Math.round(
              placement.top - scrollTop + (lineHeight - EXPLANATION_MARKER_SIZE_PX) / 2
            ),
            left:
              laneLeft + placement.slot * (EXPLANATION_MARKER_SIZE_PX + EXPLANATION_MARKER_GAP_PX)
          }}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={() => onSelect(placement.itemId)}
        >
          {placement.label}
        </button>
      ))}
    </>,
    host
  )
}
