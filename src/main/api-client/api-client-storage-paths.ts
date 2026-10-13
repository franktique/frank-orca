import { join } from 'node:path'
import { getAppEnvironment } from '../../shared/app-environment'
import { hashWorktreeId } from '../terminal-history-id'

export const API_CLIENT_PENDING_DELETE_DIR_NAME = '.pending-delete'
export const API_CLIENT_CORRUPT_DIR_NAME = 'corrupt'

export function getApiClientRoot(): string {
  return join(getAppEnvironment().getPath('userData'), 'api-client')
}

export type ApiClientWorktreePaths = {
  root: string
  dir: string
  metaFile: string
  stateFile: string
  collectionsDir: string
  environmentsDir: string
  resultsDir: string
  runsDir: string
  corruptDir: string
  collectionFile: (collectionId: string) => string
  environmentFile: (environmentId: string) => string
  resultFile: (requestId: string) => string
  runFile: (scopeId: string) => string
}

// Why: node ids come from imported Postman files, so they must never escape the data dir.
export function toSafeFileStem(nodeId: string): string {
  return encodeURIComponent(nodeId).replace(/\./g, '%2E')
}

/** `root` is a parameter so tests can use a temp dir. */
export function getApiClientWorktreePaths(
  worktreeId: string,
  root: string = getApiClientRoot()
): ApiClientWorktreePaths {
  const dir = join(root, hashWorktreeId(worktreeId))
  return {
    root,
    dir,
    metaFile: join(dir, 'meta.json'),
    stateFile: join(dir, 'state.json'),
    collectionsDir: join(dir, 'collections'),
    environmentsDir: join(dir, 'environments'),
    resultsDir: join(dir, 'results'),
    runsDir: join(dir, 'runs'),
    corruptDir: join(dir, API_CLIENT_CORRUPT_DIR_NAME),
    collectionFile: (id) => join(dir, 'collections', `${toSafeFileStem(id)}.json`),
    environmentFile: (id) => join(dir, 'environments', `${toSafeFileStem(id)}.json`),
    resultFile: (id) => join(dir, 'results', `${toSafeFileStem(id)}.json`),
    runFile: (id) => join(dir, 'runs', `${toSafeFileStem(id)}.json`)
  }
}

export function getApiClientPendingDeleteRoot(root: string = getApiClientRoot()): string {
  return join(root, API_CLIENT_PENDING_DELETE_DIR_NAME)
}
