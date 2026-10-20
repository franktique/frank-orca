import type { CommandHandler } from '../dispatch'
import { getOptionalStringFlag } from '../flags'
import { printResult } from '../format'
import type { RuntimeClient } from '../runtime/client'
import { RuntimeClientError, type RuntimeRpcSuccess } from '../runtime/types'
import { getOptionalWorktreeSelector, resolveCurrentWorktreeSelector } from '../selectors'
import {
  EXPLANATION_PAYLOAD_MAX_BYTES,
  explanationPublishPayloadJsonSchema
} from '../../shared/agent-explanations/explanation-schemas'
import {
  buildGlobalOrder,
  toChangeLetter
} from '../../shared/agent-explanations/explanation-labels'
import type {
  ChangeSetBase,
  ChangeSetFile,
  ExplanationSet,
  PublishIssue,
  PublishResult
} from '../../shared/agent-explanations/explanation-types'

type Failure = { ok: false; code: string; message: string }

function isFailure(value: unknown): value is Failure {
  return typeof value === 'object' && value !== null && 'ok' in value && value.ok === false
}

/** Old hosts reject the method outright; say so instead of a raw RPC error. */
async function callExplanation<T>(
  client: RuntimeClient,
  method: string,
  params: unknown
): Promise<RuntimeRpcSuccess<T | Failure>> {
  try {
    return await client.call<T | Failure>(method, params)
  } catch (error) {
    if (error instanceof RuntimeClientError && error.code === 'method_not_found') {
      throw new RuntimeClientError(
        'method_not_found',
        'This Orca version does not support agent explanations.'
      )
    }
    throw error
  }
}

async function resolveWorktree(
  flags: Map<string, string | boolean>,
  cwd: string,
  client: RuntimeClient
): Promise<string> {
  const explicit = await getOptionalWorktreeSelector(flags, 'worktree', cwd, client)
  if (explicit) {
    return explicit
  }
  if (client.isRemote) {
    throw new RuntimeClientError('invalid_argument', 'Pass --worktree with a server-side selector.')
  }
  return resolveCurrentWorktreeSelector(cwd, client)
}

/** Reads stdin up to the cap; RPC transports drop larger messages with a generic error. */
async function readPayloadStdin(maxBytes: number): Promise<string | null> {
  const chunks: Buffer[] = []
  let bytes = 0
  for await (const chunk of process.stdin) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))
    bytes += buffer.length
    if (bytes > maxBytes) {
      return null
    }
    chunks.push(buffer)
  }
  return Buffer.concat(chunks).toString('utf8')
}

function reportFailure(failure: Failure, json: boolean): void {
  process.exitCode = 1
  if (!json) {
    console.error(`${failure.code}: ${failure.message}`)
  }
}

function issueLocation(issue: PublishIssue): string {
  const parts: string[] = []
  if (issue.changeIndex !== undefined) {
    parts.push(toChangeLetter(issue.changeIndex))
  }
  if (issue.itemIndex !== undefined) {
    parts.push(`item ${issue.itemIndex + 1}`)
  } else if (issue.path) {
    parts.push(issue.path)
  }
  return parts.length > 0 ? `${parts.join(' ')}: ` : ''
}

function formatIssue(issue: PublishIssue): string {
  return `${issueLocation(issue)}${issue.code} — ${issue.message}`
}

function formatBase(base: ChangeSetBase): string {
  return base.kind === 'branch-and-uncommitted' && base.baseRef
    ? `Base: ${base.baseRef} (merge base ${base.mergeBase.slice(0, 10)}) plus uncommitted changes`
    : 'Base: uncommitted changes only'
}

function formatPublish(result: PublishResult): string {
  const { counts } = result
  const summary = result.published
    ? `Published ${counts.items} items across ${counts.files} files in ${counts.changes} changes${
        result.replacedPrevious ? ' (replaced the previous explanation)' : ''
      }; ${counts.rejected} rejected, ${counts.warnings} warnings.`
    : `Nothing published; ${counts.rejected} rejected.`
  return [
    summary,
    ...result.rejected.map((issue) => `rejected ${formatIssue(issue)}`),
    ...result.warnings.map((issue) => `warning ${formatIssue(issue)}`)
  ].join('\n')
}

function buildLabels(set: ExplanationSet): { itemId: string; label: string }[] {
  return buildGlobalOrder(set).map(({ itemId, label }) => ({ itemId, label }))
}

function formatShow(set: ExplanationSet | null): string {
  if (!set) {
    return 'No explanation published for this workspace.'
  }
  const labelById = new Map(buildLabels(set).map((entry) => [entry.itemId, entry.label]))
  const lines = [
    `Explanation by ${set.producer.agentName} (${new Date(set.generatedAt).toISOString()})`,
    formatBase(set.changeSetBase)
  ]
  for (const change of set.changes) {
    lines.push('', `${toChangeLetter(change.index)}. ${change.title}`, `   ${change.summary}`)
    for (const file of change.files) {
      lines.push(`   ${file.status} ${file.path}`)
      for (const item of file.items) {
        const anchor =
          'fileLevel' in item.anchor
            ? 'file'
            : `${item.anchor.side} ${item.anchor.startLine}-${item.anchor.endLine}`
        lines.push(`     ${labelById.get(item.id)} [${anchor}] ${item.text}`)
      }
    }
  }
  if (set.questions.length > 0) {
    lines.push('', 'Questions:')
    for (const question of set.questions) {
      lines.push(
        `  ${labelById.get(question.itemId) ?? question.itemId} (${question.state}) ${question.body}`
      )
    }
  }
  return lines.join('\n')
}

function formatChanges(value: { base: ChangeSetBase; files: ChangeSetFile[] }): string {
  return [
    formatBase(value.base),
    ...value.files.map(
      (file) => `${file.status} ${file.path}${file.oldPath ? ` ← ${file.oldPath}` : ''}`
    )
  ].join('\n')
}

function render<T>(
  res: RuntimeRpcSuccess<T | Failure>,
  json: boolean,
  format: (value: T) => string
): void {
  if (isFailure(res.result)) {
    reportFailure(res.result, json)
  }
  printResult(res, json, (value) => (isFailure(value) ? '' : format(value)))
}

export const EXPLANATION_HANDLERS: Record<string, CommandHandler> = {
  'explain publish': async ({ flags, client, cwd, json }) => {
    if (flags.get('input-stdin') !== true) {
      throw new RuntimeClientError(
        'invalid_argument',
        'Pass --input-stdin and pipe the JSON payload on stdin.'
      )
    }
    const raw = await readPayloadStdin(EXPLANATION_PAYLOAD_MAX_BYTES)
    if (raw === null) {
      throw new RuntimeClientError(
        'payload_too_large',
        'The payload is over 900 KB. Shorten item text or drop items, then publish again.'
      )
    }
    let payload: unknown
    try {
      payload = JSON.parse(raw)
    } catch {
      throw new RuntimeClientError('invalid_payload', 'stdin is not valid JSON.')
    }
    const worktree = await resolveWorktree(flags, cwd, client)
    const res = await callExplanation<PublishResult>(client, 'explanation.publish', {
      worktree,
      payload,
      agent: getOptionalStringFlag(flags, 'agent'),
      terminalHandle: process.env.ORCA_TERMINAL_HANDLE || undefined
    })
    if (!isFailure(res.result) && !res.result.published) {
      process.exitCode = 1
    }
    render(res, json, formatPublish)
  },
  'explain show': async ({ flags, client, cwd, json }) => {
    const worktree = await resolveWorktree(flags, cwd, client)
    const res = await callExplanation<{ ok: true; explanation: ExplanationSet | null }>(
      client,
      'explanation.get',
      { worktree }
    )
    if (json && !isFailure(res.result)) {
      const set = res.result.explanation
      printResult(
        { ...res, result: { ...res.result, labels: set ? buildLabels(set) : [] } },
        true,
        () => ''
      )
      return
    }
    render(res, json, (value) => formatShow(value.explanation))
  },
  'explain clear': async ({ flags, client, cwd, json }) => {
    const worktree = await resolveWorktree(flags, cwd, client)
    render(
      await callExplanation<{ ok: true; cleared: boolean }>(client, 'explanation.clear', {
        worktree
      }),
      json,
      (value) => (value.cleared ? 'Explanation cleared.' : 'No explanation to clear.')
    )
  },
  'explain changes': async ({ flags, client, cwd, json }) => {
    const worktree = await resolveWorktree(flags, cwd, client)
    render(
      await callExplanation<{ ok: true; base: ChangeSetBase; files: ChangeSetFile[] }>(
        client,
        'explanation.changeSet',
        { worktree }
      ),
      json,
      formatChanges
    )
  },
  'explain schema': async () => {
    const schema = explanationPublishPayloadJsonSchema()
    console.log(JSON.stringify(schema, null, 2))
  }
}
