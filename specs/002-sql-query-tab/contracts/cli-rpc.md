# Contract: Agent / CLI access (`orca sql …`)

Runtime RPC methods in `src/main/runtime/rpc/methods/sql-client.ts` (params: `src/shared/rpc-contract/sql-client-params.ts`). CLI specs/handlers in `src/cli/specs/sql-client.ts`, `src/cli/handlers/sql-client.ts`. Read and run only — **no** create/edit/delete commands exist (FR-033).

The project is resolved from the caller's worktree, the same way `orca api` resolves it (cwd inside a worktree, or `--worktree <selector>`). Non-local worktrees → error `not-local`. Output is human-readable by default and JSON with `--json`.

## `orca sql connections` → `sql.connections`

Params: `{ worktree?: string }`

```json
{
  "projectKey": "repo:3f2a…",
  "connections": [
    {
      "id": "8c1e…",
      "name": "Local cases DB",
      "host": "localhost",
      "port": 5432,
      "database": "cases",
      "user": "postgres",
      "sslMode": "disable",
      "agentAccess": "full",
      "passwordState": "set"
    }
  ]
}
```

Never contains a password or cipher (US6-1, US6-6).

## `orca sql queries [--connection <id|name>]` → `sql.queries`

Params: `{ worktree?: string, connection?: string }`

```json
{
  "collections": [{ "id": "c1…", "connectionId": "8c1e…", "name": "Cleanup" }],
  "queries": [
    {
      "id": "q1…",
      "connectionId": "8c1e…",
      "collectionId": "c1…",
      "name": "Delete test cases",
      "sql": "…",
      "updatedAt": "…"
    }
  ]
}
```

`--connection` accepts an id or an exact (case-insensitive) name; ambiguous names → error listing the matching ids.

## `orca sql run --connection <id|name> (--sql <text> | --file <path> | --query <savedQueryId|name> | stdin) [--timeout <seconds>]` → `sql.run`

Params: `{ worktree?: string, connection: string, sql?: string, savedQuery?: string, timeoutSeconds?: number }` — exactly one of `sql` / `savedQuery` (the CLI reads `--file`/stdin into `sql`).

- `timeoutSeconds`: default 30, range 1–600 (FR-032b).
- Same execution path as the UI (row cap, 50 MB limit, all-or-nothing batch), plus agent rules (R9): read-only session + the executor's `BEGIN READ ONLY … ROLLBACK` when `agentAccess = read-only`; any statement when `full`.
- Fresh client per call; closed afterwards.

Result (`--json`) is `SqlRunResult` from [data-model.md](../data-model.md#sqlrunresult-in-memory-also-the-rpc-result-shape) plus:

```json
{ "connectionId": "8c1e…", "agentAccess": "read-only", "result": { "kind": "rows", "columns": [ … ], "rows": [ … ],
  "rowCount": 42, "rowCapApplied": false, "sizeLimitReached": false, "statementCount": 1, "elapsedMs": 18 } }
```

Error kinds an agent can rely on:

| `result.kind` / `error.category`    | Meaning                                                                                 | Exit code |
| ----------------------------------- | --------------------------------------------------------------------------------------- | --------- |
| `rows` / `command`                  | success                                                                                 | 0         |
| `error` + `read-only`               | "Agents only have read access to non-local connections." Nothing changed                | 3         |
| `timed-out`                         | "Query timed out after N s; the database cancelled it and nothing it changed was kept." | 4         |
| `error` (other categories)          | database or connection error with SQLSTATE, position, detail, hint, failed statement    | 2         |
| RPC error `not-local` / `not-found` | worktree not local, or connection/query not found                                       | 1         |

Human-readable output prints an aligned table (first 100 rows; `--json` for all), then a footer: `42 rows · 18 ms`, plus `row cap 1000 applied` / `size limit 50 MB reached` when set (FR-012a: "their output MUST flag it").

## Skill guide

The bundled Orca CLI guide gains an `orca sql` section (list → pick connection → run; access levels; timeout flag). `pnpm verify:bundled-skill-guides` must pass.

## Wire compatibility

New methods only. An older runtime answers `method not found`; the CLI maps it to "this Orca version does not support `orca sql`; update Orca".
