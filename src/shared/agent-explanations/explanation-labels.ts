import type { ExplanationSet } from './explanation-types'

// Labels are Orca-assigned (FR-010) and derived from stored positions, so they
// never have gaps: empty file entries and changes are dropped before numbering.
export function toChangeLetter(index: number): string {
  // Bijective base-26: 0→A, 25→Z, 26→AA.
  let n = index + 1
  let out = ''
  while (n > 0) {
    const remainder = (n - 1) % 26
    out = String.fromCharCode(65 + remainder) + out
    n = Math.floor((n - 1) / 26)
  }
  return out
}

export function fileLabel(changeIndex: number, filePosition: number): string {
  return `${toChangeLetter(changeIndex)}${filePosition}`
}

export function itemLabel(changeIndex: number, filePosition: number, itemPosition: number): string {
  return `${fileLabel(changeIndex, filePosition)}.${itemPosition}`
}

export type ExplanationGlobalOrderEntry = {
  itemId: string
  label: string
  path: string
  changeIndex: number
}

export function buildGlobalOrder(set: ExplanationSet): ExplanationGlobalOrderEntry[] {
  const entries: ExplanationGlobalOrderEntry[] = []
  for (const change of set.changes) {
    for (const file of change.files) {
      for (const item of file.items) {
        entries.push({
          itemId: item.id,
          label: itemLabel(change.index, file.position, item.position),
          path: file.path,
          changeIndex: change.index
        })
      }
    }
  }
  return entries
}

export function labelsForPath(set: ExplanationSet, path: string): string[] {
  return buildGlobalOrder(set)
    .filter((entry) => entry.path === path)
    .map((entry) => entry.label)
}
