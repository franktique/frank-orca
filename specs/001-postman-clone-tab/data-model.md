# Data Model: API Client Tab

**Feature**: [spec.md](./spec.md) | **Research**: [research.md](./research.md)

Types live in `src/shared/api-client/` (shared by main, renderer, CLI). zod schemas validate every value read from disk or received over IPC/RPC. On-disk layout: [contracts/storage-format.md](./contracts/storage-format.md).

Identifiers: `ApiNodeId` is a string, stable for the node's lifetime (FR-034). Taken from Postman's `_postman_id`/`id` on import when present and unique within the worktree, otherwise a UUID generated once at import.

---

## WorktreeApiData (container)

| Field                 | Type                   | Notes                                                           |
| --------------------- | ---------------------- | --------------------------------------------------------------- |
| `worktreeId`          | string                 | Orca worktree / folder-workspace id. Local execution host only. |
| `schemaVersion`       | `1`                    | Bumped with migrations.                                         |
| `collections`         | `CollectionSummary[]`  | Order shown in the side panel.                                  |
| `environments`        | `EnvironmentSummary[]` |                                                                 |
| `activeEnvironmentId` | `ApiNodeId \| null`    | FR-010; shared by all API Client tabs of the worktree.          |
| `revision`            | number                 | Monotonic; increments on any write (R9).                        |

Lifecycle: created lazily on first write; deleted (tombstoned) when the worktree/folder workspace is removed through Orca or when GC finds the worktree gone (FR-029).

> The SSL verification switch (FR-017a) is app-wide: `GlobalSettings.apiClientSslVerification` (`src/shared/global-settings-types.ts`, default `true` in `src/shared/constants.ts`), not part of this container.

## Collection

| Field            | Type                      | Validation / Notes                                                         |
| ---------------- | ------------------------- | -------------------------------------------------------------------------- |
| `id`             | ApiNodeId                 |                                                                            |
| `name`           | string                    | 1–200 chars; duplicate names allowed only via "keep both" (suffix ` (2)`). |
| `description`    | string?                   | Markdown text.                                                             |
| `variables`      | `Variable[]`              | Collection variables (no secret type; Postman collections have none).      |
| `auth`           | `Auth?`                   | Inherited by children with `auth.type === 'inherit'` or absent.            |
| `events`         | `ScriptEvents`            | `prerequest` / `test` scripts.                                             |
| `items`          | `(Folder \| Request)[]`   | Ordered.                                                                   |
| `revision`       | number                    | Optimistic concurrency (R9).                                               |
| `postmanExtra`   | `Record<string, unknown>` | Unmodelled Postman fields kept for export (R11).                           |
| `importWarnings` | `string[]`                | Unsupported features found at import.                                      |

## Folder

| Field                       | Type                    | Notes                                       |
| --------------------------- | ----------------------- | ------------------------------------------- |
| `id`, `name`, `description` |                         |                                             |
| `kind`                      | `'folder'`              |                                             |
| `variables`                 | `Variable[]`            | Postman v2.1 allows folder-level variables. |
| `auth`                      | `Auth?`                 |                                             |
| `events`                    | `ScriptEvents`          |                                             |
| `items`                     | `(Folder \| Request)[]` | Arbitrary nesting.                          |
| `postmanExtra`              | object                  |                                             |

## Request

| Field                       | Type                                                                           | Validation / Notes                                                                                                                                                                                                          |
| --------------------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`, `name`, `description` |                                                                                |                                                                                                                                                                                                                             |
| `kind`                      | `'request'`                                                                    |                                                                                                                                                                                                                             |
| `method`                    | string                                                                         | Upper-cased; standard verbs + custom allowed.                                                                                                                                                                               |
| `url`                       | `{ raw: string; query: KeyValue[] }`                                           | `raw` is the source of truth; `query` kept in sync both ways. Path variables (`:id`) kept as `pathVariables: KeyValue[]`.                                                                                                   |
| `headers`                   | `KeyValue[]`                                                                   | `KeyValue = { key, value, enabled, description? }`.                                                                                                                                                                         |
| `body`                      | `Body?`                                                                        | `{ mode: 'none' \| 'raw' \| 'urlencoded' \| 'formdata' \| 'file' \| 'graphql', raw?, language?, urlencoded?, formdata?, ... }`. `file`/`graphql` preserved for export, sent as raw best effort; flagged in import warnings. |
| `auth`                      | `Auth?`                                                                        | `noauth`, `inherit`, `bearer`, `basic`, `apikey` supported; other types (oauth2, digest, aws…) preserved and reported unsupported at send time.                                                                             |
| `events`                    | `ScriptEvents`                                                                 |                                                                                                                                                                                                                             |
| `settings`                  | `{ sslVerification?: boolean; followRedirects?: boolean; timeoutMs?: number }` | `sslVerification` undefined → inherit the app-wide setting (FR-017a). Maps to Postman `protocolProfileBehavior.strictSSL` / `followRedirects` on import/export.                                                             |
| `postmanExtra`              | object                                                                         |                                                                                                                                                                                                                             |

## Variable / EnvironmentVariable

| Field          | Type                    | Notes                                                              |
| -------------- | ----------------------- | ------------------------------------------------------------------ |
| `key`          | string                  | Non-empty; duplicates allowed (Postman allows), last enabled wins. |
| `value`        | string \| null          | `null` for a secret that could not be decrypted (FR-009b).         |
| `enabled`      | boolean                 |                                                                    |
| `type`         | `'default' \| 'secret'` | Environments only use `secret`.                                    |
| `needsReentry` | boolean?                | Runtime-only flag set when decryption failed; never persisted.     |

Persisted secret form: `{ key, enabled, type: 'secret', cipher: base64 }` — the plain value is never written (FR-009a).

IPC draft form for an unchanged secret: `{ key, enabled, type: 'secret', unchanged: true }`. Main pairs it with the stored entry by position and key and keeps its cipher.

## Environment

| Field          | Type                    | Notes                                                      |
| -------------- | ----------------------- | ---------------------------------------------------------- |
| `id`, `name`   |                         | `name` 1–200 chars.                                        |
| `variables`    | `EnvironmentVariable[]` | Ordered; editor table scrolls (FR-008).                    |
| `revision`     | number                  |                                                            |
| `postmanExtra` | object                  | e.g. `_postman_variable_scope`, `_postman_exported_using`. |

## ScriptEvents

`{ prerequest?: Script; test?: Script }`, `Script = { exec: string[]; id?: string; postmanExtra }` — kept as Postman's line array for lossless export; editors join/split on `\n`.

## LatestResult (per request; FR-003b)

| Field                               | Type                                                                                                         | Notes                                                                                                                       |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| `requestId`                         | ApiNodeId                                                                                                    | One per request; replaced on next run.                                                                                      |
| `origin`                            | `'manual' \| 'run' \| 'agent'`                                                                               |                                                                                                                             |
| `startedAt`, `durationMs`, `ttfbMs` | number                                                                                                       |                                                                                                                             |
| `resolvedRequest`                   | `ResolvedRequest`                                                                                            | Method, final URL, headers, body preview; secret values masked (FR-009c).                                                   |
| `outcome`                           | `{ kind: 'response'; response: ResponseSnapshot } \| { kind: 'error'; code: ApiErrorCode; message: string }` | `ApiErrorCode`: `network`, `timeout`, `cancelled`, `certificate`, `dns`, `unsupported-auth`, `script-error`, `invalid-url`. |
| `tests`                             | `TestResult[]`                                                                                               | `{ name, passed, error? }`                                                                                                  |
| `scriptLogs`                        | `LogLine[]`                                                                                                  | `{ level: 'log'\|'info'\|'warn'\|'error', phase: 'prerequest'\|'test', text }`                                              |
| `environmentId`                     | ApiNodeId \| null                                                                                            | Environment used.                                                                                                           |

`ResponseSnapshot`: `{ status, statusText, headers: [string,string][], sizeBytes, contentType, body: { encoding: 'utf8' \| 'base64' \| 'omitted'; text?: string; truncated: boolean }, redirects: { url, status }[] }`. Body stored up to 10 MB (R12).

Masking (FR-009c): before a `LatestResult` or `ConsoleEntry` is saved, emitted, or returned over RPC, every text field (URL, header values, request body, response headers and body text, script logs, test messages) passes through `maskSecrets` (`src/shared/api-client/secret-masking.ts`), which replaces each secret value of the environment used, including its URL-encoded and JSON-escaped forms, with `••••`; a Basic auth header whose decoded `user:pass` contains a secret becomes `Basic ••••`. The unmasked form never leaves `request-execution.ts`.

## ConsoleEntry (in memory, ring buffer of 500 per worktree)

`{ id, worktreeId, at, origin: 'manual'|'run'|'agent', requestId?, runId?, method, url, status?, durationMs?, request: ResolvedRequest, outcome, scriptLogs, tests }`. Not persisted. Agent/CLI entries are marked `origin: 'agent'` (FR-036).

## Run (latest per scope; FR-026)

| Field                  | Type                                                                                                | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ---------------------- | --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                   | string                                                                                              |                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `scope`                | `{ collectionId; folderId?: ApiNodeId }`                                                            | `scopeId = folderId ?? collectionId`.                                                                                                                                                                                                                                                                                                                                                                                                           |
| `environmentId`        | ApiNodeId \| null                                                                                   |                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `options`              | `{ iterations: 1–1000; delayMs: 0–60000; stopOnFailure: boolean; includedRequestIds: ApiNodeId[] }` | Order = depth-first collection order (FR-021).                                                                                                                                                                                                                                                                                                                                                                                                  |
| `origin`               | `'manual' \| 'agent'`                                                                               |                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `state`                | `'running' \| 'stopped' \| 'completed' \| 'failed-to-start'`                                        |                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `stoppedEarly`         | boolean                                                                                             | `true` when "stop on first failure" ended the run; `state` is still `completed`.                                                                                                                                                                                                                                                                                                                                                                |
| `startedAt`, `endedAt` | number                                                                                              |                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `results`              | `RunRequestResult[]`                                                                                | `{ iteration, requestId, requestName, folderPath, status?, durationMs, tests: TestResult[], error?, detail: RunResultDetail \| null }`. `RunResultDetail` = `{ resolvedRequest, outcome, scriptLogs }`, masked like `LatestResult`, body previews capped at 256 KB (`truncated: true`). A run file is capped at 50 MB; past that, the oldest results keep only the summary (`detail: null`) and the UI says "details not kept for this result". |
| `totals`               | `{ requests, testsPassed, testsFailed, durationMs }`                                                | Derived; persisted for quick display.                                                                                                                                                                                                                                                                                                                                                                                                           |

### Run state transitions

```text
(new) ──start──▶ running ──all done──▶ completed
                   │  └──stopOnFailure & failure──▶ completed (stoppedEarly=true)
                   └──user/agent stop──▶ stopped
(new) ──invalid scope / env missing──▶ failed-to-start
```

A run copies the included requests at start (edits during the run don't affect it). Script variable writes go to a working copy and are committed to the stored environment/collection after each request.

## API Client tab state (renderer, per tab)

| Field                                             | Type                                                                                                                         | Notes                                                        |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `tabId`                                           | string                                                                                                                       | Orca `Tab.id`, `contentType: 'api-client'`.                  |
| `worktreeId`                                      | string                                                                                                                       |                                                              |
| `view`                                            | `{ kind: 'empty' } \| { kind: 'request'; requestId } \| { kind: 'environment'; environmentId } \| { kind: 'runner'; scope }` | One thing at a time (FR-003a).                               |
| `draft`                                           | `RequestDraft \| EnvironmentDraft \| null`                                                                                   | Unsaved edits; triggers save/discard prompt on switch/close. |
| `consoleCollapsed`, `consoleHeight`, `splitRatio` | UI layout                                                                                                                    | Persisted with the tab session.                              |

## Relationships

```text
WorktreeApiData 1──* Collection 1──* (Folder|Request)  [tree]
WorktreeApiData 1──* Environment
WorktreeApiData 0..1── activeEnvironment
Request 1──0..1 LatestResult
Collection|Folder 1──0..1 Run (latest)
WorktreeApiData 1──* ConsoleEntry (memory only)
```
