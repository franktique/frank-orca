# Contract: Publish payload

The JSON an agent writes to stdin for `orca explain publish --input-stdin`. Validated by `ExplanationPublishPayload` (zod) in `src/shared/agent-explanations/explanation-schemas.ts`. `orca explain schema --json` prints the matching JSON Schema.

## Shape

```json
{
  "version": 1,
  "agent": "claude",
  "changes": [
    {
      "title": "Retry policy for uploads",
      "summary": "Uploads now retry with exponential backoff…",
      "files": [
        {
          "path": "src/main/upload/upload-retry.ts",
          "items": [
            {
              "id": "retry-1",
              "side": "new",
              "startLine": 12,
              "endLine": 30,
              "text": "Backoff doubles from 500 ms and is capped at 8 s because…"
            },
            {
              "side": "old",
              "startLine": 4,
              "text": "The old fixed 1 s delay was removed."
            }
          ]
        }
      ]
    }
  ]
}
```

| Field                       | Rules                                                                                       |
| --------------------------- | ------------------------------------------------------------------------------------------- |
| `version`                   | Must be `1`. Other values → `unsupported_version`                                           |
| `agent`                     | Optional display name (≤ 40 chars). The `--agent` flag overrides it                         |
| `changes`                   | 1..104 entries. Order = letters                                                             |
| `changes[].title`           | 1..120 chars                                                                                |
| `changes[].summary`         | 0..4000 chars, markdown                                                                     |
| `changes[].files`           | 1..200 entries, in reading order                                                            |
| `files[].path`              | Repo-relative, `/` separators. Leading `./` and backslashes are normalized                  |
| `files[].items`             | 1..100 entries                                                                              |
| `items[].id`                | Optional agent id (≤ 64 chars), echoed back in issues                                       |
| `items[].side`              | `"new"` (default) or `"old"`                                                                |
| `items[].startLine/endLine` | 1-based, inclusive. `endLine` defaults to `startLine`. Leave both out for a file-level item |
| `items[].text`              | 1..8192 chars, markdown                                                                     |

Total payload ≤ 900 KB (921,600 bytes) of UTF-8 on stdin (`payload_too_large`) and ≤ 500 items in total (`too_many_items`). The CLI checks the stdin byte length before calling the runtime, because every RPC transport (local socket, SSH relay, paired-runtime WebSocket) drops messages over 1 MB, envelope included, with a generic error the agent can't act on. The host re-checks the re-serialized payload for other callers.

## Response (`--json`)

```json
{
  "ok": true,
  "published": true,
  "explanationId": "…",
  "replacedPrevious": true,
  "changeSetBase": {
    "kind": "branch-and-uncommitted",
    "baseRef": "origin/main",
    "mergeBase": "…",
    "headOid": "…"
  },
  "counts": {
    "changes": 2,
    "files": 7,
    "items": 18,
    "rejected": 1,
    "warnings": 1
  },
  "labels": [{ "id": "retry-1", "label": "A1.1" }],
  "rejected": [
    {
      "code": "line_out_of_range",
      "message": "endLine 300 > 212 lines on new side",
      "changeIndex": 0,
      "fileIndex": 1,
      "itemIndex": 2,
      "path": "src/x.ts"
    }
  ],
  "warnings": [
    {
      "code": "outside_changed_hunk",
      "message": "Lines 3-5 are unchanged context",
      "changeIndex": 0,
      "fileIndex": 0,
      "itemIndex": 0,
      "clientId": "retry-1"
    }
  ]
}
```

If every item is rejected, the response is `published: false` with exit code 1, and the previous explanation is kept. Publishes for one workspace are serialized, and the later write wins. Its response has `replacedPrevious: true`. The earlier caller is not notified after it returns; `orca explain show` reports the current producer.

## Issue codes

| Code                           | Kind     | When                                                                                                              |
| ------------------------------ | -------- | ----------------------------------------------------------------------------------------------------------------- |
| `invalid_payload`              | fatal    | JSON parse or schema failure (message carries the zod path)                                                       |
| `unsupported_version`          | fatal    | `version` ≠ 1                                                                                                     |
| `payload_too_large`            | fatal    | > 900 KB on stdin (checked by the CLI before sending; re-checked on the host)                                     |
| `too_many_items`               | fatal    | > 500 items                                                                                                       |
| `no_changes`                   | fatal    | Git workspace whose change set is empty (a non-git folder fails earlier with `not_git_workspace`, see cli-rpc.md) |
| `file_not_in_change_set`       | rejected | Path is not in the change set. A renamed file's old path is rejected too, with the message naming the new path to use |
| `side_unavailable`             | rejected | `old` on an added file, or `new` on a deleted file                                                                |
| `line_out_of_range`            | rejected | Lines outside 1..lineCount(side)                                                                                  |
| `line_anchor_unsupported`      | rejected | Line anchor on a binary or over-budget file (use a file-level item)                                               |
| `text_empty` / `text_too_long` | rejected | Item text bounds                                                                                                  |
| `outside_changed_hunk`         | warning  | Valid lines, but none of them changed                                                                             |
| `duplicate_file_in_change`     | warning  | Same path twice in one change, merged into the first entry                                                        |
