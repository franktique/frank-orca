import type { AppState } from '../../types'
import type { UISlice } from './ui-slice-contract'
import type { PersistedUIWriteBaseline } from '../persisted-ui-write-baseline'
import {
  capturePersistedUIWriteBaseline,
  diffPersistedUIWriteFields
} from '../persisted-ui-write-baseline'
import { hydratedUIPartialMatchesState } from './ui-slice-hydration-sanitizers'

/**
 * Reconciles a freshly hydrated mirror against the writer's pending baseline (STA-5781).
 *
 * The incoming payload is authoritative for the writer-owned fields, so it becomes the
 * writer's new diff baseline — but fields with an unflushed local edit (mirror diverged
 * from the previous baseline) keep the local value so a broadcast arriving inside the
 * writer's debounce window can't silently revert what the user just toggled.
 * Order matters: capture the baseline BEFORE overlaying pending edits, or the baseline
 * would equal the pending value, the diff would go empty, and the toggle would be dropped.
 */
export function reconcileHydratedPersistedUIWriteBaseline(
  s: AppState,
  hydrated: PersistedUIWriteBaseline & Record<string, unknown>
): Partial<AppState> {
  const nextWriteBaseline = capturePersistedUIWriteBaseline(hydrated)
  const previousBaseline = s.persistedUIWriteBaseline
  if (previousBaseline) {
    const pendingLocalEdits = diffPersistedUIWriteFields(
      capturePersistedUIWriteBaseline(s),
      previousBaseline
    )
    Object.assign(hydrated, pendingLocalEdits)
    // In-flight fields too: a flip-back to the baseline value diffs empty,
    // yet the in-flight write's echo must not revert it (PR#17057 review).
    for (const field of Object.keys(
      s.persistedUIWriteInFlightCounts
    ) as (keyof PersistedUIWriteBaseline)[]) {
      ;(hydrated as Record<string, unknown>)[field] = s[field]
    }
  }
  // Why: return the same ref on identical hydration so App's debounced writer doesn't echo it back to main.
  // The baseline must still advance when it moved (a remote same-field write during an in-flight
  // ack pins the only visibly differing field, and our own echo precedes every ack) — but only
  // the two baseline keys, or every ordinary write's echo would churn the store's collection
  // identities and re-render identity-compared selectors once per write.
  // Why the generation bumps only on baseline movement: an unrelated-field
  // broadcast during an in-flight write would otherwise void that write's
  // fold and cost a redundant trailing re-send of identical values.
  const writeBaselineMoved =
    !previousBaseline ||
    Object.keys(diffPersistedUIWriteFields(nextWriteBaseline, previousBaseline)).length > 0
  const nextWriteBaselineGeneration = writeBaselineMoved
    ? s.persistedUIWriteBaselineGeneration + 1
    : s.persistedUIWriteBaselineGeneration
  if (hydratedUIPartialMatchesState(s, hydrated as Partial<UISlice>)) {
    if (!writeBaselineMoved) {
      return s
    }
    return {
      persistedUIWriteBaseline: nextWriteBaseline,
      persistedUIWriteBaselineGeneration: nextWriteBaselineGeneration
    }
  }
  return {
    ...hydrated,
    persistedUIWriteBaseline: nextWriteBaseline,
    persistedUIWriteBaselineGeneration: nextWriteBaselineGeneration
  } as Partial<AppState>
}
