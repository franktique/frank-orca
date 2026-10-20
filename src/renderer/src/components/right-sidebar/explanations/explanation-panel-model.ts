import { fileLabel } from '../../../../../shared/agent-explanations/explanation-labels'
import type {
  ChangeSetFileStatus,
  ExplanationSet
} from '../../../../../shared/agent-explanations/explanation-types'
import type { ExplanationChangeSetState } from '@/store/slices/agent-explanations'

export type ExplanationPanelRow = {
  path: string
  oldPath?: string
  status: ChangeSetFileStatus
  /** File labels such as `A1`, in change order. */
  labels: string[]
  explained: boolean
  /** In the explanation but no longer in the live change set. */
  noLongerChanged: boolean
}

export type ExplanationPanelModel = {
  explained: ExplanationPanelRow[]
  unexplained: ExplanationPanelRow[]
  /** The host could not be asked, so "unexplained" and "no longer changed" are unknowable. */
  changeSetUnavailable: boolean
}

type LabelledEntry = { changeIndex: number; position: number; label: string }

function collectExplainedRows(
  set: ExplanationSet,
  changeSet: ExplanationChangeSetState
): { rows: ExplanationPanelRow[]; firstEntry: Map<string, LabelledEntry> } {
  const live =
    changeSet.status === 'ready' ? new Map(changeSet.files.map((f) => [f.path, f])) : null
  const byPath = new Map<string, ExplanationPanelRow>()
  const firstEntry = new Map<string, LabelledEntry>()
  for (const change of set.changes) {
    for (const file of change.files) {
      const label = fileLabel(change.index, file.position)
      const existing = byPath.get(file.path)
      if (existing) {
        existing.labels.push(label)
        continue
      }
      const liveFile = live?.get(file.path)
      byPath.set(file.path, {
        path: file.path,
        oldPath: liveFile?.oldPath ?? file.oldPath,
        status: liveFile?.status ?? file.status,
        labels: [label],
        explained: true,
        noLongerChanged: live !== null && !liveFile
      })
      firstEntry.set(file.path, { changeIndex: change.index, position: file.position, label })
    }
  }
  return { rows: [...byPath.values()], firstEntry }
}

export function buildExplanationPanelModel(
  set: ExplanationSet,
  changeSet: ExplanationChangeSetState
): ExplanationPanelModel {
  const { rows, firstEntry } = collectExplainedRows(set, changeSet)
  const explained = rows.sort((a, b) => {
    const left = firstEntry.get(a.path)
    const right = firstEntry.get(b.path)
    return (
      (left?.changeIndex ?? 0) - (right?.changeIndex ?? 0) ||
      (left?.position ?? 0) - (right?.position ?? 0)
    )
  })
  if (changeSet.status !== 'ready') {
    return { explained, unexplained: [], changeSetUnavailable: changeSet.status === 'unavailable' }
  }
  const explainedPaths = new Set(explained.map((row) => row.path))
  const unexplained = changeSet.files
    .filter((file) => !explainedPaths.has(file.path))
    .map((file): ExplanationPanelRow => ({
      path: file.path,
      oldPath: file.oldPath,
      status: file.status,
      labels: [],
      explained: false,
      noLongerChanged: false
    }))
    .sort((a, b) => a.path.localeCompare(b.path))
  return { explained, unexplained, changeSetUnavailable: false }
}

/** One change's files in `B1, B2…` order, labelled only with that change's labels (FR-009). */
export function filterExplanationRowsByChange(
  set: ExplanationSet,
  model: ExplanationPanelModel,
  changeIndex: number
): ExplanationPanelRow[] {
  const change = set.changes.find((candidate) => candidate.index === changeIndex)
  if (!change) {
    return []
  }
  const rowByPath = new Map(model.explained.map((row) => [row.path, row]))
  return [...change.files]
    .sort((a, b) => a.position - b.position)
    .flatMap((file) => {
      const row = rowByPath.get(file.path)
      return row ? [{ ...row, labels: [fileLabel(change.index, file.position)] }] : []
    })
}
