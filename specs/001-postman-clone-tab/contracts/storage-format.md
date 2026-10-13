# Contract: On-disk storage (per worktree)

Root: `<userData>/api-client/<hashWorktreeId(worktreeId)>/` — never inside the repository (FR-027, SC-004). Writes use `writeFileDurable` (temp + rename). All files are JSON validated with zod on read; a file that fails validation is moved to `corrupt/<name>.<ts>.json` and reported, the rest loads.

```text
api-client/
├── <hash>/
│   ├── meta.json                 # { schemaVersion: 1, worktreeId, createdAt }
│   ├── state.json                # { activeEnvironmentId, collectionOrder: [], environmentOrder: [] }
│   ├── collections/<id>.json     # Collection (data-model.md), incl. postmanExtra
│   ├── environments/<id>.json    # Environment; secrets as { type:'secret', cipher:'<base64>' }
│   ├── results/<requestId>.json  # LatestResult (bodies ≤ 10 MB)
│   └── runs/<scopeId>.json       # latest Run per collection/folder
└── .pending-delete/              # tombstones awaiting async removal
```

Lifecycle:

- **Delete through Orca**: `deleteWorktreeApiClientData(worktreeId)` renames `<hash>` into `.pending-delete/<hash>.<ts>.<rand>` synchronously (metadata-only) and removes it asynchronously with retries — same pattern as `src/main/terminal-history-deletion.ts`.
- **Startup**: drain `.pending-delete/`; then GC: dirs whose `meta.worktreeId` is not in the live worktree/folder-workspace snapshot and older than 5 minutes are tombstoned (FR-029 orphans).
- **Request deleted from a collection**: its `results/<id>.json` and any `runs/<id>.json` are removed in the same operation.
- **Migrations**: `meta.schemaVersion` gates forward migrations; an unknown higher version opens read-only with a notice (downgrade safety).
