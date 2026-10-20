# Data Model: SQL Tab (PostgreSQL query client)

**Feature**: [spec.md](./spec.md) | **Research**: [research.md](./research.md)

Types live in `src/shared/sql-client/sql-client-types.ts`; zod schemas for storage and IPC in `src/shared/sql-client/sql-client-schemas.ts`. Ids are UUID v4 strings generated once and never changed (FR-034). Timestamps are ISO-8601 UTC strings.

## ProjectKey

Owner of all saved SQL data (clarification: per project).

| Form                    | Derived from                                               |
| ----------------------- | ---------------------------------------------------------- |
| `repo:<repoId>`         | git worktree id `repoId::path` (`getRepoIdFromWorktreeId`) |
| `folder-workspace:<id>` | folder workspace key `folder:<id>`                         |

Resolved in main by `resolveSqlProjectKey(store, worktreeId)`; never sent by the renderer as a free string (the renderer sends `worktreeId`, main derives the key — prevents cross-project access).

## ProjectSqlData (storage root, one per ProjectKey)

| Field         | Type                   | Notes              |
| ------------- | ---------------------- | ------------------ |
| `projectKey`  | `string`               | from `meta.json`   |
| `connections` | `SqlConnection[]`      | `connections.json` |
| `collections` | `SqlQueryCollection[]` | `queries.json`     |
| `queries`     | `SqlSavedQuery[]`      | `queries.json`     |

Deleted as a whole when the project is removed from Orca (FR-030).

## SqlConnection

| Field       | Type                                 | Validation / notes                                                    |
| ----------- | ------------------------------------ | --------------------------------------------------------------------- |
| `id`        | `string`                             | UUID, stable                                                          |
| `name`      | `string`                             | 1–100 chars, trimmed; unique within the project (case-insensitive)    |
| `host`      | `string`                             | 1–255 chars; hostname, IPv4/IPv6 literal, or absolute socket dir path |
| `port`      | `number`                             | integer 1–65535, default 5432                                         |
| `user`      | `string`                             | 1–63 chars                                                            |
| `database`  | `string`                             | 1–63 chars                                                            |
| `sslMode`   | `'disable' \| 'prefer' \| 'require'` | default `prefer`                                                      |
| `password`  | `SealedSecret \| null`               | storage only; never in IPC/RPC payloads                               |
| `createdAt` | `string`                             |                                                                       |
| `updatedAt` | `string`                             |                                                                       |
| `revision`  | `number`                             | incremented on each write; stale writes → `conflict`                  |

`SealedSecret = { cipher: string }` (base64 from `SecretStore`).

**Derived, not stored** (sent to the renderer as `SqlConnectionView`):

| Field           | Type                                                    | Rule                                                                                |
| --------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `passwordState` | `'set' \| 'empty' \| 'needs-reentry' \| 'session-only'` | decrypt failure → `needs-reentry`; encryption unavailable → `session-only`          |
| `agentAccess`   | `'full' \| 'read-only'`                                 | `full` iff host is `localhost`, `127.0.0.0/8`, `::1`, or an absolute path (FR-032a) |
| `status`        | `SqlConnectionStatus`                                   | live, see below                                                                     |

**Edit rule**: an update payload with `password: undefined` keeps the stored cipher; `password: ''` clears it; a string sets it (FR-006).

### SqlConnectionStatus (live, not persisted)

```text
idle ──connect/run──▶ connecting ──ok──▶ connected
  ▲                       │                 │
  │                       └──fail──▶ error ◀┘ (connection lost / auth fail)
  └──── disconnect / all sessions closed / app restart ◀── connected, error
```

`error` carries `{ message, code? }`. Every connection starts `idle` after restart (US5-1).

## SqlQueryCollection

| Field          | Type     | Validation / notes                                    |
| -------------- | -------- | ----------------------------------------------------- |
| `id`           | `string` | UUID                                                  |
| `connectionId` | `string` | must exist; collection is deleted with its connection |
| `name`         | `string` | 1–100 chars; unique within the connection             |
| `createdAt`    | `string` |                                                       |
| `revision`     | `number` |                                                       |

Deleting a collection: confirmation states how many queries it holds; its queries become ungrouped (`collectionId: null`) unless the user picks "delete queries too" (US3-4).

## SqlSavedQuery

| Field          | Type             | Validation / notes                                                           |
| -------------- | ---------------- | ---------------------------------------------------------------------------- |
| `id`           | `string`         | UUID                                                                         |
| `connectionId` | `string`         | must exist                                                                   |
| `collectionId` | `string \| null` | must belong to the same connection                                           |
| `name`         | `string`         | 1–200 chars; default = first 40 chars of the SQL after collapsing whitespace |
| `sql`          | `string`         | 1 char – 1 MB                                                                |
| `createdAt`    | `string`         |                                                                              |
| `updatedAt`    | `string`         |                                                                              |
| `revision`     | `number`         |                                                                              |

## SqlPersistedTab (on the unified tab, `tab.sql`)

Saved by the existing session persistence, like `tab.apiClient`.

| Field                | Type             | Notes                                                          |
| -------------------- | ---------------- | -------------------------------------------------------------- |
| `draftText`          | `string`         | ≤ 1 MB persisted; larger kept in memory with a notice          |
| `connectionId`       | `string \| null` | falls back to `null` if the connection was deleted (edge case) |
| `savedQueryId`       | `string \| null` | unlinked if the query was deleted (edge case)                  |
| `savedQueryRevision` | `number \| null` | revision the draft started from; used for the unsaved marker   |
| `splitRatio`         | `number`         | 0.15–0.85, default 0.5 (FR-004)                                |

**Unsaved marker** (FR-023): `savedQueryId != null && draftText !== savedQuery.sql`.

## SqlTabRuntimeState (renderer only, not persisted)

| Field | Type                                                                                                     |
| ----- | -------------------------------------------------------------------------------------------------------- |
| `run` | `{ state: 'idle' } \| { state: 'running', runId, startedAt } \| { state: 'done', result: SqlRunResult }` |

## SqlRunResult (in memory; also the RPC result shape)

```ts
type SqlColumn = { name: string; dataTypeId: number; dataTypeName: string }

type SqlRunResult =
  | {
      kind: 'rows'
      columns: SqlColumn[]
      rows: (string | null)[][] // PostgreSQL text form; null = SQL NULL
      rowCount: number
      rowCapApplied: boolean // FR-012
      sizeLimitReached: boolean // FR-012a
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
  | { kind: 'timed-out'; timeoutMs: number; elapsedMs: number } // agents only

type SqlRunError = {
  message: string
  code?: string // SQLSTATE
  position?: number // 1-based char offset in the whole editor run text
  detail?: string
  hint?: string
  failedStatementIndex?: number // 0-based; with explicit transaction control, statements 0..index-1 already ran (FR-015a)
  failedStatementText?: string
  nothingApplied?: boolean // FR-015a
  category: 'syntax' | 'connection' | 'auth' | 'ssl' | 'read-only' | 'not-local' | 'other'
}
```

## SchemaSnapshot (cache per connection in main, refreshed on demand)

```ts
type SqlSchema = { name: string }
type SqlRelation = {
  schema: string
  name: string
  kind: 'table' | 'view' | 'materialized-view' | 'partitioned-table' | 'foreign-table'
}
type SqlColumnInfo = {
  name: string
  dataTypeName: string
  nullable: boolean
  isPrimaryKey: boolean
  ordinal: number
}
```

Lazily loaded: schemas on expand of the connection's Schema section; relations on schema expand; columns on relation expand (FR-027). System schemas hidden: `pg_catalog`, `information_schema`, `pg_toast`, `pg_temp_*`, `pg_toast_temp_*`.

**Quoted name** (FR-028, pure function `quotePgIdentifier`): an identifier is left bare only if it matches `^[a-z_][a-z0-9_$]*$` and is not a reserved keyword; otherwise wrapped in `"…"` with `"` doubled. Qualified: `"CaseManagement"."SurgicalCase"`.

## Relationships

```text
ProjectKey 1 ── * SqlConnection 1 ── * SqlQueryCollection
                        1                   0..1
                        └──────── * SqlSavedQuery ┘
Unified tab (sql) * ── 0..1 SqlConnection, 0..1 SqlSavedQuery   (by id, soft reference)
```

Cascade: delete connection → its collections and queries (confirmation shows counts, FR-009); open tabs referencing it fall back to `null`.
