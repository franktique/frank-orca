export type SqlSslMode = 'disable' | 'prefer' | 'require'

export type SealedSecret = { cipher: string }

export type SqlAgentAccess = 'full' | 'read-only'

export type SqlPasswordState = 'set' | 'empty' | 'needs-reentry' | 'session-only'

export type SqlConnection = {
  id: string
  name: string
  host: string
  port: number
  user: string
  database: string
  sslMode: SqlSslMode
  password: SealedSecret | null
  createdAt: string
  updatedAt: string
  revision: number
}

export type SqlConnectionStatus =
  | { state: 'idle' | 'connecting' | 'connected' }
  | { state: 'error'; message: string; code?: string }

/** What the renderer and agents see: never carries the password or cipher. */
export type SqlConnectionView = Omit<SqlConnection, 'password'> & {
  passwordState: SqlPasswordState
  agentAccess: SqlAgentAccess
  status: SqlConnectionStatus
}

export type SqlQueryCollection = {
  id: string
  connectionId: string
  name: string
  createdAt: string
  revision: number
}

export type SqlSavedQuery = {
  id: string
  connectionId: string
  collectionId: string | null
  name: string
  sql: string
  createdAt: string
  updatedAt: string
  revision: number
}

export type ProjectSqlData = {
  projectKey: string
  connections: SqlConnection[]
  collections: SqlQueryCollection[]
  queries: SqlSavedQuery[]
}

export type SqlPersistedTab = {
  draftText: string
  connectionId: string | null
  savedQueryId: string | null
  savedQueryRevision: number | null
  splitRatio: number
}

export type SqlColumn = { name: string; dataTypeId: number; dataTypeName: string }

export type SqlRunErrorCategory =
  | 'syntax'
  | 'connection'
  | 'auth'
  | 'ssl'
  | 'read-only'
  | 'not-local'
  | 'other'

export type SqlRunError = {
  message: string
  code?: string
  /** 1-based character offset into the whole run text. */
  position?: number
  detail?: string
  hint?: string
  /** 0-based; with explicit transaction control, statements before it already ran. */
  failedStatementIndex?: number
  failedStatementText?: string
  nothingApplied?: boolean
  category: SqlRunErrorCategory
}

export type SqlRunResult =
  | {
      kind: 'rows'
      columns: SqlColumn[]
      rows: (string | null)[][]
      rowCount: number
      rowCapApplied: boolean
      sizeLimitReached: boolean
      statementCount: number
      elapsedMs: number
    }
  | {
      kind: 'command'
      command: string
      affectedRows: number | null
      statementCount: number
      elapsedMs: number
    }
  | { kind: 'error'; error: SqlRunError; elapsedMs: number }
  | { kind: 'cancelled'; elapsedMs: number }
  | { kind: 'timed-out'; timeoutMs: number; elapsedMs: number }

export type SqlSchema = { name: string }

export type SqlRelationKind =
  | 'table'
  | 'view'
  | 'materialized-view'
  | 'partitioned-table'
  | 'foreign-table'

export type SqlRelation = { schema: string; name: string; kind: SqlRelationKind }

export type SqlColumnInfo = {
  name: string
  dataTypeName: string
  nullable: boolean
  isPrimaryKey: boolean
  ordinal: number
}
