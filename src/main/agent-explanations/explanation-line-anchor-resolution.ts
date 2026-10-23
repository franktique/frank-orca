/** Reads both diff sides and resolves line anchors with fingerprints (research R4). */
import type { GitDiffResult } from '../../shared/git-diff-compare-types'
import {
  captureFingerprint,
  hashSideContent
} from '../../shared/agent-explanations/explanation-anchor-fingerprint'
import type { PublishIssue } from '../../shared/agent-explanations/explanation-types'
import type { ExplanationPublishDeps } from './explanation-publish'
import type { SurvivingChange } from './explanation-publish-validation'
import { changedLinesOnSides, splitSideLines } from './explanation-side-lines'

/** Why 4: each read is a git spawn; 4 keeps a 50-file publish off the process limit. */
const FILE_DIFF_CONCURRENCY = 4

type FileSides = {
  result: GitDiffResult
  oldLines: string[]
  newLines: string[]
  changed: { oldSide: ReadonlySet<number>; newSide: ReadonlySet<number> } | null
}

function sideText(sides: FileSides, side: 'new' | 'old'): string {
  return side === 'old' ? sides.result.originalContent : sides.result.modifiedContent
}

export async function readSides(
  selector: string,
  paths: string[],
  mergeBase: string,
  deps: ExplanationPublishDeps
): Promise<Map<string, FileSides>> {
  const sidesByPath = new Map<string, FileSides>()
  await mapWithLimit(paths, FILE_DIFF_CONCURRENCY, async (filePath) => {
    let result: GitDiffResult
    try {
      result = await deps.fileDiff(selector, filePath, mergeBase)
    } catch {
      // Why: one unreadable file must not sink the publish; its line anchors
      // are rejected below as unsupported instead.
      result = {
        kind: 'binary',
        originalContent: '',
        modifiedContent: '',
        originalIsBinary: true,
        modifiedIsBinary: true
      }
    }
    sidesByPath.set(filePath, {
      result,
      oldLines: splitSideLines(result.originalContent),
      newLines: splitSideLines(result.modifiedContent),
      changed:
        result.kind === 'text'
          ? changedLinesOnSides(result.originalContent, result.modifiedContent)
          : null
    })
  })
  return sidesByPath
}

export function resolveLineAnchors(
  surviving: SurvivingChange[],
  sidesByPath: Map<string, FileSides>,
  rejected: PublishIssue[],
  warnings: PublishIssue[]
): void {
  for (const [changeIndex, change] of surviving.entries()) {
    for (const [fileIndex, file] of change.files.entries()) {
      for (const item of file.items) {
        const issueBase = {
          changeIndex,
          fileIndex,
          itemIndex: item.itemIndex,
          path: file.path,
          ...(item.clientId ? { clientId: item.clientId } : {})
        }
        if (item.startLine === undefined && item.endLine === undefined) {
          file.resolved.push({
            clientId: item.clientId,
            text: item.text,
            anchor: { fileLevel: true }
          })
          continue
        }
        const sides = sidesByPath.get(file.path)
        if (!sides || sides.result.kind === 'binary') {
          rejected.push({
            code: 'line_anchor_unsupported',
            message: `File "${file.path}" is binary or too large for line anchors; use a file-level item.`,
            ...issueBase
          })
          continue
        }
        const lines = item.side === 'old' ? sides.oldLines : sides.newLines
        const start = item.startLine ?? item.endLine ?? 1
        const end = item.endLine ?? item.startLine ?? 1
        if (end < start) {
          rejected.push({
            code: 'line_out_of_range',
            message: `endLine ${end} is before startLine ${start}.`,
            ...issueBase
          })
          continue
        }
        if (end > lines.length) {
          rejected.push({
            code: 'line_out_of_range',
            message: `endLine ${end} > ${lines.length} lines on ${item.side} side.`,
            ...issueBase
          })
          continue
        }
        const changed = sides.changed?.[item.side === 'old' ? 'oldSide' : 'newSide']
        if (changed && !rangeTouches(start, end, changed)) {
          warnings.push({
            code: 'outside_changed_hunk',
            message:
              start === end
                ? `Line ${start} is unchanged context.`
                : `Lines ${start}-${end} are unchanged context.`,
            ...issueBase
          })
        }
        file.resolved.push({
          clientId: item.clientId,
          text: item.text,
          anchor: {
            side: item.side,
            startLine: start,
            endLine: end,
            fingerprint: {
              ...captureFingerprint(lines, start, end),
              diffIdentity: hashSideContent(sideText(sides, item.side))
            }
          }
        })
      }
    }
  }
}

function rangeTouches(start: number, end: number, changed: ReadonlySet<number>): boolean {
  for (let line = start; line <= end; line++) {
    if (changed.has(line)) {
      return true
    }
  }
  return false
}

async function mapWithLimit<T>(
  items: T[],
  limit: number,
  run: (item: T) => Promise<void>
): Promise<void> {
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++]
      await run(item)
    }
  })
  await Promise.all(workers)
}
