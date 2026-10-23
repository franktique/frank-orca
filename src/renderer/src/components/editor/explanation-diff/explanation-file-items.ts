import { itemLabel } from '../../../../../shared/agent-explanations/explanation-labels'
import {
  hashSideContent,
  relocateAnchor
} from '../../../../../shared/agent-explanations/explanation-anchor-fingerprint'
import type {
  ExplanationItem,
  ExplanationSet,
  LineAnchor
} from '../../../../../shared/agent-explanations/explanation-types'

export type ExplanationFileItem = {
  item: ExplanationItem
  label: string
  changeIndex: number
  changeTitle: string
} & (
  | { kind: 'line'; anchor: LineAnchor; state: 'fresh' | 'outdated'; line: number; endLine: number }
  | { kind: 'detached'; reason: 'file-level' | 'detached' }
)

/** Every item for a file without touching its content, for when the diff cannot be read. */
export function listExplanationFileItemsUnresolved(
  set: ExplanationSet,
  path: string
): ExplanationFileItem[] {
  return resolveExplanationFileItems(set, path, { original: '', modified: '' }).map((entry) =>
    entry.kind === 'detached' ? entry : { ...entry, kind: 'detached', reason: 'file-level' }
  )
}

/**
 * Every item the set holds for one file, with line anchors relocated against the content
 * actually on screen. File-level and unmatched anchors come back as `detached` so they can
 * be listed without a marker.
 */
export function resolveExplanationFileItems(
  set: ExplanationSet,
  path: string,
  sides: { original: string; modified: string }
): ExplanationFileItem[] {
  const out: ExplanationFileItem[] = []
  for (const change of set.changes) {
    for (const file of change.files) {
      if (file.path !== path) {
        continue
      }
      for (const item of file.items) {
        const base = {
          item,
          label: itemLabel(change.index, file.position, item.position),
          changeIndex: change.index,
          changeTitle: change.title
        }
        if ('fileLevel' in item.anchor) {
          out.push({ ...base, kind: 'detached', reason: 'file-level' })
          continue
        }
        const anchor = item.anchor
        const sideContent = anchor.side === 'old' ? sides.original : sides.modified
        const resolved = relocateAnchor(anchor, sideContent, hashSideContent(sideContent))
        if (resolved.state === 'detached' || resolved.line === undefined) {
          out.push({ ...base, kind: 'detached', reason: 'detached' })
          continue
        }
        out.push({
          ...base,
          kind: 'line',
          anchor,
          state: resolved.state,
          line: resolved.line,
          endLine: resolved.endLine ?? resolved.line
        })
      }
    }
  }
  return out
}
