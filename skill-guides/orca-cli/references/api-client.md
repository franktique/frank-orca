# API Client commands

Read and run access to the worktree's API Client (Postman-compatible collections). Agents cannot create, edit or delete collections, environments or requests.

```text
ORCA api list [--worktree <selector>] --json
ORCA api envs [--worktree <selector>] --json
ORCA api run <id> [--env <id|name|none>] [--iterations <n>] [--delay <ms>] [--stop-on-failure] [--timeout <ms>] [--full-body] --json
ORCA api result <requestId> [--full-body] --json
ORCA api show <requestId> --json
```

- `<id>` is a request, folder or collection id from `api list`. Folders and collections run every request in order.
- Without `--env` the worktree's active environment is used; `--env none` runs without one.
- Secret values are always shown as `••••`, including in echoed responses and `api envs`.
- Response bodies print up to 64 KB; pass `--full-body` for the rest.
- Exit code is 0 only when every test passed and no request errored.
- `--timeout` stops the run and returns the results that finished.
- Only local worktrees are supported; a remote worktree returns `not-local`.
- `api show` opens the request in the API Client tab so the user can see it.
