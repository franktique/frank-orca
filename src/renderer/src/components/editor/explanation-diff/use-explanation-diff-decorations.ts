import { useEffect, useMemo, useRef, useState } from 'react'
import type { editor } from 'monaco-editor'
import { monaco } from '@/lib/monaco-setup'
import { installDiffCommentZoneMouseDownStopper } from '../../diff-comments/diff-comment-zone-mouse-events'
import type { ExplanationFileItem } from './explanation-file-items'
import {
  inlineOriginalZoneAfterLine,
  layoutExplanationMarkers,
  maxMarkersPerLine,
  topForOriginalLineInline,
  type DiffLineChange,
  type MarkerPlacement
} from './explanation-marker-layout'
import { EXPLANATION_MARKER_GAP_PX, EXPLANATION_MARKER_SIZE_PX } from './ExplanationMarkerLane'

// Monaco's default width for the strip between line numbers and code.
const DEFAULT_LINE_DECORATIONS_WIDTH_PX = 10
const INITIAL_CARD_ZONE_HEIGHT_PX = 120

type DiffEditor = editor.IStandaloneDiffEditor

/** Re-lays out when anything that moves line tops changes (scroll excluded; lanes follow it). */
function useLayoutVersion(diffEditor: DiffEditor | null): number {
  const [version, setVersion] = useState(0)
  useEffect(() => {
    if (!diffEditor) {
      return
    }
    const bump = (): void => setVersion((current) => current + 1)
    const subs = [
      diffEditor.getOriginalEditor().onDidContentSizeChange(bump),
      diffEditor.getModifiedEditor().onDidContentSizeChange(bump),
      diffEditor.getModifiedEditor().onDidLayoutChange(bump),
      diffEditor.onDidUpdateDiff(bump)
    ]
    return () => subs.forEach((sub) => sub.dispose())
  }, [diffEditor])
  return version
}

export function useExplanationMarkerPlacements(
  diffEditor: DiffEditor | null,
  items: readonly ExplanationFileItem[],
  sideBySide: boolean
): MarkerPlacement[] {
  const layoutVersion = useLayoutVersion(diffEditor)
  return useMemo(() => {
    if (!diffEditor) {
      return []
    }
    const original = diffEditor.getOriginalEditor()
    const modified = diffEditor.getModifiedEditor()
    const lineHeight = modified.getOption(monaco.editor.EditorOption.lineHeight)
    return layoutExplanationMarkers(items, {
      sideBySide,
      topForLine: (side, line) =>
        (side === 'original' ? original : modified).getTopForLineNumber(line),
      topForOriginalLineInline: (line) =>
        topForOriginalLineInline(readLineChanges(diffEditor), line, {
          lineHeight,
          topForModifiedLine: (n) => modified.getTopForLineNumber(n),
          bottomForModifiedLine: (n) => modified.getBottomForLineNumber(n)
        })
    })
    // layoutVersion invalidates the memo when zones or the diff move line tops.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [diffEditor, items, sideBySide, layoutVersion])
}

function readLineChanges(diffEditor: DiffEditor): DiffLineChange[] {
  return (diffEditor.getLineChanges() ?? []).map((change) => ({
    originalStartLineNumber: change.originalStartLineNumber,
    originalEndLineNumber: change.originalEndLineNumber,
    modifiedStartLineNumber: change.modifiedStartLineNumber,
    modifiedEndLineNumber: change.modifiedEndLineNumber
  }))
}

/** Widens the decorations strip so every marker on a line fits beside the line numbers. */
export function useExplanationLaneWidth(
  diffEditor: DiffEditor | null,
  placements: readonly MarkerPlacement[]
): void {
  const widest = Math.max(
    maxMarkersPerLine(placements, 'original'),
    maxMarkersPerLine(placements, 'modified')
  )
  useEffect(() => {
    if (!diffEditor || widest === 0) {
      return
    }
    diffEditor.updateOptions({
      lineDecorationsWidth:
        DEFAULT_LINE_DECORATIONS_WIDTH_PX +
        widest * (EXPLANATION_MARKER_SIZE_PX + EXPLANATION_MARKER_GAP_PX)
    })
    return () => {
      diffEditor.updateOptions({ lineDecorationsWidth: DEFAULT_LINE_DECORATIONS_WIDTH_PX })
    }
  }, [diffEditor, widest])
}

/**
 * Highlights the active anchor and reserves a view zone under its last line. Returns the
 * element the card renders into, or null while no card is open.
 */
export function useExplanationCardZone(
  diffEditor: DiffEditor | null,
  active: Extract<ExplanationFileItem, { kind: 'line' }> | null,
  sideBySide: boolean
): HTMLElement | null {
  const [host, setHost] = useState<HTMLElement | null>(null)
  const activeRef = useRef(active)
  activeRef.current = active
  const activeKey = active
    ? `${active.item.id}:${active.anchor.side}:${active.line}:${active.endLine}`
    : null

  useEffect(() => {
    const current = activeRef.current
    if (!diffEditor || !current) {
      setHost(null)
      return
    }
    const isOld = current.anchor.side === 'old'
    const target =
      isOld && sideBySide ? diffEditor.getOriginalEditor() : diffEditor.getModifiedEditor()
    const afterLineNumber =
      isOld && !sideBySide
        ? inlineOriginalZoneAfterLine(readLineChanges(diffEditor), current.endLine)
        : current.endLine
    if (afterLineNumber === null) {
      setHost(null)
      return
    }

    const domNode = document.createElement('div')
    const inner = document.createElement('div')
    domNode.appendChild(inner)
    // Why: Monaco would otherwise take focus and start a selection drag from card clicks.
    const disposeMouseDownStopper = installDiffCommentZoneMouseDownStopper(domNode)
    const delegate: editor.IViewZone = {
      afterLineNumber,
      heightInPx: INITIAL_CARD_ZONE_HEIGHT_PX,
      domNode,
      suppressMouseDown: false
    }
    let zoneId = ''
    target.changeViewZones((accessor) => {
      zoneId = accessor.addZone(delegate)
    })
    const measure = (): void => {
      const measured = Math.ceil(inner.getBoundingClientRect().height)
      if (measured > 0 && measured !== delegate.heightInPx) {
        delegate.heightInPx = measured
        target.changeViewZones((accessor) => accessor.layoutZone(zoneId))
      }
    }
    // Why: the card renders lazily (markdown chunk, questions), so size changes can arrive
    // from either layout or DOM mutations; both re-measure.
    const observer = new ResizeObserver(measure)
    observer.observe(inner)
    const mutations = new MutationObserver(measure)
    mutations.observe(inner, { childList: true, subtree: true, characterData: true })
    const frame = requestAnimationFrame(measure)

    const range = new monaco.Range(current.line, 1, current.endLine, 1)
    // Inline-mode deleted lines have no model line to highlight; the card alone marks them.
    const decorations =
      isOld && !sideBySide
        ? null
        : target.createDecorationsCollection([
            { range, options: { isWholeLine: true, className: 'orca-explanation-range' } }
          ])
    setHost(inner)
    return () => {
      observer.disconnect()
      mutations.disconnect()
      disposeMouseDownStopper()
      cancelAnimationFrame(frame)
      decorations?.clear()
      target.changeViewZones((accessor) => accessor.removeZone(zoneId))
      setHost(null)
    }
  }, [diffEditor, activeKey, sideBySide])

  return host
}
