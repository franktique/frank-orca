# Orca test map (`orcaTestMap: 1`)

A test map is a JSON file you write next to a feature's guide, collection, and environment. It tells the E2E test orchestrator which API Client requests to run, which SQL queries to run before and after each one, and what to expect. Orca validates it with `TestMapFileSchema` (`src/shared/test-orchestrator/test-map-schema.ts`). A JSON Schema generated from it is at [`orca-test-map.schema.json`](./orca-test-map.schema.json); point your editor at it for completion and checking. Regenerate it with `pnpm run generate:test-map-json-schema`; CI fails if it is stale.

## Minimal example

```json
{
  "orcaTestMap": 1,
  "entries": [
    {
      "request": { "path": ["Scenarios", "SC-1 Bulk create"] },
      "before": [{ "sql": "SELECT count(*) FROM requests WHERE case_id = '{{caseId}}'" }],
      "after": [
        {
          "sql": "SELECT id, status FROM requests WHERE case_id = '{{caseId}}'",
          "description": "3 rows, status PENDING"
        }
      ]
    }
  ]
}
```

## Fuller example

```json
{
  "orcaTestMap": 1,
  "guide": "smoke-test/manual-testing.html",
  "allowedHosts": ["localhost", "*.dev.example.com"],
  "entries": [
    {
      "request": { "path": ["Preflight", "Health"] },
      "stepId": "P-1",
      "expect": { "status": 200 }
    },
    {
      "request": { "path": ["Setup", "Create case"] },
      "stepId": "S-1",
      "captures": [{ "variable": "caseId", "from": "id" }]
    },
    {
      "request": { "path": ["Scenarios", "SC-4 Duplicate"] },
      "stepId": "SC-4",
      "dependsOn": ["S-1"],
      "expect": { "status": 422, "errorCode": "AM00109" }
    },
    {
      "request": { "path": ["Scenarios", "SC-14 Race A"] },
      "concurrentGroup": "race",
      "expectAll": [{ "status": 201 }, { "status": 409 }]
    },
    { "request": { "path": ["Scenarios", "SC-14 Race B"] }, "concurrentGroup": "race" },
    {
      "request": { "path": ["Cleanup", "Delete request"] },
      "phase": "cleanup",
      "forEach": "requestId",
      "after": [
        {
          "sql": "DELETE FROM requests WHERE request_id = '{{requestId}}'",
          "changesData": true
        }
      ]
    }
  ]
}
```

## Fields

### Top level

| Field             | Required | Meaning                                                                                       |
| ----------------- | -------- | --------------------------------------------------------------------------------------------- |
| `orcaTestMap`     | yes      | Format version. Must be `1`.                                                                  |
| `entries`         | yes      | One entry per request. File order does not matter; steps run in collection order.             |
| `guide`           | no       | Path to the guide HTML, relative to the workspace root. Linked in the evidence, never read.   |
| `allowedHosts`    | no       | If present, runs against any other host are refused. `*.example.com` matches subdomains only. |
| `databaseConsole` | no       | Browser-mode hints: `editorSelector`, `runSelector`, `resultSelector` (CSS selectors).        |

### Entry

| Field              | Meaning                                                                                              |
| ------------------ | ---------------------------------------------------------------------------------------------------- |
| `request`          | Required. `{ "path": [folder..., name] }` as shown in the API Client, or `{ "id": "..." }`.          |
| `before` / `after` | Queries run before or after the request, in order.                                                   |
| `stepId`           | Label in the evidence (`SC-1`). Unique within the map.                                               |
| `title`            | Step title. Defaults to the request name.                                                            |
| `phase`            | `preflight`, `setup`, `scenario`, or `cleanup`. Overrides the phase taken from the folder.           |
| `expect`           | `{ status, errorCode?, errorCodePath? }`. `status` is a number or array within 100-599.              |
| `captures`         | `{ variable, from }[]`. `from` is a JSON path in the body (`data.items[0].id`) or `header:Location`. |
| `dependsOn`        | `stepId`s. If one failed, this step still runs and is flagged "dependency failed". Must exist.       |
| `concurrentGroup`  | Entries sharing a name are sent together.                                                            |
| `expectAll`        | Combined expectation for a group. Only valid with `concurrentGroup`.                                 |
| `forEach`          | Run once per recorded value of this variable. Only valid when `phase` is `cleanup`.                  |

### Query

| Field          | Meaning                                                                                                                     |
| -------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `sql`          | Required, not blank. PostgreSQL text. `{{name}}` is substituted as plain text, so add the quotes yourself (`'{{caseId}}'`). |
| `description`  | Shown in the UI and the evidence.                                                                                           |
| `precondition` | If the query fails, the request is not sent and the step is `blocked`.                                                      |
| `changesData`  | Declares an insert, update, delete, or DDL. Orca also detects these; on non-local databases they need per-step approval.    |

## Load-time behavior

| Situation                          | Result                                                                                            |
| ---------------------------------- | ------------------------------------------------------------------------------------------------- |
| Not JSON, or the schema fails      | Rejected. Each problem is listed as `entries[3].expect.status: ...`. Current links do not change. |
| Unknown top-level or entry field   | Accepted and listed as a warning (it may be a typo). It is not kept on export.                    |
| Reference not found                | The rest of the map loads. The warning lists the `path` or `id`.                                  |
| A `path` that matches two requests | Not linked. Reported as ambiguous with both matches.                                              |
| The collection already has a map   | You are asked whether to replace it. On confirm, the old map is fully replaced.                   |

Export writes the same format with the current queries, referencing requests by `path` so the file works on another machine.

## Evidence location

Each run writes to `evidencias/<plan-slug>/<YYYY-MM-DD_HH-mm-ss>/` under the worktree or folder-workspace root:

- `report.md`: header (target, duration, database mode, outcome), summary table, cleanup result, then every step in execution order (Before, Request, Response, After, verdict).
- `images/`: screenshots named `NN-<step-slug>-<request|before-K|after-K>[-<n>].png`.

All links are relative, so the folder can be moved or committed as is. Orca never stages or commits it. Sensitive values are masked as `••••`; bodies are truncated at 100 KB and query results at 200 rows, with a note. If `evidencias/` is ignored by source control, the report says so.
