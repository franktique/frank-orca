import { API_CLIENT_LIMITS, type ConsoleEntry } from '../../shared/api-client/api-client-types'

type AppendListener = (entry: ConsoleEntry) => void

/** Keeps only a preview of large bodies; the full body stays in the request's latest result. */
function capPreview(entry: ConsoleEntry): ConsoleEntry {
  const limit = API_CLIENT_LIMITS.consolePreviewMaxBytes
  let capped = entry
  const requestBody = entry.request.body
  if (requestBody !== null && requestBody.length > limit) {
    capped = { ...capped, request: { ...capped.request, body: requestBody.slice(0, limit) } }
  }
  if (entry.outcome.kind === 'response') {
    const body = entry.outcome.response.body
    if (body.text !== undefined && body.text.length > limit) {
      capped = {
        ...capped,
        outcome: {
          kind: 'response',
          response: {
            ...entry.outcome.response,
            body: { ...body, text: body.text.slice(0, limit), truncated: true }
          }
        }
      }
    }
  }
  return capped
}

/** In-memory ring buffer per worktree. Never persisted. */
export class ApiClientConsoleBuffer {
  private readonly entriesByWorktree = new Map<string, ConsoleEntry[]>()
  private readonly listeners = new Set<AppendListener>()

  constructor(private readonly capacity: number = API_CLIENT_LIMITS.consoleEntriesMax) {}

  append(entry: ConsoleEntry): ConsoleEntry {
    const stored = capPreview(entry)
    const entries = this.entriesByWorktree.get(stored.worktreeId) ?? []
    entries.push(stored)
    if (entries.length > this.capacity) {
      entries.splice(0, entries.length - this.capacity)
    }
    this.entriesByWorktree.set(stored.worktreeId, entries)
    for (const listener of this.listeners) {
      listener(stored)
    }
    return stored
  }

  list(worktreeId: string): ConsoleEntry[] {
    return [...(this.entriesByWorktree.get(worktreeId) ?? [])]
  }

  clear(worktreeId: string): void {
    this.entriesByWorktree.delete(worktreeId)
  }

  onAppend(listener: AppendListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
}
