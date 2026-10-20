import { z } from 'zod'
import { ExplanationQuestionUpsertSchema } from '../agent-explanations/explanation-schemas'

// Params for the explanation.* runtime RPC (contracts/cli-rpc.md). Every method
// takes a worktree selector; main resolves it against the workspace launch scope.
const worktree = z.string().min(1)

export const ExplanationPublishParams = z.object({
  worktree,
  // Parsed by explanation-publish against the publish-payload contract, so the
  // fatal error can name the zod path instead of a generic params failure.
  payload: z.unknown(),
  agent: z.string().max(40).optional(),
  terminalHandle: z.string().optional()
})

export const ExplanationGetParams = z.object({ worktree })

export const ExplanationClearParams = z.object({
  worktree,
  // Only clears when this set is still current (guards a race with a new publish).
  explanationId: z.string().optional()
})

export const ExplanationFileDiffParams = z.object({
  worktree,
  path: z.string().min(1),
  oldPath: z.string().optional(),
  mergeBase: z.string().min(1)
})

export const ExplanationChangeSetParams = z.object({ worktree })

export const ExplanationQuestionUpsertParams = z.object({
  worktree,
  explanationId: z.string().min(1),
  question: ExplanationQuestionUpsertSchema
})

export const ExplanationQuestionMarkSentParams = z.object({
  worktree,
  explanationId: z.string().min(1),
  questionIds: z.array(z.string().min(1)).min(1),
  sentTo: z.object({
    paneKey: z.string().optional(),
    label: z.string().min(1)
  })
})

export const ExplanationQuestionDeleteParams = z.object({
  worktree,
  explanationId: z.string().min(1),
  questionId: z.string().min(1)
})
