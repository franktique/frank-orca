import { z } from 'zod'

// Agents get read and run access only (FR-035): there is deliberately no method that creates,
// edits or deletes collections, environments or requests.

const worktree = z.string().optional()
const id = z.string().min(1)

export const ApiClientListParams = z.object({ worktree })

export const ApiClientEnvironmentsParams = z.object({ worktree })

export const ApiClientRunParams = z.object({
  worktree,
  /** A request, folder or collection id. */
  targetId: id,
  /** An environment id or name; `null` (or "none") runs without one. Omitted = the active one. */
  environment: z.union([z.string(), z.null()]).optional(),
  iterations: z.number().int().min(1).max(1000).optional(),
  delayMs: z.number().int().min(0).max(60_000).optional(),
  stopOnFailure: z.boolean().optional(),
  /** Stops the run and returns what finished. Default 10 minutes. */
  timeoutMs: z
    .number()
    .int()
    .min(1000)
    .max(60 * 60_000)
    .optional()
})

export const ApiClientResultParams = z.object({ worktree, requestId: id })

export const ApiClientShowParams = z.object({ worktree, requestId: id })
