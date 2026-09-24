import { z } from 'zod'

export const FileReviewSignatureSchema = z.object({
  status: z.string(),
  added: z.number().finite(),
  removed: z.number().finite(),
  // Why .catch: records persisted before the 3-state checkbox never had `state`, and they only
  // ever meant "reviewed" — decode missing/invalid values as that instead of failing validation.
  state: z.enum(['reviewed', 'markedForDeletion']).catch('reviewed')
})

export const FileReviewRecordSchema = z.record(z.string(), FileReviewSignatureSchema)
