# SQL commands

Read and run access to the project's PostgreSQL connections and saved queries. Agents cannot create, edit or delete connections, saved queries or collections, and never see a password.

```text
ORCA sql connections [--worktree <selector>] --json
ORCA sql queries [--connection <id|name>] [--worktree <selector>] --json
ORCA sql run --connection <id|name> (--sql <text> | --file <path> | --query <savedQueryId|name> | < stdin) [--timeout <seconds>] --json
```

- List first: `sql connections` gives each connection's id, name, target and `agentAccess`. Pick one by id or exact name (case-insensitive); an ambiguous name returns the matching ids.
- `agentAccess: full` is a connection to this computer (`localhost`, `127.0.0.0/8`, `::1`, or a socket directory): any statement runs, including writes, and an explicit `BEGIN`/`COMMIT` is honored.
- `agentAccess: read-only` is any other host. The session is read-only and the run is rolled back, so writes fail with exit code 3 and nothing changes. Transaction control and `SET`/`RESET` of read-only settings are rejected before they are sent. For a shared database, give Orca a read-only database role as well.
- Several statements in one run are all-or-nothing. A statement that fails rolls back the whole run and the error names the failing statement.
- A lone `SELECT` or `WITH` without `LIMIT` is capped at 1000 rows, and a result stops at 50 MB; the output says `row cap 1000 applied` or `size limit 50 MB reached`. Add your own `LIMIT` to change the cap.
- `--timeout` is the limit for the whole run, in seconds: default 30, up to 600. A run that hits it exits 4, the database cancels it, and nothing it changed is kept (a local run keeps what it committed itself).
- Exit codes: 0 success, 1 the command could not run (`not-local`, `not-found`), 2 database or connection error, 3 read-only refusal, 4 timed out.
- Human output prints the first 100 rows as a table; pass `--json` for every row.
- Only local worktrees are supported; a remote worktree returns `not-local`.
