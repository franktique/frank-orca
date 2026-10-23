# Contract: Test Map File Format (`orcaTestMap: 1`)

This format is for people and agents who write a test map next to a feature's guide, collection, and environment. Orca validates it with the zod schema `TestMapFileSchema` (`src/shared/test-orchestrator/test-map-schema.ts`). A JSON Schema generated from it is published at `docs/reference/orca-test-map.schema.json` so editors can check it.

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

## Full example (reference NUC-84270 shape)

```json
{
  "orcaTestMap": 1,
  "guide": "smoke-test-NUC-84270-bulk-assessment-requests/manual-testing-nuc-84270-generator.html",
  "allowedHosts": ["localhost", "*.dev.example.com", "*.qa.example.com"],
  "databaseConsole": {
    "editorSelector": ".monaco-editor",
    "runSelector": "button[aria-label='Run']"
  },
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
      "request": { "path": ["Scenarios", "SC-1 Bulk create"] },
      "stepId": "SC-1",
      "title": "Bulk create returns 201 and stores one row per user",
      "expect": { "status": 201 },
      "captures": [{ "variable": "requestId", "from": "data.requestId" }],
      "before": [
        {
          "sql": "SELECT count(*) FROM requests WHERE case_id = '{{caseId}}'",
          "precondition": true
        }
      ],
      "after": [{ "sql": "SELECT id, status FROM requests WHERE request_id = '{{requestId}}'" }]
    },
    {
      "request": { "path": ["Scenarios", "SC-4 Duplicate"] },
      "stepId": "SC-4",
      "dependsOn": ["SC-1"],
      "expect": { "status": 422, "errorCode": "AM00109" }
    },
    {
      "request": { "path": ["Scenarios", "SC-14 Race A"] },
      "stepId": "SC-14a",
      "concurrentGroup": "race",
      "expectAll": [{ "status": 201 }, { "status": 409, "errorCode": "AM00107" }]
    },
    {
      "request": { "path": ["Scenarios", "SC-14 Race B"] },
      "stepId": "SC-14b",
      "concurrentGroup": "race"
    },
    {
      "request": { "path": ["Cleanup", "Delete request"] },
      "phase": "cleanup",
      "forEach": "requestId",
      "after": [
        {
          "sql": "DELETE FROM requests WHERE request_id = '{{requestId}}'",
          "changesData": true,
          "description": "DB fallback if the API delete failed"
        }
      ]
    }
  ]
}
```

## Fields

### Top level

| Field             | Required | Type     | Meaning                                                                                                   |
| ----------------- | -------- | -------- | --------------------------------------------------------------------------------------------------------- |
| `orcaTestMap`     | yes      | `1`      | Format version. Orca rejects any other value and names the version it supports.                           |
| `entries`         | yes      | array    | One entry per referenced request. File order is irrelevant: steps run in collection order (FR-002b).      |
| `guide`           | no       | string   | Path to the guide HTML, relative to the worktree root. It is linked in the evidence; Orca never reads it. |
| `allowedHosts`    | no       | string[] | When present, a run against any other host is refused. `*.example.com` matches subdomains only.           |
| `databaseConsole` | no       | object   | Browser-mode hints: `editorSelector`, `runSelector`, `resultSelector` (CSS selectors).                    |

### Entry

| Field              | Required | Type                                              | Meaning                                                                                                                      |
| ------------------ | -------- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `request`          | yes      | `{ "path": string[] }` or `{ "id": string }`      | `path` is the folder names followed by the request name, as shown in the API Client. `id` is the stable id from feature 001. |
| `before` / `after` | no       | Query[]                                           | Queries run before or after the request, in order.                                                                           |
| `stepId`           | no       | string                                            | Label in the evidence (`SC-1`). Unique within the map.                                                                       |
| `title`            | no       | string                                            | Step title. Defaults to the request name.                                                                                    |
| `phase`            | no       | `preflight` \| `setup` \| `scenario` \| `cleanup` | Overrides the phase taken from the folder.                                                                                   |
| `expect`           | no       | `{ status, errorCode?, errorCodePath? }`          | Used when the collection's test scripts do not check the result, or in addition to them.                                     |
| `captures`         | no       | `{ variable, from }[]`                            | `from`: a JSON path in the response body (`id`, `data.items[0].id`) or `header:Location`.                                    |
| `dependsOn`        | no       | string[]                                          | `stepId`s. If one of them failed, this step still runs and is flagged "dependency failed".                                   |
| `concurrentGroup`  | no       | string                                            | Entries with the same name are sent together.                                                                                |
| `expectAll`        | no       | Expect[]                                          | The combined expectation for a concurrent group. It goes on one entry of the group.                                          |
| `forEach`          | no       | string                                            | Cleanup only: run once per recorded value of this variable.                                                                  |

### Query

| Field          | Required | Type    | Meaning                                                                                                                                   |
| -------------- | -------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `sql`          | yes      | string  | PostgreSQL text. `{{name}}` is replaced as text with inputs and captured values, so the author adds the quotes (`'{{caseId}}'`).          |
| `description`  | no       | string  | Shown in the UI and the evidence.                                                                                                         |
| `precondition` | no       | boolean | If the query fails, the request is not sent and the step is marked `blocked`.                                                             |
| `changesData`  | no       | boolean | Declares an insert, update, delete, or DDL. Orca also detects these; such queries run on non-local databases only with per-step approval. |

## Load-time behavior

| Situation                          | Result                                                                                                                            |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Not JSON, or the schema fails      | The file is rejected. The message lists each problem as `entries[3].expect.status: expected number`. Current links do not change. |
| Unknown top-level or entry field   | Accepted, and the field is listed as a warning (it may be a typo). It is not kept on export.                                      |
| Reference not found                | The rest of the map loads. The warning lists `path` or `id`.                                                                      |
| A `path` that matches two requests | Not linked. It appears in the warning as ambiguous, with both matches.                                                            |
| The collection already has a map   | The user is asked to replace it. On confirm, the old map is fully replaced.                                                       |

## Export

Export writes the same format with the current queries (including edits made in the UI). Each request is referenced by `path`, so the file works on another machine where node ids differ. Loading the exported file gives the same links (US2-AS5).
