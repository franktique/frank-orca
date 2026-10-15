import { readFile, stat } from 'node:fs/promises'
import type { ApiClientResult } from '../../shared/api-client/api-client-ipc-schemas'
import type { ApiNodeId, Collection, Environment } from '../../shared/api-client/api-client-types'
import {
  collectFolderIds,
  flattenRequestsDepthFirst
} from '../../shared/api-client/collection-tree'
import { importPostmanJson } from '../../shared/api-client/postman-import'
import { detectPostmanFileKind } from '../../shared/api-client/postman-schema'
import { getSecretProtection } from '../secret-value-codec'
import { failure, type ApiClientStore, type WorktreeApiState } from './api-client-store'
import type { StoreTransaction } from './api-client-store-transaction'

const MAX_IMPORT_FILE_BYTES = 100 * 1024 * 1024
const NAME_MAX_LENGTH = 200

export type ImportMode = 'replace' | 'keep-both'
type ImportSuccess = { kind: 'collection' | 'environment'; id: ApiNodeId; warnings: string[] }

/** Reads and parses the file; any problem is reported as `invalid-import` and nothing is written. */
export async function readPostmanFile(
  filePath: string
): Promise<{ ok: true; json: unknown } | ReturnType<typeof failure>> {
  try {
    const info = await stat(filePath)
    if (!info.isFile() || info.size > MAX_IMPORT_FILE_BYTES) {
      return failure('invalid-import', 'The selected file is not a readable JSON file.')
    }
    return { ok: true, json: JSON.parse(await readFile(filePath, 'utf8')) }
  } catch {
    return failure('invalid-import', 'The selected file is not valid JSON.')
  }
}

function peekName(json: unknown): string | null {
  if (typeof json !== 'object' || json === null) {
    return null
  }
  const info = 'info' in json ? json.info : null
  const candidate =
    typeof info === 'object' && info !== null && 'name' in info
      ? info.name
      : 'name' in json
        ? json.name
        : null
  return typeof candidate === 'string' ? candidate : null
}

function allNodeIds(data: WorktreeApiState, exceptCollectionId?: ApiNodeId): Set<string> {
  const ids = new Set<string>()
  for (const collection of data.collections.values()) {
    if (collection.id === exceptCollectionId) {
      continue
    }
    ids.add(collection.id)
    for (const request of flattenRequestsDepthFirst(collection)) {
      ids.add(request.id)
    }
    for (const folderId of collectFolderIds(collection)) {
      ids.add(folderId)
    }
  }
  for (const environment of data.environments.values()) {
    ids.add(environment.id)
  }
  return ids
}

function uniqueName(name: string, taken: Set<string>): string {
  let suffix = 2
  let candidate = name
  while (taken.has(candidate)) {
    const tail = ` (${suffix++})`
    candidate = `${name.slice(0, NAME_MAX_LENGTH - tail.length)}${tail}`
  }
  return candidate
}

function replaceCollection(
  data: WorktreeApiState,
  tx: StoreTransaction,
  existing: Collection,
  incoming: Collection
): void {
  const keptIds = new Set([
    ...flattenRequestsDepthFirst(incoming).map((r) => r.id),
    ...collectFolderIds(incoming)
  ])
  tx.removeResults(
    flattenRequestsDepthFirst(existing)
      .map((r) => r.id)
      .filter((id) => !keptIds.has(id))
  )
  tx.removeRuns([existing.id, ...collectFolderIds(existing)].filter((id) => !keptIds.has(id)))
  data.collections.set(existing.id, { ...incoming, id: existing.id, revision: existing.revision })
  tx.touchCollection(existing.id)
}

function addCollection(
  store: ApiClientStore,
  data: WorktreeApiState,
  tx: StoreTransaction,
  json: unknown,
  mode: ImportMode | undefined
): ApiClientResult<ImportSuccess> {
  const name = peekName(json) ?? ''
  const existing = [...data.collections.values()].find((c) => c.name === name)
  if (existing && !mode) {
    return failure('duplicate-name', `A collection named "${name}" already exists.`, {
      existingId: existing.id
    })
  }
  const replacing = existing && mode === 'replace' ? existing : undefined
  const parsed = importPostmanJson(json, {
    newId: store.newId,
    takenIds: allNodeIds(data, replacing?.id)
  })
  if (!parsed.ok || parsed.kind !== 'collection') {
    return failure('invalid-import', parsed.ok ? 'Expected a collection file.' : parsed.message)
  }
  const { collection, warnings } = parsed
  if (replacing) {
    replaceCollection(data, tx, replacing, collection)
    return { ok: true, kind: 'collection', id: replacing.id, warnings }
  }
  collection.name = uniqueName(
    collection.name,
    new Set([...data.collections.values()].map((c) => c.name))
  )
  data.collections.set(collection.id, collection)
  tx.touchCollection(collection.id)
  return { ok: true, kind: 'collection', id: collection.id, warnings }
}

function addEnvironment(
  store: ApiClientStore,
  data: WorktreeApiState,
  tx: StoreTransaction,
  json: unknown,
  mode: ImportMode | undefined
): ApiClientResult<ImportSuccess> {
  const name = peekName(json) ?? ''
  const existing = [...data.environments.values()].find((e) => e.name === name)
  if (existing && !mode) {
    return failure('duplicate-name', `An environment named "${name}" already exists.`, {
      existingId: existing.id
    })
  }
  const replacing = existing && mode === 'replace' ? existing : undefined
  const taken = allNodeIds(data)
  if (replacing) {
    taken.delete(replacing.id)
  }
  const parsed = importPostmanJson(json, { newId: store.newId, takenIds: taken })
  if (!parsed.ok || parsed.kind !== 'environment') {
    return failure('invalid-import', parsed.ok ? 'Expected an environment file.' : parsed.message)
  }
  const environment: Environment = parsed.environment
  if (replacing) {
    data.environments.set(replacing.id, {
      ...environment,
      id: replacing.id,
      revision: replacing.revision
    })
    tx.touchEnvironment(replacing.id)
    return { ok: true, kind: 'environment', id: replacing.id, warnings: [] }
  }
  environment.name = uniqueName(
    environment.name,
    new Set([...data.environments.values()].map((e) => e.name))
  )
  data.environments.set(environment.id, environment)
  tx.touchEnvironment(environment.id)
  return { ok: true, kind: 'environment', id: environment.id, warnings: [] }
}

export async function importPostmanContent(
  store: ApiClientStore,
  worktreeId: string,
  json: unknown,
  mode?: ImportMode
): Promise<ApiClientResult<ImportSuccess>> {
  const kind = detectPostmanFileKind(json)
  if (!kind) {
    return failure('invalid-import', 'This file is not a Postman collection or environment.')
  }
  const result = await store.transact(worktreeId, (data, tx) =>
    kind === 'collection'
      ? addCollection(store, data, tx, json, mode)
      : addEnvironment(store, data, tx, json, mode)
  )
  if (result.ok && kind === 'environment') {
    const protection = getSecretProtection(store.secretStore)
    return protection ? { ...result, secretProtection: protection } : result
  }
  return result
}
