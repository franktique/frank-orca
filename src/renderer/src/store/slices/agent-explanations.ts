import type { StateCreator } from 'zustand'
import type { AppState } from '../types'
import type {
  ChangeSetBase,
  ChangeSetFile,
  ExplanationSet,
  FollowUpQuestion
} from '../../../../shared/agent-explanations/explanation-types'
import { translate } from '@/i18n/i18n'
import { getConnectionIdFromState } from '@/lib/connection-owner-resolution'
import {
  clearRuntimeExplanation,
  deleteRuntimeExplanationQuestion,
  getRuntimeExplanation,
  getRuntimeExplanationChangeSet,
  markRuntimeExplanationQuestionsSent,
  upsertRuntimeExplanationQuestion,
  type ExplanationClientContext
} from '@/runtime/runtime-explanation-client'
import { stepExplanationItem } from './agent-explanations-stepping'

// 'unavailable' keeps the last saved explanation readable while the host is unreachable.
export type ExplanationChangeSetState =
  | { status: 'idle' }
  | { status: 'ready'; base: ChangeSetBase; files: ChangeSetFile[] }
  | { status: 'unavailable' }

export type WorkspaceExplanationState = {
  explanation: ExplanationSet | null
  /** Highest revision seen, including a clear, so older pushes are ignored. */
  revision: number
  changeSet: ExplanationChangeSetState
  focusedChangeIndex: number | null
  activeItemId: string | null
}

const EMPTY_STATE: WorkspaceExplanationState = {
  explanation: null,
  revision: 0,
  changeSet: { status: 'idle' },
  focusedChangeIndex: null,
  activeItemId: null
}

export type ExplanationQuestionResult =
  | { ok: true; question?: FollowUpQuestion }
  | { ok: false; message: string }

export type AgentExplanationsSlice = {
  explanationsByWorkspace: Record<string, WorkspaceExplanationState | undefined>
  /** Unsaved question text per `${workspaceId}::${itemId}`, kept while the card is closed. */
  explanationQuestionDrafts: Record<string, string>
  setExplanationQuestionDraft: (workspaceId: string, itemId: string, body: string | null) => void
  upsertExplanationQuestion: (
    workspaceId: string,
    question: { id?: string; itemId: string; body: string }
  ) => Promise<ExplanationQuestionResult>
  markExplanationQuestionsSent: (
    workspaceId: string,
    questionIds: string[],
    sentTo: { paneKey?: string; label: string }
  ) => Promise<ExplanationQuestionResult>
  deleteExplanationQuestion: (
    workspaceId: string,
    questionId: string
  ) => Promise<ExplanationQuestionResult>
  /** Clears the current explanation; a newer one published meanwhile is left alone. */
  clearExplanation: (workspaceId: string) => Promise<void>
  loadExplanation: (workspaceId: string) => Promise<void>
  loadExplanationChangeSet: (workspaceId: string) => Promise<void>
  /** Refetches only when the pushed revision is newer than the one held. */
  applyExplanationsChanged: (event: { workspaceId: string; revision: number }) => Promise<void>
  setFocusedExplanationChange: (workspaceId: string, changeIndex: number | null) => void
  setActiveExplanationItem: (workspaceId: string, itemId: string | null) => void
  /** Steps through items in reading order, opening the next file when the item lives elsewhere. */
  stepExplanationItem: (workspaceId: string, direction: 1 | -1) => void
}

function clientContext(state: AppState, workspaceId: string): ExplanationClientContext {
  return {
    workspaceId,
    settings: state.settings,
    connectionId: getConnectionIdFromState(state, workspaceId) ?? undefined
  }
}

type MutationOutcome = { ok: true; question?: FollowUpQuestion } | { ok: false; message: string }

function noExplanationResult(): ExplanationQuestionResult {
  return {
    ok: false,
    message: translate(
      'auto.components.right.sidebar.explanations.questions.noExplanation',
      'There is no explanation to ask about.'
    )
  }
}

function toQuestionResult(outcome: MutationOutcome): ExplanationQuestionResult {
  return outcome.ok ? { ok: true } : { ok: false, message: outcome.message }
}

export const createAgentExplanationsSlice: StateCreator<
  AppState,
  [],
  [],
  AgentExplanationsSlice
> = (set, get) => {
  const patch = (
    workspaceId: string,
    update: (current: WorkspaceExplanationState) => WorkspaceExplanationState
  ): void =>
    set((state) => ({
      explanationsByWorkspace: {
        ...state.explanationsByWorkspace,
        [workspaceId]: update(state.explanationsByWorkspace[workspaceId] ?? EMPTY_STATE)
      }
    }))

  // Runs a question mutation and refetches so the card reflects the stored revision at once.
  const mutate = async (
    workspaceId: string,
    run: () => Promise<
      { ok: true; question?: FollowUpQuestion } | { ok: false; message: string; code?: string }
    >
  ): Promise<MutationOutcome> => {
    try {
      const result = await run()
      if (!result.ok) {
        if ('code' in result && result.code === 'stale_explanation') {
          await get().loadExplanation(workspaceId)
        }
        return { ok: false, message: result.message }
      }
      await get().loadExplanation(workspaceId)
      return result
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) }
    }
  }

  return {
    explanationsByWorkspace: {},
    explanationQuestionDrafts: {},

    setExplanationQuestionDraft: (workspaceId, itemId, body) =>
      set((state) => {
        const key = `${workspaceId}::${itemId}`
        const next = { ...state.explanationQuestionDrafts }
        if (body === null) {
          delete next[key]
        } else {
          next[key] = body
        }
        return { explanationQuestionDrafts: next }
      }),

    upsertExplanationQuestion: async (workspaceId, question) => {
      const explanation = get().explanationsByWorkspace[workspaceId]?.explanation
      if (!explanation) {
        return noExplanationResult()
      }
      const result = await mutate(workspaceId, () =>
        upsertRuntimeExplanationQuestion(clientContext(get(), workspaceId), {
          explanationId: explanation.id,
          question
        })
      )
      return result.ok && 'question' in result
        ? { ok: true, question: result.question }
        : toQuestionResult(result)
    },

    markExplanationQuestionsSent: async (workspaceId, questionIds, sentTo) => {
      const explanation = get().explanationsByWorkspace[workspaceId]?.explanation
      if (!explanation) {
        return noExplanationResult()
      }
      return toQuestionResult(
        await mutate(workspaceId, () =>
          markRuntimeExplanationQuestionsSent(clientContext(get(), workspaceId), {
            explanationId: explanation.id,
            questionIds,
            sentTo
          })
        )
      )
    },

    deleteExplanationQuestion: async (workspaceId, questionId) => {
      const explanation = get().explanationsByWorkspace[workspaceId]?.explanation
      if (!explanation) {
        return noExplanationResult()
      }
      return toQuestionResult(
        await mutate(workspaceId, () =>
          deleteRuntimeExplanationQuestion(clientContext(get(), workspaceId), {
            explanationId: explanation.id,
            questionId
          })
        )
      )
    },

    clearExplanation: async (workspaceId) => {
      const explanation = get().explanationsByWorkspace[workspaceId]?.explanation
      if (!explanation) {
        return
      }
      const result = await clearRuntimeExplanation(
        clientContext(get(), workspaceId),
        explanation.id
      )
      if (result.ok) {
        // Local state follows immediately; the push for the same revision is then a no-op.
        patch(workspaceId, (current) => ({
          ...current,
          explanation: null,
          focusedChangeIndex: null,
          activeItemId: null,
          changeSet: { status: 'idle' }
        }))
        await get().loadExplanation(workspaceId)
      }
    },

    loadExplanation: async (workspaceId) => {
      let result: Awaited<ReturnType<typeof getRuntimeExplanation>>
      try {
        result = await getRuntimeExplanation(clientContext(get(), workspaceId))
      } catch {
        // Unreachable host: keep whatever was last loaded.
        return
      }
      if (!result.ok) {
        return
      }
      const { explanation } = result
      patch(workspaceId, (current) => {
        if (explanation && explanation.revision < current.revision) {
          return current
        }
        const sameSet = explanation?.id === current.explanation?.id
        return {
          ...current,
          explanation,
          revision: Math.max(current.revision, explanation?.revision ?? 0),
          // A replaced or cleared set invalidates focus and the open card.
          focusedChangeIndex: sameSet ? current.focusedChangeIndex : null,
          activeItemId: sameSet ? current.activeItemId : null,
          changeSet: explanation ? current.changeSet : { status: 'idle' }
        }
      })
    },

    loadExplanationChangeSet: async (workspaceId) => {
      try {
        const result = await getRuntimeExplanationChangeSet(clientContext(get(), workspaceId))
        patch(workspaceId, (current) => ({
          ...current,
          changeSet: result.ok
            ? { status: 'ready', base: result.base, files: result.files }
            : { status: 'unavailable' }
        }))
      } catch {
        patch(workspaceId, (current) => ({ ...current, changeSet: { status: 'unavailable' } }))
      }
    },

    applyExplanationsChanged: async ({ workspaceId, revision }) => {
      const held = get().explanationsByWorkspace[workspaceId]?.revision ?? 0
      if (revision <= held) {
        return
      }
      await get().loadExplanation(workspaceId)
      // A clear returns no set, so remember the pushed revision to drop stale replays.
      patch(workspaceId, (current) => ({
        ...current,
        revision: Math.max(current.revision, revision)
      }))
    },

    setFocusedExplanationChange: (workspaceId, changeIndex) =>
      patch(workspaceId, (current) => ({ ...current, focusedChangeIndex: changeIndex })),

    setActiveExplanationItem: (workspaceId, itemId) =>
      patch(workspaceId, (current) => ({ ...current, activeItemId: itemId })),

    stepExplanationItem: (workspaceId, direction) =>
      stepExplanationItem(get, workspaceId, direction)
  }
}
