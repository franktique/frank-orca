// Serializes a loaded test map back to the `orcaTestMap: 1` file format.
import type { ApiItem, ApiNodeId, Collection } from '../api-client/api-client-types'
import type { TestMapFile } from './test-map-schema'
import type {
  TestMap,
  TestMapEntry,
  TestMapRef,
  VerificationQuery
} from './test-orchestrator-types'

export function findRequestPath(
  items: ApiItem[],
  id: ApiNodeId,
  parents: string[]
): string[] | null {
  for (const item of items) {
    if (item.kind === 'request') {
      if (item.id === id) {
        return [...parents, item.name]
      }
    } else {
      const found = findRequestPath(item.items, id, [...parents, item.name])
      if (found) {
        return found
      }
    }
  }
  return null
}

// Paths survive re-import and other machines; ids do not.
function exportRef(entry: TestMapEntry, collection: Collection): TestMapRef {
  if (entry.link.state === 'linked') {
    const path = findRequestPath(collection.items, entry.link.requestId, [])
    if (path) {
      return { path }
    }
  }
  return entry.ref
}

const exportQuery = (query: VerificationQuery): VerificationQuery => ({
  id: query.id,
  sql: query.sql,
  ...(query.description !== undefined ? { description: query.description } : {}),
  precondition: query.precondition,
  changesData: query.changesData
})

function exportEntry(entry: TestMapEntry, collection: Collection): TestMapFile['entries'][number] {
  return {
    request: exportRef(entry, collection),
    before: entry.before.map(exportQuery),
    after: entry.after.map(exportQuery),
    ...(entry.stepId !== undefined ? { stepId: entry.stepId } : {}),
    ...(entry.title !== undefined ? { title: entry.title } : {}),
    ...(entry.phase !== undefined ? { phase: entry.phase } : {}),
    ...(entry.expect !== undefined ? { expect: entry.expect } : {}),
    ...(entry.expectAll !== undefined ? { expectAll: entry.expectAll } : {}),
    ...(entry.captures !== undefined ? { captures: entry.captures } : {}),
    ...(entry.dependsOn !== undefined ? { dependsOn: entry.dependsOn } : {}),
    ...(entry.concurrentGroup !== undefined ? { concurrentGroup: entry.concurrentGroup } : {}),
    ...(entry.forEach !== undefined ? { forEach: entry.forEach } : {})
  }
}

export function exportTestMap(map: TestMap, collection: Collection): TestMapFile {
  return {
    orcaTestMap: 1,
    ...(map.guidePath !== undefined ? { guide: map.guidePath } : {}),
    ...(map.allowedHosts !== undefined ? { allowedHosts: map.allowedHosts } : {}),
    ...(map.databaseConsole !== undefined ? { databaseConsole: map.databaseConsole } : {}),
    entries: map.entries.map((entry) => exportEntry(entry, collection))
  }
}

export function serializeTestMap(map: TestMap, collection: Collection): string {
  return `${JSON.stringify(exportTestMap(map, collection), null, 2)}\n`
}
