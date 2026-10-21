// Before/After query blocks of report.md (FR-014, FR-026).
import {
  escapeTableCell,
  fencedBlock,
  formatDuration,
  toRelativeImageLink
} from './evidence-markdown-text'
import type { QueryEvidence, QueryResultTable } from './test-orchestrator-types'

const INDENT = '   '

const WITHHELD_REASONS: Record<NonNullable<QueryEvidence['screenshotWithheld']>, string> = {
  residual: 'a sensitive value was still visible after blurring',
  uninspectable: 'the page could not be inspected for sensitive values'
}

function describeHow(query: QueryEvidence): string {
  switch (query.how) {
    case 'automatic':
      return 'run automatically'
    case 'browser':
      return 'run in browser console'
    case 'manual':
      return query.waitedMs === undefined
        ? 'run manually by the user'
        : `run manually by the user · waited ${formatDuration(query.waitedMs)}`
    case 'skipped-by-user':
      return 'skipped by user'
    case 'skipped-not-approved':
      return 'skipped — data change not approved'
    case 'failed':
      return `failed: ${query.error ?? 'unknown error'}`
  }
}

function renderResultTable(result: QueryResultTable): string[] {
  const count = (value: number): string => value.toLocaleString('en-US')
  const lines: string[] = []
  if (result.columns.length > 0) {
    lines.push(
      `| ${result.columns.map(escapeTableCell).join(' | ')} |`,
      `| ${result.columns.map(() => '---').join(' | ')} |`,
      ...result.rows.map((row) => `| ${row.map(escapeTableCell).join(' | ')} |`)
    )
  }
  if (result.truncated) {
    lines.push(
      '',
      `> Truncated: showing ${count(result.rows.length)} of ${count(result.totalRows)} rows.`
    )
  }
  return lines
}

function renderQuery(query: QueryEvidence, alt: string): string[] {
  const lines = [fencedBlock('sql', query.sqlResolved), '', describeHow(query)]
  if (query.partial) {
    lines.push('', '> Result may be partial (the console paginates results).')
  }
  if (query.screenshot) {
    lines.push('', `![${alt}](${toRelativeImageLink(query.screenshot)})`)
  }
  if (query.blurredCount) {
    lines.push('', `> ${query.blurredCount} sensitive values blurred in the screenshot.`)
  }
  if (query.screenshotWithheld) {
    lines.push(
      '',
      `> Screenshot withheld: a sensitive value could not be blurred (${WITHHELD_REASONS[query.screenshotWithheld]}).`
    )
  }
  if (query.result) {
    lines.push('', ...renderResultTable(query.result))
  }
  if (query.pastedText) {
    lines.push('', fencedBlock('text', query.pastedText))
  }
  return lines
}

/** A numbered list; every block is indented under its item so fences and tables stay inside it. */
export function renderQueryBlock(
  stepId: string,
  side: 'Before' | 'After',
  queries: readonly QueryEvidence[]
): string[] {
  if (queries.length === 0) {
    return []
  }
  const lines = [`**${side}**`, '']
  queries.forEach((query, position) => {
    const k = position + 1
    const label = query.description ? escapeTableCell(query.description) : `Query ${k}`
    const alt = `${stepId} ${side.toLowerCase()} ${k}`
    lines.push(
      `${k}. ${label}`,
      '',
      ...renderQuery(query, alt)
        .flatMap((line) => line.split('\n'))
        .map((line) => (line === '' ? '' : `${INDENT}${line}`)),
      ''
    )
  })
  return lines
}
