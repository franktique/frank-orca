# Data Model: E2E Test Orchestrator

**Feature**: [spec.md](./spec.md) | **Research**: [research.md](./research.md)

Types live in `src/shared/test-orchestrator/test-orchestrator-types.ts`, with matching zod schemas in `test-orchestrator-schemas.ts`. They build on feature 001 types (`ApiNodeId`, `Collection`, `Environment`, `EnvironmentVariable`, `ResolvedRequest`, `ExecutionOutcome`, `TestResult`) and feature 002 types (`SqlConnection`, `SqlRunResult`).

---

## TestMap (stored per collection)

The user's JSON after validation, plus the links Orca resolved. The file format is in [contracts/test-map-format.md](./contracts/test-map-format.md).

| Field             | Type                                                  | Notes                                                                                                            |
| ----------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `orcaTestMap`     | `1`                                                   | Format version                                                                                                   |
| `collectionId`    | `ApiNodeId`                                           | Owner collection                                                                                                 |
| `guidePath`       | `string?`                                             | Guide HTML path, relative to the worktree root or absolute; it is linked in the evidence and never read (FR-001) |
| `allowedHosts`    | `string[]?`                                           | Exact host or `*.domain` (FR-005f)                                                                               |
| `databaseConsole` | `{ editorSelector?, runSelector?, resultSelector? }?` | Browser-mode hints (R7)                                                                                          |
| `entries`         | `TestMapEntry[]`                                      | In file order                                                                                                    |
| `loadedAt`        | `number`                                              | Epoch ms                                                                                                         |
| `sourceFileName`  | `string?`                                             | File the map was loaded from (shown in UI)                                                                       |

### TestMapEntry

| Field             | Type                                                                                                                                                | Notes                                                                  |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `ref`             | `{ id: ApiNodeId } \| { path: string[] }`                                                                                                           | `path` is the folder path plus the request name                        |
| `link`            | `{ state: 'linked'; requestId } \| { state: 'unmatched' } \| { state: 'ambiguous'; candidates: ApiNodeId[] } \| { state: 'broken'; lastRequestId }` | Resolved by Orca; `broken` means the request was deleted after linking |
| `title`           | `string?`                                                                                                                                           | Step title in the evidence; defaults to the request name               |
| `stepId`          | `string?`                                                                                                                                           | Label such as `SC-1`; defaults to `<phase initial>-<n>`                |
| `phase`           | `'preflight' \| 'setup' \| 'scenario' \| 'cleanup'?`                                                                                                | Overrides the folder-derived phase (FR-002b)                           |
| `expect`          | `Expectation?`                                                                                                                                      | FR-002a/002c                                                           |
| `expectAll`       | `Expectation[]?`                                                                                                                                    | Only on the first entry of a concurrent group (R16)                    |
| `captures`        | `{ variable: string; from: string }[]?`                                                                                                             | `from` is a JSON path (`id`, `data.items[0].id`) or `header:<name>`    |
| `dependsOn`       | `string[]?`                                                                                                                                         | `stepId`s; flags the result, never reorders it                         |
| `concurrentGroup` | `string?`                                                                                                                                           | Steps that share a name are sent together                              |
| `forEach`         | `string?`                                                                                                                                           | Cleanup only: the variable to iterate (FR-017a)                        |
| `before`          | `VerificationQuery[]`                                                                                                                               | Default `[]`                                                           |
| `after`           | `VerificationQuery[]`                                                                                                                               | Default `[]`                                                           |

**Validation**: `forEach` is allowed only when the phase is `cleanup`. `expectAll` is allowed only with `concurrentGroup`. A `stepId` must be unique within the map. Every `dependsOn` value must name a `stepId` in the map. A variable named in `captures`/`forEach` must match `^[A-Za-z_][\w.-]*$`.

### Expectation

| Field           | Type                 | Notes                                                      |
| --------------- | -------------------- | ---------------------------------------------------------- |
| `status`        | `number \| number[]` | 100–599                                                    |
| `errorCode`     | `string?`            | Compared exactly                                           |
| `errorCodePath` | `string?`            | Dotted path; when absent, the default lookup in R5 is used |

### VerificationQuery

| Field          | Type      | Notes                                                                          |
| -------------- | --------- | ------------------------------------------------------------------------------ |
| `id`           | `string`  | Generated when missing; stable across edits                                    |
| `sql`          | `string`  | May use `{{variables}}`; must not be blank                                     |
| `description`  | `string?` |                                                                                |
| `precondition` | `boolean` | Default `false`; a failure blocks the request (FR-014)                         |
| `changesData`  | `boolean` | Default `false`; Orca also infers it (R8), and the stricter of the two applies |

## PlanSettings (stored per collection)

| Field           | Type                     | Notes                                                               |
| --------------- | ------------------------ | ------------------------------------------------------------------- |
| `collectionId`  | `ApiNodeId`              |                                                                     |
| `environmentId` | `ApiNodeId \| null`      | Last environment used                                               |
| `databaseMode`  | `DatabaseModeChoice?`    | Last choice; defaults to `manual` the first time (spec Assumptions) |
| `inputs`        | `Record<string, string>` | Non-secret remembered inputs (FR-008)                               |
| `secretInputs`  | `Record<string, string>` | Sealed with `sealSecretValue`; `UNSEALED_CIPHER` means not stored   |

### DatabaseModeChoice

`{ mode: 'automatic'; connectionId: string; projectKey: string }`, `{ mode: 'browser'; origin: string }` (the browser tab is chosen again each run; the origin is used to pre-select a matching open tab), or `{ mode: 'manual' }`.

## RunInput (an Input)

This is derived at setup time and never stored on its own.

| Field      | Type      | Notes                                                                                            |
| ---------- | --------- | ------------------------------------------------------------------------------------------------ |
| `name`     | `string`  | Environment variable name                                                                        |
| `secret`   | `boolean` | `type === 'secret'` in the environment                                                           |
| `required` | `boolean` | It is referenced by any step or query in the plan                                                |
| `value`    | `string`  | Pre-filled from PlanSettings; secret inputs are never sent to the renderer, only `hasRemembered` |

An input is an environment variable whose value is empty (FR-004). A run cannot start until every required input has a value.

## TestPlanStep (built at Start, then frozen for the run)

| Field                | Type                                           | Notes                                                                                                                |
| -------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `index`              | `number`                                       | Order across the run                                                                                                 |
| `stepId`             | `string`                                       |                                                                                                                      |
| `title`              | `string`                                       |                                                                                                                      |
| `phase`              | `Phase`                                        |                                                                                                                      |
| `requests`           | `{ requestId; snapshot: ApiRequest; scope }[]` | 1 item, or n for a concurrent group; uses the 001 `snapshotScope`                                                    |
| `entry`              | `TestMapEntry \| null`                         | `null` for a request with no test-map entry                                                                          |
| `requiredVariables`  | `string[]`                                     | Variables referenced in the request or its queries that are captured by an earlier step; used for "blocked" (FR-012) |
| `approvedDataChange` | `boolean`                                      | From the setup screen (FR-009)                                                                                       |

## RunVariableScope (in memory)

| Field         | Type                    | Notes                                                 |
| ------------- | ----------------------- | ----------------------------------------------------- |
| `environment` | `EnvironmentVariable[]` | Selected environment plus inputs plus captured values |
| `collection`  | `Variable[]`            | Copy of the collection variables plus script writes   |
| `sensitive`   | `Set<string>`           | Grows during the run (R9)                             |

## CaptureLedger (stored per collection)

| Field          | Type              | Notes                    |
| -------------- | ----------------- | ------------------------ |
| `collectionId` | `ApiNodeId`       |                          |
| `values`       | `CapturedValue[]` | Append-only during a run |

### CapturedValue

| Field        | Type                            | Notes                                                     |
| ------------ | ------------------------------- | --------------------------------------------------------- |
| `variable`   | `string`                        |                                                           |
| `value`      | `string`                        | Sealed when the name is sensitive (R9 rule); shown masked |
| `capturedAt` | `number`                        |                                                           |
| `runId`      | `string`                        |                                                           |
| `stepId`     | `string`                        |                                                           |
| `source`     | `'script' \| 'test-map'`        | FR-002d                                                   |
| `cleaned`    | `{ runId; stepId; at } \| null` | Set when a passing cleanup step ran with this value       |

**State transitions**: `uncleaned → cleaned` (a passing cleanup step ran with this value). A value can also be dropped with "Forget captured values" after the user confirms. Values stay `uncleaned` across runs until one of these happens (US7-AS2/AS3).

## TestRun (latest one stored per collection; live copy in main)

| Field                  | Type                                                                                                           | Notes                                                                                     |
| ---------------------- | -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `id`                   | `string`                                                                                                       |                                                                                           |
| `collectionId`         | `ApiNodeId`                                                                                                    |                                                                                           |
| `kind`                 | `'full' \| 'cleanup-only'`                                                                                     |                                                                                           |
| `environmentId`        | `ApiNodeId \| null`                                                                                            |                                                                                           |
| `targetHosts`          | `string[]`                                                                                                     | Resolved hosts (R13)                                                                      |
| `databaseMode`         | `{ mode: 'automatic'; connectionName } \| { mode: 'browser'; site } \| { mode: 'manual' } \| { mode: 'none' }` | `none` when the plan has no queries                                                       |
| `state`                | `RunState`                                                                                                     | See below                                                                                 |
| `ending`               | `'passed' \| 'failed' \| 'stopped-by-user' \| 'preflight-failed' \| 'error' \| null`                           |                                                                                           |
| `startedAt`, `endedAt` | `number`, `number \| null`                                                                                     |                                                                                           |
| `pausedMs`             | `number`                                                                                                       | Excluded from durations (FR-006d)                                                         |
| `currentStepIndex`     | `number \| null`                                                                                               |                                                                                           |
| `steps`                | `StepResult[]`                                                                                                 |                                                                                           |
| `pause`                | `PauseRequest \| null`                                                                                         |                                                                                           |
| `evidence`             | `{ folder: string; reportPath: string; ignoredByGit: boolean } \| null`                                        | Absolute paths (main)                                                                     |
| `cleanup`              | `{ cleaned: number; notCleaned: { variable; valueMasked; unavailable?: boolean }[]; keptByUser: boolean }`     | `unavailable`: sensitive value not stored because secure storage is unavailable (FR-017b) |

### RunState

```
setup ──Start──▶ running ──▶ cleaning-up ──▶ finished
                   │  ▲            ▲
                   ▼  │            │
                 paused            │
                   │               │
                   └──Stop──▶ stopping ──(Run cleanup | Keep data)──┘
```

- `running → paused`: a manual-queries, browser-recovery, or credentials pause.
- `paused → running`: Continue, Skip, Retry, Do manually, or a new credential.
- `running | paused → stopping`: Stop. The in-flight request is aborted. The run asks "Run cleanup" or "Keep data".
- Preflight failed → `cleaning-up` (cleanup does nothing when nothing was captured) → `finished` with ending `preflight-failed`.
- `finished` is final. The evidence is written at every transition into `finished` (FR-027).

### StepResult

| Field                        | Type                                                                   | Notes                                                                                                                                                                    |
| ---------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `stepId`, `title`, `phase`   |                                                                        |                                                                                                                                                                          |
| `iterationValue`             | `{ variable; valueMasked }?`                                           | For `forEach` cleanup repeats                                                                                                                                            |
| `result`                     | `'pass' \| 'fail' \| 'skipped' \| 'blocked' \| 'running' \| 'pending'` |                                                                                                                                                                          |
| `reason`                     | `string?`                                                              | Required unless `pass` (FR-013), e.g. `blocked by setup step S-3`, `dependency failed: SC-1`, `could not capture caseId from response`, `skipped — broken test-map link` |
| `dependencyFailed`           | `string[]`                                                             | Flags only                                                                                                                                                               |
| `expectedText`, `actualText` | `string`                                                               | For the summary table                                                                                                                                                    |
| `before`, `after`            | `QueryEvidence[]`                                                      |                                                                                                                                                                          |
| `exchanges`                  | `RequestEvidence[]`                                                    | 1, or n for a concurrent group                                                                                                                                           |
| `durationMs`                 | `number`                                                               | Without pauses                                                                                                                                                           |

### RequestEvidence

| Field             | Type               | Notes                                        |
| ----------------- | ------------------ | -------------------------------------------- |
| `requestId`       | `ApiNodeId`        | Opens details (FR-005c)                      |
| `resolvedRequest` | `ResolvedRequest`  | Masked                                       |
| `outcome`         | `ExecutionOutcome` | Masked; body capped as in the 001 run detail |
| `tests`           | `TestResult[]`     |                                              |
| `sentOffsetMs`    | `number?`          | Concurrent groups                            |
| `screenshot`      | `string \| null`   | Relative image path in the bundle            |

### QueryEvidence

| Field                | Type                                                                                              | Notes                                                                   |
| -------------------- | ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `queryId`            | `string`                                                                                          |                                                                         |
| `sqlResolved`        | `string`                                                                                          | Masked                                                                  |
| `description`        | `string?`                                                                                         |                                                                         |
| `how`                | `'automatic' \| 'browser' \| 'manual' \| 'skipped-by-user' \| 'skipped-not-approved' \| 'failed'` |                                                                         |
| `result`             | `{ columns: string[]; rows: string[][]; totalRows: number; truncated: boolean } \| null`          | At most 200 rows (FR-026)                                               |
| `pastedText`         | `string?`                                                                                         | Manual mode (US5-AS3)                                                   |
| `partial`            | `boolean`                                                                                         | Browser pagination note                                                 |
| `blurredCount`       | `number?`                                                                                         | Browser mode: sensitive occurrences blurred in the screenshot (FR-025b) |
| `screenshotWithheld` | `'residual' \| 'uninspectable'?`                                                                  | Browser mode: why no screenshot was kept (FR-025b)                      |
| `error`              | `string?`                                                                                         |                                                                         |
| `screenshot`         | `string \| null`                                                                                  |                                                                         |

## PauseRequest

| `kind`                                                        | Payload                                                                                                                                                                   | Answers                                                                                                      |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `manual-queries`                                              | `stepId`, `when: 'before' \| 'after'`, `queries: { queryId; sqlResolved; description }[]` (resolved; sensitive values masked in the display copy, raw in the copy action) | `continue` (with optional `pasted: Record<queryId, string>`), `skip: queryId[]`                              |
| `browser-recovery`                                            | `stepId`, `queryId`, `problem: 'not-found' \| 'error' \| 'sign-in' \| 'timeout' \| 'tab-closed'`, `screenshot` (data URL)                                                 | `retry`, `do-manually`, `skip`, `pick-tab: browserPageId`, `switch-rest-to-manual`, `skip-remaining-queries` |
| `credentials`                                                 | `stepId`, `inputs: { name; secret }[]`                                                                                                                                    | `resume: Record<name, string>`, `stop`                                                                       |
| `stopping` uses its own prompt: `run-cleanup` or `keep-data`. |

## EvidenceBundle

This is a folder on disk; see [contracts/evidence-bundle-format.md](./contracts/evidence-bundle-format.md). It is not stored in Orca data. The latest `TestRun.evidence` points to it.

## Relationships

```
Collection 1 ── 0..1 TestMap ── * TestMapEntry ── * VerificationQuery
Collection 1 ── 0..1 PlanSettings
Collection 1 ── 0..1 CaptureLedger ── * CapturedValue
Collection 1 ── 0..1 TestRun (latest) ── * StepResult ── * RequestEvidence / QueryEvidence
TestRun 1 ── 1 EvidenceBundle (on disk, in the worktree)
```

A test plan is the tuple (collection, the environment picked at setup, the TestMap, PlanSettings), keyed by `(worktreeId, collectionId)`. Only one TestRun may be active per key (FR-020).
