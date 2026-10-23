# Contract: Storage format

**Location**: `join(app.getPath('userData'), 'agent-explanations', hashWorktreeId(workspaceId) + '.json')`. Paths come from `explanation-storage-paths.ts`, with the root passed in as a parameter for tests, following `api-client-storage-paths.ts`.

**Owner**: The Orca runtime that owns the workspace (research R1). Nothing is ever written inside the repository or its git dir.

## File

```json
{
  "schemaVersion": 1,
  "workspaceId": "repo-id::/path/to/worktree",
  "explanation": { "...": "ExplanationSet (data-model.md)" }
}
```

- Written with `writeFileDurable` (temp + rename + fsync). One writer, the in-process store, which serializes writes per workspace with a promise chain.
- Read lazily on the first `get` for a workspace, then cached. On a parse or schema failure, the file is moved to `agent-explanations/corrupt/<hash>-<ts>.json` and treated as empty, and the error is logged once.
- An unknown `schemaVersion` greater than 1 is treated as unreadable but **not** moved, because a newer Orca may still need it. The tab stays hidden.

## Lifecycle

| Event                           | Effect                                                                                                                  |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Publish (some items valid)      | File replaced. `revision` = previous + 1 (or 1)                                                                         |
| Question upsert/markSent/delete | File rewritten with the same `id` and a higher `revision`                                                               |
| Clear                           | File deleted. A `changed` event is emitted with `revision` + 1 and `explanation: null`                                  |
| Workspace removed               | File deleted from `removeWorktreeMetadataAndHistory` and `worktree-removal-ownership.ts` (`deleteWorkspaceExplanation`) |
| Startup                         | Orphaned files (no known workspace) are removed by the existing API Client GC pass, which is extended with this root    |

Size: capped by the publish limits (≤ 900 KB payload). Questions are capped at 200 per set.
