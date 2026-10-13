import type { ApiClientResult } from '../../shared/api-client/api-client-ipc-schemas'
import type { ApiNodeId } from '../../shared/api-client/api-client-types'
import { exportPostmanCollection } from '../../shared/api-client/postman-export'
import { exportPostmanEnvironment } from '../../shared/api-client/postman-environment-export'
import { durableWriteTempPath, writeFileDurable } from '../durable-file-write'
import { failure, type ApiClientStore } from './api-client-store'

/** Secrets are decrypted here, in main, only for the file write; nothing returns to the renderer. */
export async function exportPostmanFile(
  store: ApiClientStore,
  params: {
    worktreeId: string
    kind: 'collection' | 'environment'
    id: ApiNodeId
    filePath: string
  }
): Promise<ApiClientResult> {
  const snapshot = await store.getSnapshot(params.worktreeId, { revealSecrets: true })
  const json =
    params.kind === 'collection'
      ? exportCollectionOf(snapshot.collections, params.id)
      : exportEnvironmentOf(snapshot.environments, params.id)
  if (!json) {
    return failure('not-found', 'The item to export no longer exists.')
  }
  try {
    await writeFileDurable(
      durableWriteTempPath(params.filePath),
      params.filePath,
      JSON.stringify(json, null, 2)
    )
  } catch (error) {
    return failure(
      'invalid-request',
      `The file could not be written: ${error instanceof Error ? error.message : String(error)}`
    )
  }
  return { ok: true }
}

function exportCollectionOf(
  collections: Awaited<ReturnType<ApiClientStore['getSnapshot']>>['collections'],
  id: ApiNodeId
): object | null {
  const collection = collections.find((candidate) => candidate.id === id)
  return collection ? exportPostmanCollection(collection) : null
}

function exportEnvironmentOf(
  environments: Awaited<ReturnType<ApiClientStore['getSnapshot']>>['environments'],
  id: ApiNodeId
): object | null {
  const environment = environments.find((candidate) => candidate.id === id)
  return environment ? exportPostmanEnvironment(environment) : null
}
