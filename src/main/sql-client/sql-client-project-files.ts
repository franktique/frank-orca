import { readFile } from 'node:fs/promises'
import type { z } from 'zod'
import type {
  SqlClientErrorCode,
  SqlClientFailure
} from '../../shared/sql-client/sql-client-ipc-schemas'
import {
  SQL_SCHEMA_VERSION,
  sqlConnectionsFileSchema,
  sqlMetaFileSchema,
  sqlQueriesFileSchema
} from '../../shared/sql-client/sql-client-schemas'
import type {
  SqlConnection,
  SqlQueryCollection,
  SqlSavedQuery
} from '../../shared/sql-client/sql-client-types'
import { readJsonFile, writeJsonFile } from '../api-client/api-client-store-files'
import { getProjectSqlPaths, type ProjectSqlPaths } from './sql-client-storage-paths'

export const NEWER_DATA_MESSAGE = 'This project’s SQL data was written by a newer Orca.'

export class SqlStoreError extends Error {
  constructor(
    readonly code: SqlClientErrorCode,
    message: string
  ) {
    super(message)
  }
}

export type ProjectSqlRecords = {
  connections: SqlConnection[]
  collections: SqlQueryCollection[]
  queries: SqlSavedQuery[]
}

export type ProjectState = ProjectSqlRecords & {
  projectKey: string
  paths: ProjectSqlPaths
  createdAt: string
  metaOnDisk: boolean
  /** Passwords kept for this session only when the host cannot encrypt. */
  sessionPasswords: Map<string, string>
  /** Serializes mutations so two writes never interleave their file updates. */
  queue: Promise<unknown>
}

/** A future-version file may not fit today's shape; it must be refused, never quarantined. */
async function refuseNewerFile(path: string): Promise<void> {
  let parsed: unknown
  try {
    parsed = JSON.parse(await readFile(path, 'utf8'))
  } catch {
    return
  }
  if (
    typeof parsed === 'object' &&
    parsed !== null &&
    'schemaVersion' in parsed &&
    typeof parsed.schemaVersion === 'number' &&
    parsed.schemaVersion > SQL_SCHEMA_VERSION
  ) {
    throw new SqlStoreError('storage', NEWER_DATA_MESSAGE)
  }
}

async function readOk<S extends z.ZodType>(
  path: string,
  schema: S,
  corruptDir: string
): Promise<z.output<S> | null> {
  const result = await readJsonFile(path, schema, corruptDir)
  return result.kind === 'ok' ? result.value : null
}

export async function loadProjectState(projectKey: string, root?: string): Promise<ProjectState> {
  const paths = getProjectSqlPaths(projectKey, root)
  await Promise.all([paths.metaFile, paths.connectionsFile, paths.queriesFile].map(refuseNewerFile))
  const meta = await readOk(paths.metaFile, sqlMetaFileSchema, paths.corruptDir)
  const connections = await readOk(
    paths.connectionsFile,
    sqlConnectionsFileSchema,
    paths.corruptDir
  )
  const queries = await readOk(paths.queriesFile, sqlQueriesFileSchema, paths.corruptDir)
  return {
    projectKey,
    paths,
    createdAt: meta?.createdAt ?? new Date().toISOString(),
    metaOnDisk: meta !== null,
    connections: connections?.connections ?? [],
    collections: queries?.collections ?? [],
    queries: queries?.queries ?? [],
    sessionPasswords: new Map(),
    queue: Promise.resolve()
  }
}

export async function persistProjectRecords(
  state: ProjectState,
  next: ProjectSqlRecords,
  which: { connections: boolean; queries: boolean }
): Promise<void> {
  if (!state.metaOnDisk) {
    await writeJsonFile(state.paths.metaFile, {
      schemaVersion: SQL_SCHEMA_VERSION,
      projectKey: state.projectKey,
      createdAt: state.createdAt
    })
    state.metaOnDisk = true
  }
  if (which.connections) {
    await writeJsonFile(state.paths.connectionsFile, {
      schemaVersion: SQL_SCHEMA_VERSION,
      connections: next.connections
    })
  }
  if (which.queries) {
    await writeJsonFile(state.paths.queriesFile, {
      schemaVersion: SQL_SCHEMA_VERSION,
      collections: next.collections,
      queries: next.queries
    })
  }
}

export function toSqlStoreFailure(error: unknown): SqlClientFailure {
  if (error instanceof SqlStoreError) {
    return { ok: false, code: error.code, message: error.message }
  }
  return {
    ok: false,
    code: 'storage',
    message: error instanceof Error ? error.message : 'Could not read or write SQL data.'
  }
}
