# Contract: Renderer ⇄ Main IPC (`window.api.sqlClient`)

Preload: `src/preload/api/sql-client-api.ts` + bridge. Main: `src/main/ipc/sql-client/sql-client-ipc.ts`. Payloads validated with zod in main (`src/shared/sql-client/sql-client-ipc-schemas.ts`).

Every request carries `worktreeId`; main checks it is local (`assertLocalWorkspace`) and derives the `projectKey`. Every response is `{ ok: true, … } | SqlClientFailure`:

```ts
type SqlClientFailure = {
  ok: false
  code: 'not-local' | 'not-found' | 'conflict' | 'invalid' | 'storage' | 'encryption-unavailable'
  message: string
}
```

Passwords travel **only** renderer → main (create/update). No response or event ever contains a password or cipher.

## Data (invoke)

| Channel                      | Request                                                                          | Response (`ok: true`)                                                                                                |
| ---------------------------- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `sqlClient:getSnapshot`      | `{ worktreeId }`                                                                 | `{ projectKey, connections: SqlConnectionView[], collections, queries, encryptionAvailable, protectionGapMessage? }` |
| `sqlClient:createConnection` | `{ worktreeId, input: { name, host, port, user, database, sslMode, password } }` | `{ connection: SqlConnectionView }`                                                                                  |
| `sqlClient:updateConnection` | `{ worktreeId, id, baseRevision, input: Partial<…> & { password?: string } }`    | `{ connection }` — `password` omitted keeps stored one                                                               |
| `sqlClient:deleteConnection` | `{ worktreeId, id }`                                                             | `{ deletedQueries: number, deletedCollections: number }`                                                             |
| `sqlClient:testConnection`   | `{ worktreeId, input }` (unsaved form values) or `{ worktreeId, id }`            | `{ serverVersion }` or failure with `SqlRunError` text                                                               |
| `sqlClient:saveQuery`        | `{ worktreeId, id?, baseRevision?, connectionId, collectionId, name, sql }`      | `{ query }` — `id` absent → create (Save As)                                                                         |
| `sqlClient:renameQuery`      | `{ worktreeId, id, baseRevision, name }`                                         | `{ query }`                                                                                                          |
| `sqlClient:moveQuery`        | `{ worktreeId, id, baseRevision, collectionId: string \| null }`                 | `{ query }`                                                                                                          |
| `sqlClient:deleteQuery`      | `{ worktreeId, id }`                                                             | `{}`                                                                                                                 |
| `sqlClient:createCollection` | `{ worktreeId, connectionId, name }`                                             | `{ collection }`                                                                                                     |
| `sqlClient:renameCollection` | `{ worktreeId, id, baseRevision, name }`                                         | `{ collection }`                                                                                                     |
| `sqlClient:deleteCollection` | `{ worktreeId, id, deleteQueries: boolean }`                                     | `{ affectedQueries: number }`                                                                                        |

## Connections and schema (invoke)

| Channel                   | Request                                           | Response                                       |
| ------------------------- | ------------------------------------------------- | ---------------------------------------------- |
| `sqlClient:connect`       | `{ worktreeId, connectionId }`                    | `{ status }` (also emitted as event)           |
| `sqlClient:disconnect`    | `{ worktreeId, connectionId }`                    | `{}` — closes every session of that connection |
| `sqlClient:listSchemas`   | `{ worktreeId, connectionId, refresh?: boolean }` | `{ schemas: SqlSchema[] }`                     |
| `sqlClient:listRelations` | `{ worktreeId, connectionId, schema }`            | `{ relations: SqlRelation[] }`                 |
| `sqlClient:listColumns`   | `{ worktreeId, connectionId, schema, relation }`  | `{ columns: SqlColumnInfo[] }`                 |

## Running (invoke)

| Channel                     | Request                                           | Response                                                                        |
| --------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------- |
| `sqlClient:run`             | `{ worktreeId, tabId, connectionId, runId, sql }` | `{ result: SqlRunResult }` — resolves when the run ends (including `cancelled`) |
| `sqlClient:cancel`          | `{ worktreeId, tabId, runId }`                    | `{}` — no-op if `runId` already finished                                        |
| `sqlClient:closeTabSession` | `{ worktreeId, tabId }`                           | `{}` — called on tab close / connection switch                                  |

- `sql` is the selected text or whole editor text (selection logic is renderer-side). The 1000-row cap, splitting, and batch transaction are applied in main (R7).
- One active run per `tabId`; a second `run` while one is active fails with `invalid` ("a query is already running in this tab").
- UI runs have no timeout (FR-032b).

## Events (main → renderer)

| Channel                      | Payload                                                                                                    |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `sqlClient:changed`          | `{ projectKey, kind: 'connection' \| 'query' \| 'collection', id, revision \| null /* null = deleted */ }` |
| `sqlClient:connectionStatus` | `{ projectKey, connectionId, status: SqlConnectionStatus, error?: { message, code? } }`                    |

The renderer refetches the snapshot (debounced) on `changed`, so two SQL tabs in different worktrees of the same project stay in sync (US5-5).

## Renderer → renderer (content-creation bridge)

`sqlClient:show` `{ worktreeId, connectionId?, savedQueryId? }` — ensures a SQL tab in that worktree and loads the query (used by a future smoke-test workflow; no CLI command in v1).
