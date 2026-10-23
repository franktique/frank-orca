import type { TestMap } from '../../../../../shared/test-orchestrator/test-orchestrator-types'

export type RequestTestMapMarker = 'has-queries' | 'broken'

/** Per-request marker for the tree: linked entries with queries, and links whose request is gone. */
export function buildRequestMarkers(testMap: TestMap | null): Map<string, RequestTestMapMarker> {
  const markers = new Map<string, RequestTestMapMarker>()
  for (const entry of testMap?.entries ?? []) {
    if (entry.link.state === 'broken') {
      markers.set(entry.link.lastRequestId, 'broken')
    } else if (entry.link.state === 'linked' && (entry.before.length || entry.after.length)) {
      markers.set(entry.link.requestId, 'has-queries')
    }
  }
  return markers
}

export function countBrokenLinks(testMap: TestMap | null): number {
  return testMap?.entries.filter((entry) => entry.link.state === 'broken').length ?? 0
}
