/**
 * Store for agent change explanations (specs/002): one lazily-read, cached JSON
 * file per workspace, durable writes serialized per workspace, a monotonic
 * revision, and change events. See contracts/storage-format.md.
 */
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm } from 'node:fs/promises'
import type {
  ExplanationSet,
  FollowUpQuestion
} from '../../shared/agent-explanations/explanation-types'
import {
  EXPLANATION_MAX_QUESTIONS_PER_SET,
  readStoredExplanationFile,
  type ExplanationQuestionUpsertInput
} from '../../shared/agent-explanations/explanation-schemas'
import { writeFileDurable, durableWriteTempPath } from '../durable-file-write'
import { getExplanationRoot, getExplanationWorkspacePaths } from './explanation-storage-paths'

export type ExplanationChangeEvent = { workspaceId: string; revision: number }

export type ExplanationReplaceResult = {
  replacedPrevious: boolean
  revision: number
}

export type ExplanationMutationFailure = {
  ok: false
  code: 'stale_explanation' | 'invalid_params'
  message: string
}

type ExplanationMutation<T> = ({ ok: true } & T) | ExplanationMutationFailure

const STALE: ExplanationMutationFailure = {
  ok: false,
  code: 'stale_explanation',
  message: 'The explanation was replaced or cleared; reload it and try again.'
}

export class ExplanationStore {
  private readonly cache = new Map<string, ExplanationSet | null>()
  private readonly readCompleted = new Set<string>()
  private readonly queues = new Map<string, Promise<unknown>>()
  private readonly corruptWarned = new Set<string>()
  // Survives a clear so the next publish still outranks the cleared revision on clients.
  private readonly lastRevision = new Map<string, number>()
  private readonly listeners = new Set<(event: ExplanationChangeEvent) => void>()

  constructor(private readonly rootOverride?: string) {}

  // Why: resolved on first use so constructing the runtime does not require the app path.
  private get root(): string {
    return this.rootOverride ?? getExplanationRoot()
  }

  /** Every read and write for a workspace runs on one promise chain, in call order. */
  private enqueue<T>(workspaceId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(workspaceId) ?? Promise.resolve()
    const run = previous.then(operation, operation)
    this.queues.set(
      workspaceId,
      run.then(
        () => undefined,
        () => undefined
      )
    )
    return run
  }

  async get(workspaceId: string): Promise<ExplanationSet | null> {
    return this.enqueue(workspaceId, () => this.readCached(workspaceId))
  }

  async replace(workspaceId: string, set: ExplanationSet): Promise<ExplanationReplaceResult> {
    return this.enqueue(workspaceId, async () => {
      const previous = await this.readCached(workspaceId)
      const revision =
        Math.max(previous?.revision ?? 0, this.lastRevision.get(workspaceId) ?? 0) + 1
      await this.persist(workspaceId, { ...set, revision })
      return { replacedPrevious: previous !== null, revision }
    })
  }

  /** Deletes the explanation; with `explanationId`, only if that set is still current. */
  async clear(
    workspaceId: string,
    explanationId?: string
  ): Promise<ExplanationMutation<{ cleared: boolean }>> {
    return this.enqueue(workspaceId, async () => {
      const current = await this.readCached(workspaceId)
      if (!current || (explanationId !== undefined && current.id !== explanationId)) {
        return { ok: true, cleared: false }
      }
      const paths = getExplanationWorkspacePaths(workspaceId, this.root)
      await rm(paths.file, { force: true })
      const revision = Math.max(current.revision, this.lastRevision.get(workspaceId) ?? 0) + 1
      this.lastRevision.set(workspaceId, revision)
      this.cache.set(workspaceId, null)
      this.readCompleted.add(workspaceId)
      this.emit({ workspaceId, revision })
      return { ok: true, cleared: true }
    })
  }

  /** Adds or edits a question. Editing a sent question leaves that record and drafts a new one. */
  async upsertQuestion(
    workspaceId: string,
    explanationId: string,
    input: ExplanationQuestionUpsertInput
  ): Promise<ExplanationMutation<{ question: FollowUpQuestion }>> {
    return this.mutateQuestions(workspaceId, explanationId, (current, now) => {
      const itemExists = current.changes.some((change) =>
        change.files.some((file) => file.items.some((item) => item.id === input.itemId))
      )
      if (!itemExists) {
        return invalid('The question points at an item that is not in this explanation.')
      }
      const existing = input.id ? current.questions.find((q) => q.id === input.id) : undefined
      if (existing?.state === 'draft') {
        const updated: FollowUpQuestion = { ...existing, body: input.body, updatedAt: now }
        return {
          questions: current.questions.map((q) => (q.id === existing.id ? updated : q)),
          result: { question: updated }
        }
      }
      if (current.questions.length >= EXPLANATION_MAX_QUESTIONS_PER_SET) {
        return invalid(
          `An explanation holds at most ${EXPLANATION_MAX_QUESTIONS_PER_SET} questions.`
        )
      }
      const created: FollowUpQuestion = {
        id: randomUUID(),
        itemId: input.itemId,
        body: input.body,
        createdAt: now,
        state: 'draft'
      }
      return { questions: [...current.questions, created], result: { question: created } }
    })
  }

  async markQuestionsSent(
    workspaceId: string,
    explanationId: string,
    questionIds: readonly string[],
    sentTo: { paneKey?: string; label: string }
  ): Promise<ExplanationMutation<object>> {
    return this.mutateQuestions(workspaceId, explanationId, (current, now) => ({
      questions: current.questions.map((q) =>
        questionIds.includes(q.id) ? { ...q, state: 'sent', sentAt: now, sentTo } : q
      ),
      result: {}
    }))
  }

  async deleteQuestion(
    workspaceId: string,
    explanationId: string,
    questionId: string
  ): Promise<ExplanationMutation<object>> {
    return this.mutateQuestions(workspaceId, explanationId, (current) => ({
      questions: current.questions.filter((q) => q.id !== questionId),
      result: {}
    }))
  }

  private async mutateQuestions<T extends object>(
    workspaceId: string,
    explanationId: string,
    mutate: (
      current: ExplanationSet,
      now: number
    ) => { questions: FollowUpQuestion[]; result: T } | ExplanationMutationFailure
  ): Promise<ExplanationMutation<T>> {
    return this.enqueue(workspaceId, async () => {
      const current = await this.readCached(workspaceId)
      if (!current || current.id !== explanationId) {
        return STALE
      }
      const outcome = mutate(current, Date.now())
      if ('ok' in outcome) {
        return outcome
      }
      const revision = Math.max(current.revision, this.lastRevision.get(workspaceId) ?? 0) + 1
      await this.persist(workspaceId, { ...current, questions: outcome.questions, revision })
      return { ok: true, ...outcome.result }
    })
  }

  private async persist(workspaceId: string, next: ExplanationSet): Promise<void> {
    const paths = getExplanationWorkspacePaths(workspaceId, this.root)
    await mkdir(paths.root, { recursive: true })
    await writeFileDurable(
      durableWriteTempPath(paths.file),
      paths.file,
      JSON.stringify({ schemaVersion: 1, workspaceId, explanation: next })
    )
    this.lastRevision.set(workspaceId, next.revision)
    this.cache.set(workspaceId, next)
    this.readCompleted.add(workspaceId)
    this.emit({ workspaceId, revision: next.revision })
  }

  subscribe(listener: (event: ExplanationChangeEvent) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** Drop the cached read so deletion cannot be undone by a later `get`. */
  evict(workspaceId: string): void {
    this.cache.delete(workspaceId)
    this.readCompleted.delete(workspaceId)
  }

  private emit(event: ExplanationChangeEvent): void {
    for (const listener of this.listeners) {
      listener(event)
    }
  }

  private async readCached(workspaceId: string): Promise<ExplanationSet | null> {
    if (this.readCompleted.has(workspaceId)) {
      return this.cache.get(workspaceId) ?? null
    }
    const paths = getExplanationWorkspacePaths(workspaceId, this.root)
    let raw: string
    try {
      raw = await readFile(paths.file, 'utf-8')
    } catch {
      // Absent or unreadable reads as "no explanation"; the replace path recreates it.
      this.cache.set(workspaceId, null)
      this.readCompleted.add(workspaceId)
      return null
    }
    const outcome = readStoredExplanationFile(raw)
    if (outcome.outcome === 'ok') {
      this.cache.set(workspaceId, outcome.explanation)
      this.readCompleted.add(workspaceId)
      return outcome.explanation
    }
    if (outcome.outcome === 'future-schema') {
      // A newer Orca's file: unreadable here, but never quarantined.
      this.cache.set(workspaceId, null)
      this.readCompleted.add(workspaceId)
      return null
    }
    await this.quarantineCorrupt(workspaceId, paths.file, paths.corruptDir, paths.corruptFile)
    this.cache.set(workspaceId, null)
    this.readCompleted.add(workspaceId)
    return null
  }

  private async quarantineCorrupt(
    workspaceId: string,
    file: string,
    corruptDir: string,
    corruptFile: (timestamp: number) => string
  ): Promise<void> {
    try {
      await mkdir(corruptDir, { recursive: true })
      await rename(file, corruptFile(Date.now()))
    } catch {
      // Best-effort: an unquarantinable file still reads as null below.
    }
    if (!this.corruptWarned.has(workspaceId)) {
      this.corruptWarned.add(workspaceId)
      console.error(`[agent-explanations] quarantined an unreadable file for ${workspaceId}`)
    }
  }
}

function invalid(message: string): ExplanationMutationFailure {
  return { ok: false, code: 'invalid_params', message }
}

let defaultStore: ExplanationStore | null = null

export function getExplanationStore(): ExplanationStore {
  defaultStore ??= new ExplanationStore()
  return defaultStore
}
