# Data Model: Agent Change Explanations

Phase 1 output. Types go in `src/shared/agent-explanations/explanation-types.ts`, and their zod schemas in `explanation-schemas.ts`. The persisted layout is in [contracts/storage-format.md](./contracts/storage-format.md), and the agent-facing payload in [contracts/publish-payload.md](./contracts/publish-payload.md).

## ExplanationSet (one per workspace, at most)

| Field             | Type                                                                                                                            | Notes                                                                                                   |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `id`              | string (uuid)                                                                                                                   | New on every publish. Questions and the UI's active item key off it                                     |
| `workspaceId`     | string                                                                                                                          | Worktree id or folder-workspace key                                                                     |
| `revision`        | number                                                                                                                          | Increases on every write (publish, question op). Drives push refetch (research R9)                      |
| `producer`        | `{ agentName: string; paneKey?: string; terminalHandle?: string }`                                                              | From `--agent`/payload + `ORCA_TERMINAL_HANDLE` (R7). `paneKey` lets the send menu preselect this agent |
| `generatedAt`     | number (epoch ms)                                                                                                               | Publish time on the host                                                                                |
| `changeSetBase`   | `{ kind: 'branch-and-uncommitted' \| 'uncommitted-only'; baseRef: string \| null; mergeBase: string; headOid: string \| null }` | `mergeBase` is the left side of every file diff (`HEAD` oid when uncommitted-only; the empty-tree oid when the repo has no commits yet)                     |
| `changes`         | `Change[]` (1..104)                                                                                                             | In the agent's order. Letters come from the index                                                       |
| `questions`       | `FollowUpQuestion[]`                                                                                                            | Replaced along with the set                                                                             |
| `publishWarnings` | `PublishIssue[]`                                                                                                                | Kept so the header can show "2 anchors were adjusted"                                                   |

**Rules**: Publishing writes a new set that replaces the old one (FR-022). Clearing deletes the file (FR-023). Deleting the workspace deletes the file (FR-021).

## Change

| Field     | Type                | Notes                                                |
| --------- | ------------------- | ---------------------------------------------------- |
| `index`   | number              | 0-based. `letter = toChangeLetter(index)` (A…Z, AA…) |
| `title`   | string (1..120)     |                                                      |
| `summary` | string (0..4000)    | Markdown                                             |
| `files`   | `FileEntry[]` (1..) | Reading order. Duplicates of one path are merged     |

## FileEntry

| Field      | Type                                                          | Notes                                                       |
| ---------- | ------------------------------------------------------------- | ----------------------------------------------------------- |
| `path`     | string                                                        | Repo-relative POSIX, normalized. Must be in the change set  |
| `oldPath`  | string?                                                       | Set for renames (from the change set, not the agent)        |
| `status`   | `'added' \| 'modified' \| 'deleted' \| 'renamed' \| 'copied'` | From the change set                                         |
| `position` | number                                                        | 1-based within the change. Gives label `<letter><position>` |
| `items`    | `ExplanationItem[]` (1..)                                     | Agent order                                                 |

## ExplanationItem

| Field      | Type                                | Notes                                                         |
| ---------- | ----------------------------------- | ------------------------------------------------------------- |
| `id`       | string (uuid)                       | Assigned by Orca                                              |
| `clientId` | string?                             | Agent's own id, echoed back in rejections and warnings        |
| `position` | number                              | 1-based within the file entry. Label `<fileLabel>.<position>` |
| `anchor`   | `LineAnchor \| { fileLevel: true }` | File-level only for binary or over-budget files               |
| `text`     | string (1..8192)                    | Markdown (paragraphs, lists, inline/block code)               |

### LineAnchor

| Field         | Type                                                                            | Notes                                                         |
| ------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `side`        | `'new' \| 'old'`                                                                | `new` = working tree, `old` = merge-base blob (removed lines) |
| `startLine`   | number ≥ 1                                                                      |                                                               |
| `endLine`     | number ≥ startLine                                                              | Equal to `startLine` for a single line                        |
| `fingerprint` | `{ lines: string[]; before: string[]; after: string[]; diffIdentity?: string }` | Captured at publish (research R5). `diffIdentity` = `hashSideContent(text)` of the anchored side's full text: a pure, synchronous FNV-1a hash of the text with line endings normalized to `\n`, plus its line count (e.g. `fnv1a:<hex>:<lines>`), shared by main and renderer with no crypto dependency. Only a fast path: a mismatch falls through to the line checks |

### Derived (renderer only, not stored)

`ResolvedAnchor = { state: 'fresh' | 'outdated' | 'detached'; line?: number; endLine?: number }`. It is computed by `relocateAnchor(anchor, currentSideContent)`.

**State transitions** (per render): `fresh` → `outdated` (content moved or changed but still found) → `detached` (no match). These are recomputed whenever the file's diff identity changes. They are never persisted.

## FollowUpQuestion

| Field       | Type                                   | Notes                                                                 |
| ----------- | -------------------------------------- | --------------------------------------------------------------------- |
| `id`        | string (uuid)                          |                                                                       |
| `itemId`    | string                                 | Must reference an item in the same set, or it is rejected             |
| `body`      | string (1..8192)                       |                                                                       |
| `createdAt` | number                                 |                                                                       |
| `updatedAt` | number?                                |                                                                       |
| `state`     | `'draft' \| 'sent'`                    | `draft` is saved on blur so an unsent question is never lost (FR-019) |
| `sentAt`    | number?                                | Set together with `state: 'sent'`                                     |
| `sentTo`    | `{ paneKey?: string; label: string }?` | Shown as "Sent to Claude · 2m ago" (FR-018)                           |

**Transitions**: `draft` → `sent` (markSent). Editing a `sent` question creates a new draft and leaves the sent record in place, so the history of what was asked stays visible. Delete is allowed in either state.

## Labels and global order (derived)

- `changeLetter(i)`: bijective base-26 (`0→A`, `25→Z`, `26→AA`).
- `fileLabel = changeLetter + position`, and `itemLabel = fileLabel + '.' + position`.
- `globalOrder`: a flat list of `{ itemId, label, path, changeIndex }` in change → file → item order. "4 of 11" = index + 1 of length (FR-014).
- Sidebar row for a path: every `fileLabel` the path has across changes, sorted by global order (FR-008).

## Change-set file row (renderer, derived)

`{ path, oldPath?, status, labels: string[], explained: boolean }`. It combines the live change set (R2) with the set's file entries. Explained rows come first, sorted by their first label. The rest go into the "Unexplained" group, sorted by path (FR-007). Files in the explanation that are no longer in the live change set stay listed with their labels and a "no longer changed" hint.

## Review note (existing, unchanged)

`DiffComment` from `src/shared/diff-comment-types.ts`. Notes created from the explanation diff use `scope: 'unstaged' | 'staged' | 'branch'` (research R13) and the same `WorktreeMeta.diffComments` collection.

## PublishIssue

`{ code: PublishIssueCode; message: string; changeIndex?: number; fileIndex?: number; itemIndex?: number; clientId?: string; path?: string }`. The codes are listed in [contracts/publish-payload.md](./contracts/publish-payload.md#issue-codes).
