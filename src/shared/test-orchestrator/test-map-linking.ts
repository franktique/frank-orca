// Links test-map request references to collection requests. See research.md R4.
import type { ApiItem, ApiNodeId, Collection } from '../api-client/api-client-types'
import type { TestMap, TestMapEntry, TestMapLink, TestMapRef } from './test-orchestrator-types'
import type { TestMapFile } from './test-map-schema'

export type LinkWarnings = {
  unmatched: TestMapRef[]
  ambiguous: { ref: TestMapRef; candidates: ApiNodeId[] }[]
  broken: { ref: TestMapRef; lastRequestId: ApiNodeId }[]
}

export type LinkResult = { entries: TestMapEntry[]; warnings: LinkWarnings }

type IndexedRequest = { id: ApiNodeId; path: string[] }

function indexRequests(
  items: ApiItem[],
  parents: string[],
  out: IndexedRequest[]
): IndexedRequest[] {
  for (const item of items) {
    if (item.kind === 'folder') {
      indexRequests(item.items, [...parents, item.name], out)
    } else {
      out.push({ id: item.id, path: [...parents, item.name] })
    }
  }
  return out
}

const normalizeSegment = (segment: string): string =>
  segment.trim().replace(/\s+/g, ' ').toLowerCase()

const samePathExact = (a: string[], b: string[]): boolean =>
  a.length === b.length && a.every((segment, i) => segment === b[i])

const samePathLoose = (a: string[], b: string[]): boolean =>
  a.length === b.length &&
  a.every((segment, i) => normalizeSegment(segment) === normalizeSegment(b[i]))

function matchResult(candidates: ApiNodeId[]): TestMapLink | null {
  if (candidates.length === 1) {
    return { state: 'linked', requestId: candidates[0] }
  }
  return candidates.length > 1 ? { state: 'ambiguous', candidates } : null
}

function resolveLink(
  entry: TestMapEntry,
  requests: IndexedRequest[],
  ids: Set<ApiNodeId>
): TestMapLink {
  const previousId =
    entry.link.state === 'linked'
      ? entry.link.requestId
      : entry.link.state === 'broken'
        ? entry.link.lastRequestId
        : null
  const refId = 'id' in entry.ref ? entry.ref.id : null
  // Stable id wins over path so renames do not break links.
  for (const id of [refId, previousId]) {
    if (id !== null && ids.has(id)) {
      return { state: 'linked', requestId: id }
    }
  }
  if ('path' in entry.ref) {
    const { path } = entry.ref
    // Exact ambiguity must not fall through to the looser match.
    const byPath =
      matchResult(requests.filter((r) => samePathExact(r.path, path)).map((r) => r.id)) ??
      matchResult(requests.filter((r) => samePathLoose(r.path, path)).map((r) => r.id))
    if (byPath) {
      return byPath
    }
  }
  return previousId !== null
    ? { state: 'broken', lastRequestId: previousId }
    : { state: 'unmatched' }
}

export function linkTestMapEntries(entries: TestMapEntry[], collection: Collection): LinkResult {
  const requests = indexRequests(collection.items, [], [])
  const ids = new Set(requests.map((r) => r.id))
  const warnings: LinkWarnings = { unmatched: [], ambiguous: [], broken: [] }
  const linked = entries.map((entry) => {
    const link = resolveLink(entry, requests, ids)
    if (link.state === 'unmatched') {
      warnings.unmatched.push(entry.ref)
    } else if (link.state === 'ambiguous') {
      warnings.ambiguous.push({ ref: entry.ref, candidates: link.candidates })
    } else if (link.state === 'broken') {
      warnings.broken.push({ ref: entry.ref, lastRequestId: link.lastRequestId })
    }
    return { ...entry, link }
  })
  return { entries: linked, warnings }
}

/** Builds unlinked entries from a parsed file, then links them against the collection. */
export function linkTestMapFile(file: TestMapFile, collection: Collection): LinkResult {
  const entries: TestMapEntry[] = file.entries.map(({ request, ...rest }) => ({
    ...rest,
    ref: request,
    link: { state: 'unmatched' }
  }))
  return linkTestMapEntries(entries, collection)
}

/** Re-links from stored refs, e.g. after the collection is re-imported with new node ids. */
export function rematchTestMap(
  map: TestMap,
  collection: Collection
): { map: TestMap; warnings: LinkWarnings } {
  const { entries, warnings } = linkTestMapEntries(map.entries, collection)
  return { map: { ...map, collectionId: collection.id, entries }, warnings }
}
