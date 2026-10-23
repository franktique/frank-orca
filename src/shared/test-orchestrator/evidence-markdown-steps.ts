// Per-step sections and summary rows of report.md.
import type { ExecutionOutcome } from '../api-client/api-client-types'
import { truncateBody } from './evidence-truncation'
import { renderQueryBlock } from './evidence-markdown-queries'
import {
  escapeTableCell,
  fencedBlock,
  inlineCode,
  isJsonText,
  toRelativeImageLink
} from './evidence-markdown-text'
import type { Phase, RequestEvidence, StepResult, StepResultKind } from './test-orchestrator-types'

const PHASE_HEADINGS: Record<Phase, string> = {
  preflight: 'Preflight',
  setup: 'Setup',
  scenario: 'Scenarios',
  cleanup: 'Cleanup'
}
const PHASE_ORDER: Phase[] = ['preflight', 'setup', 'scenario', 'cleanup']

const RESULT_LABELS: Record<StepResultKind, string> = {
  pass: '✅ Pass',
  fail: '❌ Fail',
  skipped: '⏭ Skipped',
  blocked: '⛔ Blocked',
  running: '⏳ Running',
  pending: '⏳ Pending'
}

function describeReason(step: StepResult): string {
  // Why: reasons such as "skipped — run stopped" already carry the label word.
  return (step.reason ?? '').replace(/^skipped — /i, '')
}

export function describeStepResult(step: StepResult): string {
  let text = RESULT_LABELS[step.result]
  if (step.reason) {
    text += ` — ${describeReason(step)}`
  }
  if (step.dependencyFailed.length > 0) {
    text += ` · ⚠ Dependency failed: ${step.dependencyFailed.join(', ')}`
  }
  return text
}

export function renderSummaryTable(steps: StepResult[]): string {
  const rows = steps.map(
    (step) =>
      `| ${[
        step.stepId,
        step.title,
        step.expectedText || '—',
        step.actualText || '—',
        describeStepResult(step)
      ]
        .map(escapeTableCell)
        .join(' | ')} |`
  )
  return [
    '| Step | Title | Expected | Actual | Result |',
    '| --- | --- | --- | --- | --- |',
    ...rows
  ].join('\n')
}

export function renderImage(alt: string, screenshot: string | null): string[] {
  return screenshot ? [`![${alt}](${toRelativeImageLink(screenshot)})`] : []
}

function formatByteCount(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`
  }
  return bytes < 1024 * 1024
    ? `${Number((bytes / 1024).toFixed(1))} KB`
    : `${Number((bytes / (1024 * 1024)).toFixed(1))} MB`
}

function renderBody(text: string): string[] {
  const truncated = truncateBody(text)
  const block = fencedBlock(isJsonText(text) ? 'json' : 'text', truncated.text)
  return truncated.note ? [block, truncated.note] : [block]
}

function renderHeaderTable(headers: [string, string][]): string[] {
  if (headers.length === 0) {
    return []
  }
  const rows = headers.map(
    ([name, value]) => `| ${escapeTableCell(name)} | ${escapeTableCell(value)} |`
  )
  return ['| Header | Value |', '| --- | --- |', ...rows, '']
}

function renderResponse(outcome: ExecutionOutcome, durationMs: number | null): string[] {
  if (outcome.kind === 'error') {
    return [`**Response** — error \`${outcome.code}\`: ${outcome.message}`]
  }
  const { response } = outcome
  const facts = [`${inlineCode(`${response.status} ${response.statusText}`.trim())}`]
  if (durationMs !== null) {
    facts.push(`${durationMs} ms`)
  }
  facts.push(formatByteCount(response.sizeBytes))
  const lines = [`**Response** — ${facts.join(' · ')}`, '']
  const { body } = response
  if (body.encoding === 'base64') {
    lines.push(
      `(binary, ${formatByteCount(response.sizeBytes)}, ${response.contentType ?? 'unknown type'})`
    )
  } else if (body.encoding === 'omitted' || body.text === undefined) {
    lines.push('(body omitted)')
  } else {
    lines.push(...renderBody(body.text))
    if (body.truncated) {
      lines.push('> Truncated: the response body was cut when it was captured.')
    }
  }
  return lines
}

function renderExchange(
  step: StepResult,
  exchange: RequestEvidence,
  position: number,
  total: number
): string[] {
  const concurrent = total > 1
  const label = concurrent ? `Request ${position + 1}` : 'Request'
  const sent =
    concurrent && exchange.sentOffsetMs !== undefined ? ` — sent +${exchange.sentOffsetMs} ms` : ''
  const { resolvedRequest } = exchange
  const lines = [
    `**${label}**${sent}`,
    '',
    inlineCode(`${resolvedRequest.method} ${resolvedRequest.url}`),
    '',
    ...renderHeaderTable(resolvedRequest.headers)
  ]
  if (resolvedRequest.body) {
    lines.push(...renderBody(resolvedRequest.body), '')
  }
  lines.push(...renderImage(`${step.stepId} request and response`, exchange.screenshot))
  if (exchange.screenshot) {
    lines.push('')
  }
  lines.push(...renderResponse(exchange.outcome, total === 1 ? step.durationMs : null))
  return [...lines, '']
}

export function renderStepSection(step: StepResult): string {
  const iteration = step.iterationValue
    ? ` (${step.iterationValue.variable} = ${step.iterationValue.valueMasked})`
    : ''
  const lines = [`### ${step.stepId} · ${step.title}${iteration}`, '']
  if (step.dependencyFailed.length > 0) {
    lines.push(`> ⚠ Dependency failed: ${step.dependencyFailed.join(', ')}`, '')
  }
  lines.push(...renderQueryBlock(step.stepId, 'Before', step.before))
  step.exchanges.forEach((exchange, position) => {
    lines.push(...renderExchange(step, exchange, position, step.exchanges.length))
  })
  lines.push(...renderQueryBlock(step.stepId, 'After', step.after))
  if (step.exchanges.length > 1) {
    const groupReason = step.reason ? ` — ${describeReason(step)}` : ''
    lines.push(`**Group verdict** — ${RESULT_LABELS[step.result]}${groupReason}`, '')
  }
  const reason = step.reason ? ` — ${describeReason(step)}` : ''
  lines.push(
    `**Expected** ${step.expectedText || '—'} · **Actual** ${step.actualText || '—'} · **Result** ${RESULT_LABELS[step.result]}${reason}`
  )
  return lines.join('\n')
}

export function renderPhaseSections(steps: StepResult[]): string[] {
  return PHASE_ORDER.flatMap((phase) => {
    const phaseSteps = steps.filter((step) => step.phase === phase)
    return phaseSteps.length === 0
      ? []
      : [`## ${PHASE_HEADINGS[phase]}`, ...phaseSteps.map(renderStepSection)]
  })
}
