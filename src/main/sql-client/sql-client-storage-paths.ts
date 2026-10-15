import { join } from 'node:path'
import { getAppEnvironment } from '../../shared/app-environment'
import { hashWorktreeId } from '../terminal-history-id'

export const SQL_TOMBSTONE_DIR_NAME = '.tombstones'

export function getSqlClientRoot(): string {
  return join(getAppEnvironment().getPath('userData'), 'sql-client')
}

export type ProjectSqlPaths = {
  root: string
  dir: string
  metaFile: string
  connectionsFile: string
  queriesFile: string
  corruptDir: string
}

/** `root` is a parameter so tests can use a temp dir. */
export function getProjectSqlDir(projectKey: string, root: string = getSqlClientRoot()): string {
  return join(root, hashWorktreeId(projectKey))
}

export function getProjectSqlPaths(
  projectKey: string,
  root: string = getSqlClientRoot()
): ProjectSqlPaths {
  const dir = getProjectSqlDir(projectKey, root)
  return {
    root,
    dir,
    metaFile: join(dir, 'meta.json'),
    connectionsFile: join(dir, 'connections.json'),
    queriesFile: join(dir, 'queries.json'),
    corruptDir: join(dir, 'corrupt')
  }
}

export function getSqlTombstoneDir(root: string = getSqlClientRoot()): string {
  return join(root, SQL_TOMBSTONE_DIR_NAME)
}
