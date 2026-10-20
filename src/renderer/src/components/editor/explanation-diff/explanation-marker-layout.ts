import type { ExplanationFileItem } from './explanation-file-items'

type LineItem = Extract<ExplanationFileItem, { kind: 'line' }>

export type MarkerEditorSide = 'original' | 'modified'

export type MarkerPlacement = {
  itemId: string
  label: string
  state: 'fresh' | 'outdated'
  editorSide: MarkerEditorSide
  /** Anchor line on its own side; the card opens under `endLine`. */
  line: number
  endLine: number
  top: number
  /** Position among markers sharing a line, left to right (FR-012). */
  slot: number
}

export type MarkerLayoutContext = {
  sideBySide: boolean
  /** Top of a line in the editor that shows it, in editor-relative pixels. */
  topForLine: (editorSide: MarkerEditorSide, line: number) => number
  /** Inline mode only: top of a deleted (original-side) line in the modified editor. */
  topForOriginalLineInline: (line: number) => number | null
}

export type DiffLineChange = {
  originalStartLineNumber: number
  originalEndLineNumber: number
  modifiedStartLineNumber: number
  modifiedEndLineNumber: number
}

/**
 * Where an original-side line sits when the diff is inline. Deleted lines are drawn as a block
 * directly above the modified range that replaced them (or after the preceding line for a pure
 * deletion), so the line's offset inside that block is its index among the deleted lines.
 */
export function topForOriginalLineInline(
  changes: readonly DiffLineChange[],
  line: number,
  metrics: {
    lineHeight: number
    topForModifiedLine: (line: number) => number
    bottomForModifiedLine: (line: number) => number
  }
): number | null {
  const change = changes.find(
    (candidate) =>
      candidate.originalEndLineNumber > 0 &&
      line >= candidate.originalStartLineNumber &&
      line <= candidate.originalEndLineNumber
  )
  if (!change) {
    return null
  }
  const deletedCount = change.originalEndLineNumber - change.originalStartLineNumber + 1
  const blockHeight = deletedCount * metrics.lineHeight
  const pureDeletion = change.modifiedEndLineNumber === 0
  const blockTop = pureDeletion
    ? change.modifiedStartLineNumber === 0
      ? 0
      : metrics.bottomForModifiedLine(change.modifiedStartLineNumber)
    : metrics.topForModifiedLine(change.modifiedStartLineNumber) - blockHeight
  return blockTop + (line - change.originalStartLineNumber) * metrics.lineHeight
}

export function layoutExplanationMarkers(
  items: readonly ExplanationFileItem[],
  context: MarkerLayoutContext
): MarkerPlacement[] {
  const slotsByKey = new Map<string, number>()
  const placements: MarkerPlacement[] = []
  for (const entry of items) {
    if (entry.kind !== 'line') {
      continue
    }
    const placement = placeMarker(entry, context)
    if (!placement) {
      continue
    }
    const key = `${placement.editorSide}:${placement.top}`
    const slot = slotsByKey.get(key) ?? 0
    slotsByKey.set(key, slot + 1)
    placements.push({ ...placement, slot })
  }
  return placements
}

function placeMarker(
  entry: LineItem,
  context: MarkerLayoutContext
): Omit<MarkerPlacement, 'slot'> | null {
  const isOld = entry.anchor.side === 'old'
  const editorSide: MarkerEditorSide = isOld && context.sideBySide ? 'original' : 'modified'
  const top =
    isOld && !context.sideBySide
      ? context.topForOriginalLineInline(entry.line)
      : context.topForLine(editorSide, entry.line)
  if (top === null) {
    return null
  }
  return {
    itemId: entry.item.id,
    label: entry.label,
    state: entry.state,
    editorSide,
    line: entry.line,
    endLine: entry.endLine,
    top
  }
}

/** Widest group of markers sharing one line, per editor side. */
export function maxMarkersPerLine(
  placements: readonly MarkerPlacement[],
  editorSide: MarkerEditorSide
): number {
  let max = 0
  for (const placement of placements) {
    if (placement.editorSide === editorSide) {
      max = Math.max(max, placement.slot + 1)
    }
  }
  return max
}

/** Modified-editor line to hang a card under for a deleted line shown inline. */
export function inlineOriginalZoneAfterLine(
  changes: readonly DiffLineChange[],
  line: number
): number | null {
  const change = changes.find(
    (candidate) =>
      candidate.originalEndLineNumber > 0 &&
      line >= candidate.originalStartLineNumber &&
      line <= candidate.originalEndLineNumber
  )
  if (!change) {
    return null
  }
  // A pure deletion reports the line before it as its modified start.
  return change.modifiedEndLineNumber === 0
    ? change.modifiedStartLineNumber
    : Math.max(0, change.modifiedStartLineNumber - 1)
}
