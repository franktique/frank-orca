# Contract: On-disk storage format

All SQL data lives under Orca's `userData`, never in the repository (FR-029, SC-004).

```text
<userData>/sql-client/
├── <hashWorktreeId(projectKey)>/      # sha256 → 16 hex chars
│   ├── meta.json
│   ├── connections.json
│   └── queries.json
└── .tombstones/
    └── <hash>-<timestamp>/            # renamed dir awaiting async removal
```

Writes use `writeFileDurable` (temp file + rename). Each file carries `schemaVersion: 1`; readers reject unknown higher versions without overwriting them (logs + shows "data written by a newer Orca").

## meta.json

```json
{ "schemaVersion": 1, "projectKey": "repo:3f2a…", "createdAt": "2026-10-14T10:00:00.000Z" }
```

## connections.json

```json
{
  "schemaVersion": 1,
  "connections": [
    {
      "id": "8c1e…",
      "name": "Local cases DB",
      "host": "localhost",
      "port": 5432,
      "user": "postgres",
      "database": "cases",
      "sslMode": "disable",
      "password": { "cipher": "djEw…" },
      "createdAt": "…",
      "updatedAt": "…",
      "revision": 3
    }
  ]
}
```

- `password` is `null` when empty **or** when encryption is unavailable (password kept in memory for the session only).
- No plaintext password ever appears in any file (SC-004 test greps the directory for the test password).

## queries.json

```json
{
  "schemaVersion": 1,
  "collections": [
    { "id": "c1…", "connectionId": "8c1e…", "name": "Cleanup", "createdAt": "…", "revision": 1 }
  ],
  "queries": [
    {
      "id": "q1…",
      "connectionId": "8c1e…",
      "collectionId": "c1…",
      "name": "Delete test cases",
      "sql": "DELETE FROM \"CaseManagement\".\"SurgicalCase\" WHERE …;",
      "createdAt": "…",
      "updatedAt": "…",
      "revision": 2
    }
  ]
}
```

## Lifecycle

| Event                                            | Effect                                                                                           |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| Project removed (`repos:remove`, runtime remove) | dir moved to `.tombstones/`, removed asynchronously                                              |
| `removeProjectForHost` and id gone on all hosts  | same as above                                                                                    |
| Folder workspace removed                         | its `folder-workspace:<id>` dir tombstoned                                                       |
| Worktree removed                                 | nothing here; its tabs' drafts leave with the workspace session                                  |
| App start                                        | drain `.tombstones/`; GC dirs whose `meta.projectKey` is not in the catalog and older than 5 min |
| Repo folder moved/deleted on disk                | nothing (catalog-based, not disk-based)                                                          |

## Drafts (not in this directory)

Per-tab drafts live in the workspace session as `unifiedTab.sql` (see [data-model.md](../data-model.md#sqlpersistedtab-on-the-unified-tab-tabsql)), and leave with the tab or worktree.
