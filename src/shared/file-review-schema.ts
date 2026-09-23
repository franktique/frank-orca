import { z } from 'zod'

export const FileReviewSignatureSchema = z.object({
  status: z.string(),
  added: z.number().finite(),
  removed: z.number().finite()
})

export const FileReviewRecordSchema = z.record(z.string(), FileReviewSignatureSchema)
