import type {
  TestMap,
  VerificationQuery
} from '../../../../../shared/test-orchestrator/test-orchestrator-types'

export type QueryGroup = 'before' | 'after'
export type QueryLists = Record<QueryGroup, VerificationQuery[]>

export function listsForRequest(testMap: TestMap | null, requestId: string): QueryLists {
  const entry = testMap?.entries.find(
    (candidate) => candidate.link.state === 'linked' && candidate.link.requestId === requestId
  )
  return { before: entry?.before ?? [], after: entry?.after ?? [] }
}

export function newVerificationQuery(): VerificationQuery {
  return { id: crypto.randomUUID(), sql: '', precondition: false, changesData: false }
}

export function moveQuery(
  list: VerificationQuery[],
  index: number,
  by: -1 | 1
): VerificationQuery[] {
  const target = index + by
  if (target < 0 || target >= list.length) {
    return list
  }
  const next = [...list]
  ;[next[index], next[target]] = [next[target], next[index]]
  return next
}
