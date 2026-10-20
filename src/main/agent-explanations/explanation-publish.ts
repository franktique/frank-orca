/**
 * Publish validation for agent change explanations (specs/002): fatal payload
 * checks, per-item anchor validation against the workspace change set
 * (research R4), gap-free label assignment (FR-010), and storage.
 * See contracts/publish-payload.md.
 */
import { randomUUID } from 'node:crypto'
import type { GitDiffResult } from '../../shared/git-diff-compare-types'
import {
  EXPLANATION_MAX_ITEMS_TOTAL,
  EXPLANATION_PAYLOAD_MAX_BYTES,
  ExplanationPublishPayloadSchema,
  extractPayloadVersion
} from '../../shared/agent-explanations/explanation-schemas'
import { itemLabel } from '../../shared/agent-explanations/explanation-labels'
import type {
  Change,
  ExplanationItem,
  ExplanationProducer,
  ExplanationSet,
  PublishLabel,
  PublishResult
} from '../../shared/agent-explanations/explanation-types'
import {
  NOT_GIT_WORKSPACE_ERROR,
  type ExplanationChangeSetSnapshot
} from './explanation-change-set'
import { validatePayload, type SurvivingChange } from './explanation-publish-validation'

export type ExplanationPublishFatalCode =
  | 'invalid_payload'
  | 'unsupported_version'
  | 'payload_too_large'
  | 'too_many_items'
  | 'no_changes'
  | 'not_git_workspace'

export type ExplanationPublishOutcome =
  | { ok: false; code: ExplanationPublishFatalCode; message: string }
  | { ok: true; result: PublishResult }

export type ExplanationPublishDeps = {
  changeSet(selector: string): Promise<ExplanationChangeSetSnapshot>
  fileDiff(selector: string, filePath: string, mergeBase: string): Promise<GitDiffResult>
  replace(workspaceId: string, set: ExplanationSet): Promise<{ replacedPrevious: boolean }>
  /** Resolves a CLI terminal handle to its pane and the pane's agent status. */
  terminalInfo(terminalHandle: string): { paneKey?: string; agentName?: string | null } | null
  now?(): number
  nextId?(): string
}

export async function publishExplanation(
  selector: string,
  rawPayload: unknown,
  options: { agent?: string; terminalHandle?: string } = {},
  deps: ExplanationPublishDeps
): Promise<ExplanationPublishOutcome> {
  let payloadJson: unknown = rawPayload
  if (typeof rawPayload === 'string') {
    try {
      payloadJson = JSON.parse(rawPayload)
    } catch (error) {
      return fatal(
        'invalid_payload',
        `Payload is not valid JSON: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }

  const version = extractPayloadVersion(payloadJson)
  if (version !== 1) {
    return fatal(
      'unsupported_version',
      version === undefined
        ? 'Payload has no version field; expected version 1.'
        : `Unsupported payload version ${JSON.stringify(version)}; expected version 1.`
    )
  }

  const parsed = ExplanationPublishPayloadSchema.safeParse(payloadJson)
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.map(String).join('.')}: ${issue.message}`)
      .join('; ')
    return fatal('invalid_payload', `Payload failed validation: ${issues}`)
  }
  const payload = parsed.data

  // Backstop for non-CLI callers: the CLI checks raw stdin bytes first (T024).
  const payloadBytes = Buffer.byteLength(JSON.stringify(payload), 'utf-8')
  if (payloadBytes > EXPLANATION_PAYLOAD_MAX_BYTES) {
    return fatal(
      'payload_too_large',
      `Payload is ${payloadBytes} bytes; the limit is ${EXPLANATION_PAYLOAD_MAX_BYTES}. Shorten item text or drop items.`
    )
  }
  const totalItems = payload.changes.reduce(
    (sum, change) => sum + change.files.reduce((fileSum, file) => fileSum + file.items.length, 0),
    0
  )
  if (totalItems > EXPLANATION_MAX_ITEMS_TOTAL) {
    return fatal('too_many_items', `Payload has ${totalItems} items (> 500 items).`)
  }

  let snapshot: ExplanationChangeSetSnapshot
  try {
    snapshot = await deps.changeSet(selector)
  } catch (error) {
    if (error instanceof Error && error.message === NOT_GIT_WORKSPACE_ERROR) {
      return fatal(
        'not_git_workspace',
        'This workspace is a folder, not a git repository, so there is no change set to explain.'
      )
    }
    throw error
  }
  if (snapshot.files.length === 0) {
    return fatal('no_changes', 'The workspace has no changes to explain.')
  }

  const validation = await validatePayload(selector, payload.changes, snapshot, deps)
  const { changes, labels } = assembleChanges(validation.surviving, deps)

  if (changes.length === 0) {
    return {
      ok: true,
      result: {
        ok: true,
        published: false,
        replacedPrevious: false,
        changeSetBase: snapshot.base,
        counts: {
          changes: 0,
          files: 0,
          items: 0,
          rejected: validation.rejected.length,
          warnings: validation.warnings.length
        },
        labels: [],
        rejected: validation.rejected,
        warnings: validation.warnings
      }
    }
  }

  const set: ExplanationSet = {
    id: deps.nextId?.() ?? randomUUID(),
    workspaceId: snapshot.workspaceId,
    // The store assigns the real revision on write.
    revision: 0,
    producer: resolveProducer(payload.agent, options, deps),
    generatedAt: deps.now?.() ?? Date.now(),
    changeSetBase: snapshot.base,
    changes,
    questions: [],
    publishWarnings: validation.warnings
  }
  const { replacedPrevious } = await deps.replace(snapshot.workspaceId, set)

  return {
    ok: true,
    result: {
      ok: true,
      published: true,
      explanationId: set.id,
      replacedPrevious,
      changeSetBase: snapshot.base,
      counts: {
        changes: changes.length,
        files: countFiles(changes),
        items: countItems(changes),
        rejected: validation.rejected.length,
        warnings: validation.warnings.length
      },
      labels,
      rejected: validation.rejected,
      warnings: validation.warnings
    }
  }
}

function fatal(code: ExplanationPublishFatalCode, message: string): ExplanationPublishOutcome {
  return { ok: false, code, message }
}

function countFiles(changes: Change[]): number {
  return changes.reduce((sum, change) => sum + change.files.length, 0)
}

function countItems(changes: Change[]): number {
  return changes.reduce(
    (sum, change) => sum + change.files.reduce((fileSum, file) => fileSum + file.items.length, 0),
    0
  )
}

function resolveProducer(
  payloadAgent: string | undefined,
  options: { agent?: string; terminalHandle?: string },
  deps: ExplanationPublishDeps
): ExplanationProducer {
  const terminal = options.terminalHandle ? deps.terminalInfo(options.terminalHandle) : null
  return {
    agentName: options.agent || payloadAgent || terminal?.agentName || 'agent',
    ...(options.terminalHandle ? { terminalHandle: options.terminalHandle } : {}),
    ...(terminal?.paneKey ? { paneKey: terminal.paneKey } : {})
  }
}

/** Drops emptied files and changes, then numbers what survives so labels stay gap-free (FR-010). */
function assembleChanges(
  surviving: SurvivingChange[],
  deps: ExplanationPublishDeps
): { changes: Change[]; labels: PublishLabel[] } {
  const changes: Change[] = []
  const labels: PublishLabel[] = []
  for (const change of surviving) {
    const files = change.files.filter((file) => file.resolved.length > 0)
    if (files.length === 0) {
      continue
    }
    const changeIndex = changes.length
    changes.push({
      index: changeIndex,
      title: change.title,
      summary: change.summary,
      files: files.map((file, filePosition) => {
        const items: ExplanationItem[] = file.resolved.map((item, itemPosition) => ({
          id: deps.nextId?.() ?? randomUUID(),
          ...(item.clientId ? { clientId: item.clientId } : {}),
          position: itemPosition + 1,
          anchor: item.anchor,
          text: item.text
        }))
        return {
          path: file.path,
          ...(file.changeSetFile.oldPath ? { oldPath: file.changeSetFile.oldPath } : {}),
          status: file.changeSetFile.status,
          position: filePosition + 1,
          items
        }
      })
    })
  }
  // Labels are derived from stored positions, so they can never have gaps.
  for (const change of changes) {
    for (const file of change.files) {
      for (const item of file.items) {
        if (item.clientId) {
          labels.push({
            id: item.clientId,
            label: itemLabel(change.index, file.position, item.position)
          })
        }
      }
    }
  }
  return { changes, labels }
}
