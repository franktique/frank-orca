import { BrowserWindow, ipcMain } from 'electron'
import { z } from 'zod'
import type { OrcaRuntimeService } from '../../runtime/orca-runtime'
import { buildExplanationChangeSet } from '../../agent-explanations/explanation-change-set'
import { readExplanationFileDiff } from '../../agent-explanations/explanation-file-diff'
import {
  explanationChangeSetDeps,
  explanationFailure,
  explanationFileDiffBase,
  explanationFileDiffDeps,
  resolveExplanationWorkspace
} from '../../agent-explanations/explanation-runtime-access'
import { ExplanationQuestionUpsertSchema } from '../../../shared/agent-explanations/explanation-schemas'
import { getExplanationStore } from '../../agent-explanations/explanation-store'

export const EXPLANATION_CHANNELS = {
  get: 'explanations:get',
  changeSet: 'explanations:changeSet',
  fileDiff: 'explanations:fileDiff',
  clear: 'explanations:clear',
  questionUpsert: 'explanations:questions:upsert',
  questionMarkSent: 'explanations:questions:markSent',
  questionDelete: 'explanations:questions:delete',
  changed: 'explanations:changed'
} as const

// Why: connectionId is accepted for parity with window.api.git.diff, but the runtime
// resolves the SSH connection from the workspace id, so it is not read here.
const workspaceArgs = z.object({
  workspaceId: z.string().min(1),
  connectionId: z.string().optional()
})
const clearArgs = workspaceArgs.extend({ explanationId: z.string().optional() })
const upsertArgs = workspaceArgs.extend({
  explanationId: z.string().min(1),
  question: ExplanationQuestionUpsertSchema
})
const markSentArgs = workspaceArgs.extend({
  explanationId: z.string().min(1),
  questionIds: z.array(z.string().min(1)).min(1),
  sentTo: z.object({ paneKey: z.string().optional(), label: z.string().min(1) })
})
const deleteQuestionArgs = workspaceArgs.extend({
  explanationId: z.string().min(1),
  questionId: z.string().min(1)
})
const fileDiffArgs = workspaceArgs.extend({
  path: z.string().min(1),
  oldPath: z.string().optional(),
  mergeBase: z.string().min(1)
})

const toSelector = (workspaceId: string): string => `id:${workspaceId}`

function invalid(error: z.ZodError): ReturnType<typeof explanationFailure> {
  return explanationFailure('invalid_params', error.issues[0]?.message ?? 'Invalid request')
}

function broadcast(channel: string, payload: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send(channel, payload)
    }
  }
}

/** Read-only channels plus the change push; agents publish only through the CLI/RPC. */
export function registerExplanationHandlers(runtime: OrcaRuntimeService): void {
  for (const channel of [
    EXPLANATION_CHANNELS.get,
    EXPLANATION_CHANNELS.changeSet,
    EXPLANATION_CHANNELS.fileDiff,
    EXPLANATION_CHANNELS.clear,
    EXPLANATION_CHANNELS.questionUpsert,
    EXPLANATION_CHANNELS.questionMarkSent,
    EXPLANATION_CHANNELS.questionDelete
  ]) {
    ipcMain.removeHandler(channel)
  }

  ipcMain.handle(EXPLANATION_CHANNELS.get, async (_event, raw: unknown) => {
    const parsed = workspaceArgs.safeParse(raw)
    if (!parsed.success) {
      return invalid(parsed.error)
    }
    return {
      ok: true as const,
      explanation: await getExplanationStore().get(parsed.data.workspaceId)
    }
  })

  ipcMain.handle(EXPLANATION_CHANNELS.changeSet, async (_event, raw: unknown) => {
    const parsed = workspaceArgs.safeParse(raw)
    if (!parsed.success) {
      return invalid(parsed.error)
    }
    const selector = toSelector(parsed.data.workspaceId)
    const resolved = await resolveExplanationWorkspace(runtime, selector)
    if (!resolved.ok) {
      return resolved
    }
    const snapshot = await buildExplanationChangeSet(selector, explanationChangeSetDeps(runtime))
    return { ok: true as const, base: snapshot.base, files: snapshot.files }
  })

  ipcMain.handle(EXPLANATION_CHANNELS.fileDiff, async (_event, raw: unknown) => {
    const parsed = fileDiffArgs.safeParse(raw)
    if (!parsed.success) {
      return invalid(parsed.error)
    }
    const selector = toSelector(parsed.data.workspaceId)
    const resolved = await resolveExplanationWorkspace(runtime, selector)
    if (!resolved.ok) {
      return resolved
    }
    return readExplanationFileDiff(
      selector,
      parsed.data.path,
      explanationFileDiffBase(parsed.data.mergeBase),
      explanationFileDiffDeps(runtime)
    )
  })

  ipcMain.handle(EXPLANATION_CHANNELS.clear, async (_event, raw: unknown) => {
    const parsed = clearArgs.safeParse(raw)
    return parsed.success
      ? getExplanationStore().clear(parsed.data.workspaceId, parsed.data.explanationId)
      : invalid(parsed.error)
  })

  ipcMain.handle(EXPLANATION_CHANNELS.questionUpsert, async (_event, raw: unknown) => {
    const parsed = upsertArgs.safeParse(raw)
    return parsed.success
      ? getExplanationStore().upsertQuestion(
          parsed.data.workspaceId,
          parsed.data.explanationId,
          parsed.data.question
        )
      : invalid(parsed.error)
  })

  ipcMain.handle(EXPLANATION_CHANNELS.questionMarkSent, async (_event, raw: unknown) => {
    const parsed = markSentArgs.safeParse(raw)
    return parsed.success
      ? getExplanationStore().markQuestionsSent(
          parsed.data.workspaceId,
          parsed.data.explanationId,
          parsed.data.questionIds,
          parsed.data.sentTo
        )
      : invalid(parsed.error)
  })

  ipcMain.handle(EXPLANATION_CHANNELS.questionDelete, async (_event, raw: unknown) => {
    const parsed = deleteQuestionArgs.safeParse(raw)
    return parsed.success
      ? getExplanationStore().deleteQuestion(
          parsed.data.workspaceId,
          parsed.data.explanationId,
          parsed.data.questionId
        )
      : invalid(parsed.error)
  })

  getExplanationStore().subscribe(({ workspaceId, revision }) =>
    broadcast(EXPLANATION_CHANNELS.changed, { workspaceId, revision })
  )
}
