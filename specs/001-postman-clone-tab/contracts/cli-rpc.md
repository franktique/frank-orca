# Contract: Orca CLI and Runtime RPC (agent access)

RPC methods: `src/main/runtime/rpc/methods/api-client.ts` (registered in `methods/index.ts`); params: `src/shared/rpc-contract/api-client-params.ts`; CLI specs: `src/cli/specs/api-client.ts`; handlers/formatting: `src/cli/handlers/api-client.ts`. Read and run only (FR-035). Secret values are never returned (FR-032/033) — they appear as `"••••"`.

`--worktree` follows the existing CLI convention (defaults to the worktree of the calling terminal). `--json` prints the raw RPC result; otherwise a human-readable table.

Wire compatibility: these are new methods with new optional fields only. A client calling them on an older host gets the standard unknown-method error; the CLI maps it to "This Orca version does not support the API Client". See `docs/reference/remote-wire-compatibility.md`. The methods are not added to the mobile RPC allowlist.

## `apiClient.list` — `orca api list [--worktree <id>] [--json]`

Params: `{ worktree?: string }`

Result:

```json
{
  "worktreeId": "…",
  "activeEnvironmentId": "env-1",
  "collections": [
    {
      "id": "col-1",
      "name": "Smoke",
      "items": [
        {
          "id": "f-1",
          "kind": "folder",
          "name": "MAIN",
          "items": [{ "id": "r-1", "kind": "request", "name": "G1 - create", "method": "POST" }]
        }
      ]
    }
  ]
}
```

## `apiClient.environments` — `orca api envs [--worktree <id>] [--json]`

Result: `{ environments: [{ id, name, active, variables: [{ key, enabled, type, value }] }] }` with `value: "••••"` for secrets.

## `apiClient.run` — `orca api run <id> [--env <id|name|none>] [--iterations n] [--delay ms] [--stop-on-failure] [--timeout ms] [--worktree <id>] [--json]`

`<id>` may be a request, folder, or collection id (FR-033). Default environment = the worktree's active one. Blocks until finished (or `--timeout`, default 10 min, after which the run is stopped and partial results returned).

Params: `{ worktree?, targetId, environment?: string | null, iterations?, delayMs?, stopOnFailure?, timeoutMs? }`

Result:

```json
{
  "runId": "…",
  "state": "completed",
  "totals": { "requests": 37, "testsPassed": 70, "testsFailed": 2, "durationMs": 8123 },
  "results": [
    {
      "requestId": "r-1",
      "name": "G1 - create",
      "folderPath": ["MAIN", "G1"],
      "iteration": 1,
      "request": {
        "method": "POST",
        "url": "https://api.local/tenants/t1/items",
        "headers": [["Authorization", "••••"]],
        "body": "{…}"
      },
      "response": {
        "status": 201,
        "statusText": "Created",
        "durationMs": 120,
        "sizeBytes": 512,
        "headers": [["content-type", "application/json"]],
        "body": "{…}",
        "bodyTruncated": false
      },
      "error": null,
      "tests": [{ "name": "status is 201", "passed": true }]
    }
  ]
}
```

Side effects: results update each request's LatestResult with `origin: 'agent'` and appear in the console marked agent-initiated (FR-036); script variable writes persist as for UI runs (FR-035). Exit code: `0` when all tests passed and no request errored, `1` otherwise (useful for smoke-test skills).

CLI body output is truncated to 64 KB per response unless `--full-body`.

## `apiClient.result` — `orca api result <requestId> [--json]`

Returns the stored `LatestResult` for a request (secrets masked) — lets an external caller read results outside the UI (Product Context).

## `apiClient.show` — `orca api show <requestId> [--worktree <id>]`

Opens or activates the worktree's API Client tab, selects the request in the tree, and shows its latest result (FR-037). Returns `{ tabId }` once the renderer acknowledges. Never switches the visible worktree: for a worktree that is not shown, the tab is created or updated in that worktree's tab set. Does not capture images.
