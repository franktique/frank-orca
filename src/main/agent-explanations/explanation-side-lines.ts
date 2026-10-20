/**
 * Line geometry for explanation anchors (specs/002): how a diff side splits into
 * 1-based lines, and which lines changed between the two sides (research R4's
 * `outside_changed_hunk` warning).
 */

export function splitSideLines(content: string): string[] {
  const normalized = content.replace(/\r\n?/g, '\n')
  const lines = normalized.split('\n')
  // Why: a trailing newline does not start a new line.
  if (lines.length > 1 && lines.at(-1) === '') {
    lines.pop()
  }
  return lines
}

// Why a budget: the LCS table is cells × 4 bytes, and a pathological whole-file
// rewrite would spike memory. Over budget every middle line counts as changed,
// so the warning can be missed — never wrongly emitted.
const LCS_CELL_BUDGET = 4_000_000

/** Which 1-based lines differ between the merge-base and working-tree sides. */
export function changedLinesOnSides(
  oldContent: string,
  newContent: string
): { oldSide: ReadonlySet<number>; newSide: ReadonlySet<number> } {
  const oldLines = splitSideLines(oldContent)
  const newLines = splitSideLines(newContent)
  const oldChanged = new Set<number>()
  const newChanged = new Set<number>()

  let prefix = 0
  while (
    prefix < oldLines.length &&
    prefix < newLines.length &&
    oldLines[prefix] === newLines[prefix]
  ) {
    prefix++
  }
  let oldEnd = oldLines.length
  let newEnd = newLines.length
  while (oldEnd > prefix && newEnd > prefix && oldLines[oldEnd - 1] === newLines[newEnd - 1]) {
    oldEnd--
    newEnd--
  }
  const oldMiddle = oldEnd - prefix
  const newMiddle = newEnd - prefix

  if (oldMiddle === 0 || newMiddle === 0) {
    for (let i = 0; i < oldMiddle; i++) {
      oldChanged.add(prefix + i + 1)
    }
    for (let j = 0; j < newMiddle; j++) {
      newChanged.add(prefix + j + 1)
    }
    return { oldSide: oldChanged, newSide: newChanged }
  }
  if (oldMiddle * newMiddle > LCS_CELL_BUDGET) {
    for (let i = 0; i < oldMiddle; i++) {
      oldChanged.add(prefix + i + 1)
    }
    for (let j = 0; j < newMiddle; j++) {
      newChanged.add(prefix + j + 1)
    }
    return { oldSide: oldChanged, newSide: newChanged }
  }

  // LCS lengths from the bottom-right corner; a line is changed when the walk
  // steps past it without a match.
  const width = newMiddle + 1
  const lcs = new Int32Array((oldMiddle + 1) * width)
  for (let i = oldMiddle - 1; i >= 0; i--) {
    for (let j = newMiddle - 1; j >= 0; j--) {
      lcs[i * width + j] =
        oldLines[prefix + i] === newLines[prefix + j]
          ? lcs[(i + 1) * width + j + 1] + 1
          : Math.max(lcs[(i + 1) * width + j], lcs[i * width + j + 1])
    }
  }
  let i = 0
  let j = 0
  while (i < oldMiddle && j < newMiddle) {
    if (oldLines[prefix + i] === newLines[prefix + j]) {
      i++
      j++
      continue
    }
    if (lcs[(i + 1) * width + j] >= lcs[i * width + j + 1]) {
      oldChanged.add(prefix + i + 1)
      i++
    } else {
      newChanged.add(prefix + j + 1)
      j++
    }
  }
  while (i < oldMiddle) {
    oldChanged.add(prefix + i++ + 1)
  }
  while (j < newMiddle) {
    newChanged.add(prefix + j++ + 1)
  }
  return { oldSide: oldChanged, newSide: newChanged }
}
