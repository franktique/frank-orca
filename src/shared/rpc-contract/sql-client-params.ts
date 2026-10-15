import { z } from 'zod'

// Agents get read and run access only (FR-033): there is deliberately no method that creates,
// edits or deletes connections, saved queries or collections.

const worktree = z.string().optional()

export const SqlConnectionsParams = z.object({ worktree })

export const SqlQueriesParams = z.object({
  worktree,
  /** A connection id or exact (case-insensitive) name. */
  connection: z.string().min(1).optional()
})

export const SqlRunParams = z
  .object({
    worktree,
    /** A connection id or exact (case-insensitive) name. */
    connection: z.string().min(1),
    sql: z.string().min(1).optional(),
    /** A saved query id or exact (case-insensitive) name under that connection. */
    savedQuery: z.string().min(1).optional(),
    /** The whole run, not each statement. Default 30. */
    timeoutSeconds: z.number().int().min(1).max(600).optional()
  })
  .refine((params) => (params.sql === undefined) !== (params.savedQuery === undefined), {
    message: 'Pass exactly one of sql or savedQuery.'
  })
