import { latestResultSchema, runSchema } from '../../shared/api-client/api-client-schemas'
import type { ApiNodeId, LatestResult, Run } from '../../shared/api-client/api-client-types'
import type { ApiClientStore } from './api-client-store'
import { readJsonFile, removeFileIfPresent, writeJsonFile } from './api-client-store-files'

/** Latest result per request and latest run per scope; both live beside the collections. */
export async function writeLatestResult(
  store: ApiClientStore,
  worktreeId: string,
  result: LatestResult
): Promise<void> {
  const data = await store.getState(worktreeId)
  await store.writeMetaIfMissing(data)
  await writeJsonFile(data.paths.resultFile(result.requestId), result)
}

export async function readLatestResult(
  store: ApiClientStore,
  worktreeId: string,
  requestId: ApiNodeId
): Promise<LatestResult | null> {
  const data = await store.getState(worktreeId)
  const read = await readJsonFile(
    data.paths.resultFile(requestId),
    latestResultSchema,
    data.paths.corruptDir
  )
  return read.kind === 'ok' ? read.value : null
}

export async function writeLatestRun(
  store: ApiClientStore,
  worktreeId: string,
  scopeId: ApiNodeId,
  run: Run
): Promise<void> {
  const data = await store.getState(worktreeId)
  await store.writeMetaIfMissing(data)
  await writeJsonFile(data.paths.runFile(scopeId), run)
}

export async function readLatestRun(
  store: ApiClientStore,
  worktreeId: string,
  scopeId: ApiNodeId
): Promise<Run | null> {
  const data = await store.getState(worktreeId)
  const read = await readJsonFile(data.paths.runFile(scopeId), runSchema, data.paths.corruptDir)
  return read.kind === 'ok' ? read.value : null
}

export async function clearLatestRun(
  store: ApiClientStore,
  worktreeId: string,
  scopeId: ApiNodeId
): Promise<void> {
  const data = await store.getState(worktreeId)
  await removeFileIfPresent(data.paths.runFile(scopeId))
}
