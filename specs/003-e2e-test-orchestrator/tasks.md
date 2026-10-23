---
description: 'Task list for the E2E Test Orchestrator feature'
---

# Tasks: E2E Test Orchestrator (automated smoke tests with evidence)

**Input**: Design documents from `specs/003-e2e-test-orchestrator/`

**Prerequisites**: plan.md, spec.md, research.md (R1–R19), data-model.md, contracts/ (test-map-format, evidence-bundle-format, ipc-renderer-main, storage-format), quickstart.md

**Tests**: Included. plan.md (Technical Context) and research.md R19 define the test strategy explicitly: Vitest unit tests, orchestrator tests against feature 001's `local-echo-server`, a PostgreSQL integration test gated on `ORCA_TEST_PG_URL`, and Playwright Electron e2e with `ORCA_BACKGROUND_LAUNCH=1`. Tests sit next to their sources (`*.test.ts`); e2e lives under `tests/e2e/test-orchestrator/`.

**Organization**: Tasks are grouped by user story. Both P1 stories that need UI follow plan.md's phasing: US2 (load test map) comes before US1 (run) because a run reads the stored test map, but US1 can also run a collection with no map. P2 stories follow plan.md's order (control & cleanup → Manual → Browser) because Browser mode is the least predictable.

**Rules that apply to every task** (AGENTS.md): UI follows `docs/STYLEGUIDE.md` (tokens from `src/renderer/src/assets/main.css`, primitives from `src/renderer/src/components/ui/`, no raw palette colors, no computed `className` strings); no `max-lines` disables (split files instead); no vague file names; no type assertions except `as const` (use zod parsing); one-line "why" comments only; `path.join` for paths; every new IPC handler goes through the existing `assertLocal` from `src/main/workspace-local-host-guard.ts`; every user-visible string goes through i18next with keys in `src/renderer/src/i18n/locales/en.json`.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: User story the task belongs to (US1…US8)

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Fixtures and folders every later phase uses.

- [x] T001 Create the folders `src/shared/test-orchestrator/`, `src/shared/test-orchestrator/__fixtures__/`, `src/main/test-orchestrator/database-modes/`, `src/main/test-orchestrator/test-support/`, `src/main/ipc/test-orchestrator/`, `src/renderer/src/evidence-snapshot/`, `src/renderer/src/components/api-client/test-run/`, `src/renderer/src/components/api-client/verification-queries/`, and `tests/e2e/test-orchestrator/fixtures/` (per plan.md Project Structure)
- [x] T002 [P] Create the fixture collection `src/shared/test-orchestrator/__fixtures__/smoke-plan.postman_collection.json`: top-level folders `Preflight`, `Setup`, `Scenarios`, `Cleanup`; requests target `{{host}}` with header `Authorization: Bearer {{userToken}}`; Setup "Create case" test script calls `pm.environment.set("caseId", pm.response.json().id)`; Scenarios include `SC-1 Bulk create`, `SC-4 Duplicate`, `SC-14 Race A`, `SC-14 Race B`; Cleanup has `Delete case` using `{{caseId}}` (quickstart.md Prerequisites)
- [x] T003 [P] Create the fixture environment `src/shared/test-orchestrator/__fixtures__/smoke-plan.postman_environment.json` with empty `host`, empty `tenantId`, and empty secret `userToken`
- [x] T004 [P] Create the fixture test maps in `src/shared/test-orchestrator/__fixtures__/`: `smoke-plan.test-map.json` (SC-1 with one `before` and two `after` queries, SC-4 `expect: { status: 422, errorCode: "AM00109" }`, concurrent group `race` with `expectAll: [{status:201},{status:409,errorCode:"AM00107"}]`, cleanup entry with `forEach: "caseId"`) and `smoke-plan.no-db.test-map.json` (same entries without any `before`/`after`), both following contracts/test-map-format.md
- [x] T005 [P] Implement the fixture HTTP routes in `src/main/test-orchestrator/test-support/plan-echo-routes.ts` on top of `src/main/api-client/test-support/local-echo-server.ts`: health 200, create case returns `{ id }`, bulk create returns 201 `{ data: { requestId } }`, duplicate returns 422 `{ code: "AM00109" }`, race pair returns one 201 and one 409 `{ code: "AM00107" }`, delete returns 204 (switchable to 500), and a `/expire-token` switch that makes later authenticated calls return 401 until a new token value is sent
- [x] T006 [P] Create the database seed `src/main/test-orchestrator/test-support/seed.sql` (a `requests` table with `id`, `case_id`, `request_id`, `status`, plus enough rows to return 1,000 rows for the truncation scenario)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Types, formats, storage, and the three refactors (plan.md "Foundation") that every story depends on. Existing feature 001/002 tests must stay green.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

### Shared refactors (no behavior change)

- [x] T007 [P] Extract `isLocalHost(host: string): boolean` (`localhost`, `*.localhost`, `127.0.0.0/8`, `::1`, `0.0.0.0`, and equivalent loopback forms) into `src/shared/host-locality.ts`, with tests in `src/shared/host-locality.test.ts`; then make `src/shared/sql-client/sql-connection-locality.ts` call it while keeping its socket-path rule (R13); its existing tests must pass unchanged
- [x] T008 Add optional `variableOverlay?: { environment: EnvironmentVariable[]; collection: Variable[] }` and `variableSink?: (writes: VariableWrite[]) => Promise<void>` to `ExecuteRequestInput` in `src/main/api-client/request-execution.ts`: the overlay replaces the store-read variables, the sink replaces `commitVariableWrites`; with both omitted, behavior is identical (R2). Add cases to the existing request-execution tests covering overlay resolution and sink capture
- [x] T009 [P] Export `snapshotScope` (and confirm `flattenRequestsDepthFirst`, `capDetailBodies`, `enforceRunSizeCap` are exported) from `src/main/api-client/collection-runner.ts` without changing the 001 runner (R1)
- [x] T010 [P] Add `{ kind: 'test-run'; collectionId: ApiNodeId }` to `ApiClientPersistedView` in `src/shared/api-client/api-client-types.ts` and its tolerant parser, keeping the fallback to `empty` for unknown kinds (R18)

### Types, schemas, and the test-map format

- [x] T011 Define the data-model entities in `src/shared/test-orchestrator/test-orchestrator-types.ts`: `TestMap`, `TestMapEntry` (with `link` union `linked | unmatched | ambiguous | broken`), `Expectation`, `VerificationQuery`, `PlanSettings`, `DatabaseModeChoice`, `RunInput`, `TestPlanStep`, `CaptureLedger`, `CapturedValue`, `TestRun`, `RunState` (`setup | running | paused | stopping | cleaning-up | finished`), `StepResult`, `RequestEvidence`, `QueryEvidence`, `PauseRequest`, `PauseAnswer`, `Phase` (data-model.md)
- [x] T012 Write the zod schemas in `src/shared/test-orchestrator/test-orchestrator-schemas.ts` for every storage file (`StoredTestMapSchema`, `StoredPlanSettingsSchema`, `StoredCaptureLedgerSchema`, `StoredTestRunSchema`, each `{ schemaVersion: 1, … }`), every IPC payload in contracts/ipc-renderer-main.md, and the `PauseAnswer` discriminated union per `PauseRequest.kind` plus `{ kind: 'stopping', choice: 'run-cleanup' | 'keep-data' }`
- [x] T013 Write `TestMapFileSchema` in `src/shared/test-orchestrator/test-map-schema.ts` per contracts/test-map-format.md: `orcaTestMap` must be literal `1` (reject other versions naming the supported one); `request` is `{ path: string[] }` or `{ id: string }`; `expect.status` is a number or number array within 100–599; query `sql` "must not be blank"; `precondition` and `changesData` default `false`; query `id` generated when missing; validation rules "`forEach` is allowed only when the phase is `cleanup`", "`expectAll` is allowed only with `concurrentGroup`", "A `stepId` must be unique within the map", "Every `dependsOn` value must name a `stepId` in the map", and variable names in `captures`/`forEach` must match `^[A-Za-z_][\w.-]*$`; unknown top-level/entry fields are accepted and returned as `unknownFields` warnings; parse errors are mapped to `{ path: 'entries[3].expect.status', message }` issues
- [x] T014 [P] Unit tests for the file schema in `src/shared/test-orchestrator/test-map-schema.test.ts`: minimal and full examples from contracts/test-map-format.md parse; version 2, `status: "abc"`, blank SQL, duplicate `stepId`, dangling `dependsOn`, `forEach` outside cleanup, and `expectAll` without group are rejected with the issue path; unknown fields produce warnings
- [x] T015 Implement linking in `src/shared/test-orchestrator/test-map-linking.ts`: match each ref by `id` first, then exact folder path + name, then case- and whitespace-insensitive; a path matching two requests becomes `ambiguous` with candidates and is never linked; previously linked ids no longer present become `broken`; return `{ entries, warnings: { unmatched, ambiguous } }`; also export `rematchTestMap(map, collection)` that re-links from stored refs after re-import (R4)
- [x] T016 [P] Unit tests in `src/shared/test-orchestrator/test-map-linking.test.ts`: by id, exact, insensitive, ambiguous, unmatched, broken after delete, re-match after re-import with new node ids
- [x] T017 [P] Implement phase derivation in `src/shared/test-orchestrator/plan-phases.ts`: normalize (lowercase, strip accents, strip leading numbering/punctuation such as `"01 - Setup"`) and map the EN/ES names in research.md R3's table to `preflight | setup | scenario | cleanup`; unknown folders → `scenario`; tests in `src/shared/test-orchestrator/plan-phases.test.ts` covering every name in the table

### Storage

- [x] T018 Add `testMapFile`, `testPlanFile`, `testCapturesFile`, `testRunFile` (under `test-maps/`, `test-plans/`, `test-captures/`, `test-runs/`, file stem `toSafeFileStem(collectionId)`) to `ApiClientWorktreePaths` in `src/main/api-client/api-client-storage-paths.ts` (contracts/storage-format.md)
- [x] T019 Implement `src/main/test-orchestrator/test-map-store.ts`: read/write the four files with `writeJsonFile`/`readJsonFile` (quarantine to `corrupt/` on invalid); seal `secretInputs` and sensitive ledger values with `sealSecretValue` from `src/main/secret-value-codec.ts` and skip writing secrets when `getSecretProtection()` is `memory-only` — sensitive ledger values are then kept in an in-memory map for the app session and persisted as `{ variable, stepId, unavailable: true }` entries (no value) so they can still be reported (FR-017b); treat a newer `schemaVersion` as read-only (show data, refuse save/start); ledger operations `append`, `markCleaned`, `listUncleaned`, `forget`; latest-run `save`/`get` capped with `capDetailBodies` and `enforceRunSizeCap` (50 MB), no images
- [x] T020 [P] Unit tests for the store in `src/main/test-orchestrator/test-map-store.test.ts`: round-trip each file, corruption quarantine, sealed secrets never written in plain text, memory-only protection (sensitive ledger values held in memory, persisted only as `unavailable` placeholders, reported as unavailable after a simulated restart), newer `schemaVersion` read-only, ledger append/markCleaned/forget

### Service, pauses, IPC, preload, and store skeletons

- [x] T021 [P] Implement the pause primitive in `src/main/test-orchestrator/test-run-pauses.ts`: a `Deferred`-backed registry keyed by `pauseId`, `raise(request) → Promise<PauseAnswer>`, zod validation of answers against the pause kind (`pause-mismatch`, `no-pause` on stale ids), and paused-time accounting so `pausedMs` and step durations exclude pauses (FR-006d, R12); tests in `src/main/test-orchestrator/test-run-pauses.test.ts`
- [x] T022 Create `src/main/test-orchestrator/test-orchestrator-service.ts` (init/get singleton holding the store, `ApiClientService.executionDeps()`, the SQL client deps, and `AgentBrowserBridge`), and initialize it in `src/main/startup/main-process-ready-runtime.ts` after `ApiClientService` and `AgentBrowserBridge` are created
- [x] T023 Create `src/main/ipc/test-orchestrator/test-run-ipc.ts` with the handler registration skeleton (zod-parsed payloads, `assertLocal` on every channel returning `{ ok: false, code: 'not-local' }`, `{ ok: false, code, message }` error shape, error codes from contracts/ipc-renderer-main.md) and register it in `src/main/ipc/register-core-handlers/register-core-handlers.ts`
- [x] T024 [P] Create `src/preload/api/test-run-api.ts` and its bridge (following `src/preload/api/api-client-api.ts` / `api-client-bridge.ts`) exposing `window.api.testRun` with typed invoke methods and event subscriptions for `testRun:changed`, `testRun:paused`, `testRun:finished`, `testRun:testMapChanged`
- [x] T025 [P] Create the renderer slice `src/renderer/src/store/slices/api-client-test-run.ts` (keyed by `(worktreeId, collectionId)`: test map, latest run snapshot, active pause) subscribed to the four events, and wire it into the app store next to `api-client-runner.ts`

**Checkpoint**: Foundation ready — `pnpm tc` and existing 001/002 tests pass; user stories can begin.

---

## Phase 3: User Story 2 - Load a test map into the API Client and see each request's queries (Priority: P1)

**Goal**: Load, replace, edit, export, and remove a collection's test map; requests show their linked verification queries.

**Independent Test**: Import the fixture collection and environment, load `smoke-plan.test-map.json`, and confirm SC-1 is marked in the side panel, its request view lists 1 before and 2 after queries in order with descriptions, and requests not in the map show none (quickstart.md scenarios 1–4).

### Implementation for User Story 2

- [x] T026 [P] [US2] Implement `src/shared/test-orchestrator/test-map-export.ts`: `TestMap` → `orcaTestMap: 1` file content, every request referenced by `path` (folder names + request name), current queries including UI edits, unknown fields dropped (contracts/test-map-format.md Export)
- [x] T027 [P] [US2] Round-trip test in `src/shared/test-orchestrator/test-map-export.test.ts`: export → parse → link against the same collection gives the same links and queries (US2-AS5)
- [x] T028 [US2] Add load/get/save/export/remove to `src/main/test-orchestrator/test-map-store.ts`-backed service methods in `src/main/test-orchestrator/test-orchestrator-service.ts`: load parses with `TestMapFileSchema`, links with `test-map-linking.ts`, returns `conflict` when a map exists and `replace` is not set, writes nothing on failure (FR-003a); `getTestMap` refreshes link states (`broken` for deleted requests); `saveQueries` creates an entry when the request has none and returns `conflict` when `baseLoadedAt` is stale
- [x] T029 [US2] Wire the IPC handlers `testRun:pickTestMapFile`, `testRun:loadTestMap`, `testRun:getTestMap`, `testRun:saveQueries`, `testRun:pickExportFile`, `testRun:exportTestMap`, `testRun:removeTestMap` in `src/main/ipc/test-orchestrator/test-run-ipc.ts` and emit `testRun:testMapChanged` after load/save/remove (contracts/ipc-renderer-main.md "Test map")
- [x] T030 [US2] Re-match stored test maps when a collection is replaced by import: hook into the API Client import path in `src/main/api-client/api-client-service.ts` to call `rematchTestMap`, save, include unmatched/ambiguous refs in the import result warning, and emit `testRun:testMapChanged` (edge case "collection is re-imported")
- [x] T031 [US2] Add "Load test map…", "Export test map…", and "Remove test map" items to the collection context menu in `src/renderer/src/components/api-client/sidebar/collection-tree-menu.ts`, hidden when the API Client is unavailable (SSH); loading over an existing map shows a replace confirmation dialog and retries with `replace: true`; invalid files show the issue list; warnings list unmatched (`Scenarios / Nope`), ambiguous, and unknown fields
- [x] T032 [P] [US2] Show a small "has verification queries" marker and a "broken link" state on request rows in `src/renderer/src/components/api-client/sidebar/CollectionTreeRow.tsx`, using existing tokens/primitives (R17)
- [x] T033 [P] [US2] Implement `src/renderer/src/components/api-client/verification-queries/VerificationQueryEditor.tsx`: `ApiClientCodeEditor` in `pgsql` mode with unresolved `{{variables}}` highlighted the same way the API Client URL bar does (US2-AS6), plus description, `precondition`, and `changesData` controls
- [x] T034 [US2] Implement `src/renderer/src/components/api-client/verification-queries/VerificationQueriesSection.tsx` in the request view (Before and After lists in map order, add/remove/reorder, Save via `testRun:saveQueries`, conflict message when the map was replaced) and mount it in the request editor under `src/renderer/src/components/api-client/request-editor/` only when the collection has a test map or the user adds the first query
- [x] T035 [P] [US2] Add all US2 strings to `src/renderer/src/i18n/locales/en.json`
- [x] T036 [P] [US2] Component tests (Testing Library/happy-dom) in `src/renderer/src/components/api-client/verification-queries/VerificationQueriesSection.test.tsx`: lists queries in order, highlights unresolved variables, save calls IPC with edited queries

**Checkpoint**: US2 works on its own (quickstart scenarios 1–4).

---

## Phase 4: User Story 1 - Run a test plan against an environment and get an evidence file (Priority: P1) 🎯 MVP

**Goal**: "Run as test" on a collection opens a test-run view; after one inputs form the run executes preflight → setup → scenarios → cleanup without database steps and writes `evidencias/<plan>/<timestamp>/report.md` with masked screenshots.

**Independent Test**: Run the fixture plan with `smoke-plan.no-db.test-map.json` against `plan-echo-routes`: inputs are asked once, `caseId` from setup reaches the scenarios, SC-4 passes on `422 · AM00109`, and the evidence folder has every step with request screenshot, expected vs. actual, and pass/fail; `grep -r "<token>" evidencias/` finds nothing (quickstart.md scenarios 5–8, 19–23).

### Pure plan logic (src/shared)

- [x] T037 [P] [US1] Implement `src/shared/test-orchestrator/plan-steps.ts`: collection + test map → ordered `TestPlanStep[]` using `flattenRequestsDepthFirst` order within phase, phase from entry `phase` else `plan-phases.ts`, default `stepId` `<phase initial>-<n>`, title default request name, `requiredVariables` (variables used by the request or its queries that an earlier step captures), concurrent groups collapsed into one step, `dependsOn` never reorders (R3); tests in `plan-steps.test.ts`
- [x] T038 [P] [US1] Implement `src/shared/test-orchestrator/plan-inputs.ts`: empty environment variables → `RunInput[]` (`secret` from `type === 'secret'`, `required` when referenced by any step or query) and a referenced-variable scanner over URL, headers, body, auth, and SQL (FR-004, FR-007); tests in `plan-inputs.test.ts`
- [x] T039 [P] [US1] Implement `src/shared/test-orchestrator/plan-target-hosts.ts`: resolve every request URL with inputs + environment (no send) into distinct hosts tagged `local` via `isLocalHost`; collect unresolved variables; match `allowedHosts` (exact or `*.domain` matching subdomains only) and return `refused: { host, allowedHosts }` (FR-005f, R13); tests in `plan-target-hosts.test.ts`
- [x] T040 [P] [US1] Implement `src/shared/test-orchestrator/step-verdict.ts` in R5's order: transport error → fail; any failed `pm.test` → fail with names; `expect` status (number or list) and `errorCode` via `errorCodePath` or default lookup `code`, `errorCode`, `error.code`, `errors[0].code`; neither → pass on 2xx; produce `expectedText`/`actualText` (`422 · AM00109`, test names, or `2xx`); tests in `step-verdict.test.ts`
- [x] T041 [P] [US1] Implement `src/shared/test-orchestrator/response-capture.ts`: JSON paths like `id`, `data.items[0].id` and `header:<name>`; missing value → error `could not capture <var> from response`; tests in `response-capture.test.ts`
- [x] T042 [P] [US1] Implement `src/shared/test-orchestrator/run-sensitive-values.ts`: a growing set from secret variables/inputs (`collectSecretValues`), every value sent in `Authorization`, `Proxy-Authorization`, `Cookie`, `X-API-Key`, `*-Token`, `*-Key`, `*-Secret` (case-insensitive, including the Bearer/Basic payload), and every captured value whose variable name matches `/token|secret|password|key/i`, all expanded with feature 001's `variants()` and applied through `maskSecrets`/`maskHeaders` from `src/shared/api-client/secret-masking.ts` as `••••` (FR-025, FR-025a, R9); tests in `run-sensitive-values.test.ts` covering header rules, name rules, percent/`+`/JSON-escaped forms, and the <4-char whole-field rule
- [x] T043 [P] [US1] Implement `src/shared/test-orchestrator/evidence-truncation.ts`: bodies "up to 100 KB" (100 × 1024) in UTF-8 bytes cut at a code-point boundary with `> Truncated: showing 100 KB of 2.4 MB.`, query results "up to 200 rows" with `> Truncated: showing 200 of 1,532 rows.` (FR-026); tests in `evidence-truncation.test.ts`
- [x] T044 [US1] Implement `src/shared/test-orchestrator/evidence-markdown.ts` (pure `TestRun` → `report.md` string) following contracts/evidence-bundle-format.md: header table (guide link only when declared, target host only, start time with UTC offset, duration with paused time, database mode, outcome including `⏳ Run in progress`), git-ignore note, summary table with every step (SC-002, including `skipped — run stopped`), cleanup section (each not-cleaned value masked; `unavailable` ones as `<variable> — value unavailable (not stored: secure storage unavailable)`, FR-017b), per-phase step sections in execution order (Before → Request → Response → After → verdict), a `> ⚠ Dependency failed: SC-1` note on steps with `dependencyFailed` (also in the summary row's result), relative `images/…` links with `/`, `text` fences for non-JSON, `(binary, 34 KB, image/png)` for binary, Markdown table-cell escaping, footer with Orca version and run id
- [x] T045 [P] [US1] Golden-file tests for the Markdown in `src/shared/test-orchestrator/evidence-markdown.test.ts` with goldens under `src/shared/test-orchestrator/__fixtures__/evidence/` (passed run, failed with blocked step, stopped run, stopped run with keep data, in-progress run, run with a broken test-map link, run with a `dependency failed` flag, run with an `unavailable` not-cleaned value)

### Execution (src/main)

- [x] T046 [US1] Implement `src/main/test-orchestrator/run-variable-scope.ts`: start from the selected environment + entered inputs + collection variables; produce `variableOverlay` for `executeRequest`; `variableSink` applies script writes (FR-002d) and test-map captures, appends every assigned value to the ledger with `source` and `stepId`, and grows the sensitive set; `resolve(text)` for queries via `buildScopeChain`/`resolveVariables` (R2)
- [x] T047 [US1] Implement `src/main/test-orchestrator/test-run-step-executor.ts` (request part): a test-map entry whose link is `broken` → `skipped` with reason `skipped — broken test-map link` (not sent, still listed in the evidence, SC-002); blocked check (missing `requiredVariables` → `blocked by setup step X`, not sent), `dependsOn` failed → `dependencyFailed` flag, send via `executeRequest` with overlay/sink and the run's `AbortSignal`, apply captures (failure → fail with the capture reason), compute the verdict with `step-verdict.ts`, build masked `RequestEvidence`, and leave hooks for before/after queries (FR-012, FR-013, FR-019)
- [x] T048 [US1] Implement `src/main/test-orchestrator/test-run-orchestrator.ts`: run lifecycle and `RunState` machine (data-model.md), one active run per `(worktreeId, collectionId)` (`busy`, FR-020), phases in order, preflight failure → no setup/scenario requests and ending `preflight-failed` (FR-011), cleanup phase always runs once the run captured any value in setup or scenarios (FR-017; unmarked cleanup steps run once; `forEach` arrives in US7), throttled `testRun:changed` (~10/s plus every state change), `testRun:finished`, and latest-run persistence on finish
- [x] T049 [US1] Implement the hidden snapshot window in `src/main/test-orchestrator/evidence-snapshot-window.ts`: one `BrowserWindow` per run with `show: false`, `webPreferences: { offscreen: true, sandbox: true, webviewTag: false }`, in-memory partition, loads `evidence-snapshot.html`; `render(card) → PNG Buffer` sends `evidenceSnapshot:render`, waits for `evidenceSnapshot:painted`, resizes to the card, `webContents.capturePage()`; never calls `show`, `showInactive`, `focus`, or activation; destroyed at run end (R6, SC-008)
- [x] T050 [P] [US1] Create the snapshot preload `src/preload/evidence-snapshot-preload.ts` exposing only `evidenceSnapshot:render` (subscribe) and `evidenceSnapshot:painted` (send)
- [x] T051 [US1] Add the renderer entry `src/renderer/evidence-snapshot.html` and register it in `electron.vite.config.ts` rollup inputs next to `popout` (and the preload entry from T050)
- [x] T052 [US1] Implement `src/renderer/src/evidence-snapshot/evidence-snapshot-main.tsx` (mounts the card with light-theme tokens from `main.css`, signals painted after two animation frames) and `src/renderer/src/evidence-snapshot/RequestEvidenceCard.tsx` (method + resolved URL, request headers and body, then `ResponseSummary`, `ResponseHeaders`, and the body as a static highlighted block cut to fit, reusing `src/renderer/src/components/api-client/response-viewer/`)
- [x] T053 [US1] Implement `src/main/test-orchestrator/evidence-writer.ts`: root from `splitWorktreeIdForFilesystem(worktreeId).worktreePath` (folder workspaces → folder root); folder `evidencias/<plan-slug>/<YYYY-MM-DD_HH-mm-ss>/` with ASCII `[a-z0-9-]` slug "≤ 60 chars" and `-2`/`-3` suffix if it exists (FR-021); image names `NN-<step-slug>-<request|before-K|after-K>[-<n>].png`; images written per step; `report.md` rewritten with `writeFileDurable` after every step and finally at every transition into `finished` (FR-027); after first write, `checkIgnoredPaths(root, ['evidencias/'])` from `src/main/git/check-ignored-paths.ts` sets `ignoredByGit` (skipped silently for folder workspaces or git failure); never stages or commits
- [x] T053a [P] [US1] Unit tests in `src/main/test-orchestrator/evidence-writer.test.ts` against a temp folder: folder name and slug rules, a second run in the same second gets `-2` and the first folder is untouched (FR-021), image links in `report.md` are relative with `/` (FR-026), `report.md` exists after a failed and a stopped run (FR-027), `ignoredByGit` set for an ignored `evidencias/` and skipped for a folder workspace, and no git index change after the run (FR-027)
- [x] T054 [US1] Wire screenshots and evidence into the step executor and orchestrator: take the request card snapshot after the step's sensitive values are known (R9), pass every evidence string through the run's masker, and call the evidence writer per step
- [x] T055 [US1] Persist remembered inputs (FR-008): on Start with `remember.inputs` save non-secret inputs and with `remember.secrets` seal secret inputs in `test-plans/<id>.json`; pre-fill next time (secret values never returned, only `hasRemembered`); implement `testRun:clearRememberedSecrets`
- [x] T056 [US1] Wire the IPC handlers `testRun:prepare` (`RunSetupModel`: steps by phase, link problems, inputs, `hasQueries`, `dataChangingSteps`, `rememberedMode`, `uncleanedCaptures`, `activeRunId`), `testRun:resolveTargets`, `testRun:start` (re-checks hosts → `host-not-allowed`/`host-unconfirmed`, inputs → `missing-inputs`, then starts), `testRun:getRun`, `testRun:getStepDetail`, `testRun:stop` (moves to `stopping`; prompt comes in US6), and `testRun:answerPause` routed to `test-run-pauses.ts` in `src/main/ipc/test-orchestrator/test-run-ipc.ts`
- [x] T057 [US1] Orchestrator test in `src/main/test-orchestrator/test-run-orchestrator.test.ts` against `plan-echo-routes.ts` with a fake snapshot renderer: full no-db run, `caseId` captured by script reaches scenarios, SC-4 passes on `422 · AM00109`, missing capture → `blocked`, preflight failure sends no setup, second start → `busy`, report contains every step and no token text, and orchestrator overhead per step (step duration minus request time, with the fake renderer) stays under 1 s (plan Performance Goals, SC-001)

### UI (src/renderer)

- [x] T058 [US1] Add "Run as test" to the collection menu in `src/renderer/src/components/api-client/sidebar/collection-tree-menu.ts` (next to the existing Run action) opening the `{ kind: 'test-run', collectionId }` view, and route that view kind in `src/renderer/src/components/api-client/ApiClientPane.tsx` to `TestRunView`
- [x] T059 [P] [US1] Implement `src/renderer/src/components/api-client/test-run/TestRunInputsForm.tsx`: every missing input in one form, secret inputs masked while typing and showing "remembered" state, "Remember inputs"/"Remember secrets" toggles, "Clear remembered secrets" action (FR-007, FR-008)
- [x] T060 [US1] Implement `src/renderer/src/components/api-client/test-run/TestRunSetup.tsx` (FR-005a): environment selector (reuse `EnvironmentSelector.tsx`), inputs form, steps by phase with their linked queries and broken links, debounced `testRun:resolveTargets` showing hosts, a confirmation checkbox naming each non-local host ("I confirm this run targets **qa.example.com**"), a refusal message naming the host and allowed list, and Start disabled until inputs are filled and hosts confirmed; database-mode slot is hidden when `hasQueries` is false
- [x] T061 [P] [US1] Implement `src/renderer/src/components/api-client/test-run/TestRunProgress.tsx` (FR-005b): current phase and step, per-step result rows (pass/fail/skipped/blocked with reason, using the semantic tokens the 001 runner uses), elapsed time excluding pauses, a "waiting for you" state, Stop button, and an inline slot for `TestRunPauseCard`
- [x] T062 [P] [US1] Implement `src/renderer/src/components/api-client/test-run/TestRunPauseCard.tsx` shell that renders the active pause from the slice and dispatches `testRun:answerPause`; story phases add one variant per pause kind
- [x] T063 [P] [US1] Implement `src/renderer/src/components/api-client/test-run/TestRunSummary.tsx` (FR-005d): totals, how the run ended, cleanup summary, "ignored by source control" note, a warning when any captured value is held in memory only and will not survive a restart (FR-017b), and "Open evidence" that opens `report.md` through the editor slice's `openFile`
- [x] T064 [US1] Implement `src/renderer/src/components/api-client/test-run/TestRunView.tsx`: switches setup | progress | summary from the slice, re-fetches `testRun:getRun` on mount so returning to the tab or worktree shows the current state (FR-005c), and opens a step's full details with `src/renderer/src/components/api-client/runner/RunResultDetail.tsx` via `testRun:getStepDetail`
- [x] T065 [P] [US1] Add all US1 strings to `src/renderer/src/i18n/locales/en.json`
- [x] T066 [P] [US1] Component tests in `src/renderer/src/components/api-client/test-run/TestRunSetup.test.tsx`: Start disabled until inputs filled, host confirmation required for non-local, refused host message, no database-mode choice when the plan has no queries

**Checkpoint**: MVP — US2 + US1 deliver a full no-database run with evidence (quickstart 5–8, 19–23). ⚠️ Until US6 (T077), Stop has no Run cleanup / Keep data prompt and FR-016 is only partly met: demo against local or disposable data only.

---

## Phase 5: User Story 3 - Capture database state automatically through the SQL tab (Priority: P1)

**Goal**: Automatic database mode runs before/after queries on a SQL connection, with result screenshots and tables in the evidence.

**Independent Test**: With `ORCA_TEST_PG_URL` seeded from `seed.sql`, run the full fixture map in Automatic mode and confirm SC-1's evidence shows before query + screenshot + table, then the request screenshot, then both after queries, in order (quickstart 9–11).

- [x] T067 [US3] Generalize `runAgentQuery` into `runIsolatedQuery({ connection, password, sql, timeoutMs, readOnly, applicationName })` in `src/main/sql-client/sql-agent-runner.ts`; `runAgentQuery` calls it with `readOnly = (agentAccess === 'read-only')`; existing 002 tests stay green (R8)
- [x] T068 [P] [US3] Define the `DatabaseQueryRunner` interface (`prepare`, `run(query, ctx) → QueryEvidence`, `dispose`) in `src/main/test-orchestrator/database-modes/database-query-runner.ts`
- [x] T069 [US3] Implement `src/main/test-orchestrator/database-modes/automatic-query-runner.ts`: test the connection first with `src/main/sql-client/sql-connection-test.ts`; one dedicated client per run via `connectPgClient` with `application_name = 'Orca Test Run'`; each query through `executeSqlBatch` with 002's `statement_timeout`, 50 MB cap, and bypass rejection; `readOnly = !(connectionIsLocal || step.approvedDataChange)` with `SET TRANSACTION READ ONLY`; a data-changing query (test-map `changesData` or statement classification, whichever is stricter) without approval is not sent and marked `skipped-not-approved`; connection drop → remaining queries `failed` with the connection error while requests continue; close the client at run end
- [x] T070 [US3] Extend `src/main/test-orchestrator/test-run-step-executor.ts` with database steps: before queries → request(s) → after queries (FR-014); a failed `precondition` query blocks the request; other query failures are recorded and the request is still sent; results stored as `QueryEvidence` truncated to "200 rows"
- [x] T071 [P] [US3] Implement `src/renderer/src/evidence-snapshot/QueryEvidenceCard.tsx`: query text plus the SQL tab's results grid in a non-virtualized, height-capped mode; add that mode to `src/renderer/src/components/sql-client/results/SqlResultsGrid.tsx` without changing its default behavior
- [x] T072 [US3] Take query card snapshots in Automatic mode and write them as `before-K`/`after-K` images; extend `evidence-markdown.ts` query blocks (text, description, `run automatically`, screenshot, result table, truncation note, `failed: <error>`, `skipped — data change not approved`) and add a golden case
- [x] T073 [US3] Implement `src/renderer/src/components/api-client/test-run/DatabaseModePicker.tsx` (Automatic: pick one of the project's SQL connections, and the default until T089 enables Manual; Browser slot added in US4) calling `testRun:testDatabase`, and the per-step data-change approval checklist from `dataChangingSteps` in `TestRunSetup.tsx`; remember the last mode in `PlanSettings.databaseMode` (FR-006, FR-009)
- [X] T074 [US3] Wire `testRun:testDatabase` (automatic branch) and pass the database choice and `approvedDataChanges` through `testRun:start` in `src/main/ipc/test-orchestrator/test-run-ipc.ts`; record `databaseMode: { mode: 'automatic', connectionName }` on the run
- [x] T075 [P] [US3] Integration test `src/main/test-orchestrator/automatic-query-runner.integration.test.ts` against `ORCA_TEST_PG_URL` (skipped when unset): before/after order, 1,000-row result truncated to 200, read-only enforced on a connection treated as non-local, unapproved `changesData` skipped, approved one runs
- [x] T076 [P] [US3] Add US3 strings to `src/renderer/src/i18n/locales/en.json`

**Checkpoint**: US1 + US2 + US3 — all P1 stories done. ⚠️ Not releasable yet: the first-time database mode defaults to Automatic until T089 (US5) makes Manual the default (spec Assumptions); do not release or hand out builds before Phase 8, or remembered `Automatic` choices will outlive the change.

---

## Phase 6: User Story 6 - Follow and control a run while it executes (Priority: P2)

**Goal**: Stop with a cleanup/keep-data choice, and recover from an unexpected 401 without re-running passed steps.

**Independent Test**: Start a run, hit `/expire-token` mid-run, enter a new token when asked, and confirm only the 401 step is re-sent and the run finishes; Stop mid-run and confirm nothing more is sent except cleanup (quickstart 15–16).

- [X] T077 [US6] Implement Stop in `src/main/test-orchestrator/test-run-orchestrator.ts`: abort the in-flight request via the run's `AbortSignal`, move to `stopping`, raise the `stopping` prompt (`run-cleanup` default | `keep-data`), mark unreached steps `skipped — run stopped`, set ending `stopped-by-user`, record `keptByUser`; on `keep-data`, put every uncleaned ledger value in `cleanup.notCleaned` so the evidence lists it as not cleaned (SC-006, FR-017); write evidence (US6-AS2, FR-016)
- [X] T078 [US6] Implement unexpected-401 handling in `src/main/test-orchestrator/test-run-step-executor.ts`: status 401 not accepted by the step's expectation raises a `credentials` pause listing the inputs referenced by the step's auth or auth-like headers (all secret inputs when none identified); `resume` updates the run scope and re-sends the same step; `stop` goes to Stop; passed steps are never re-run (FR-015, R14, SC-007)
- [x] T079 [P] [US6] Add the `credentials` (masked inputs + Resume/Stop) and `stopping` (Run cleanup / Keep data) variants to `src/renderer/src/components/api-client/test-run/TestRunPauseCard.tsx`
- [X] T080 [P] [US6] Orchestrator tests in `src/main/test-orchestrator/test-run-control.test.ts`: `/expire-token` → credentials pause → resume re-sends only that step; Stop after setup → no scenario sent, cleanup runs, evidence says "Stopped by user"; Keep data skips cleanup and the evidence lists every captured value as not cleaned
- [x] T081 [P] [US6] Add US6 strings to `src/renderer/src/i18n/locales/en.json`

---

## Phase 7: User Story 7 - Always clean up what setup created (Priority: P2)

**Goal**: Cleanup covers every recorded captured value (with `forEach` repeats), lists what was not cleaned, and can be re-run on its own.

**Independent Test**: Make the delete route return 500, run, and confirm the evidence lists uncleaned `caseId` values; fix the route and use "Run cleanup only" to clean them from the ledger (quickstart 16–17).

- [x] T082 [US7] Implement `src/main/test-orchestrator/test-run-cleanup.ts`: expand cleanup steps — a step with `forEach: "X"` runs once per ledger value of X not yet cleaned with X set to that value (`iterationValue` masked), unmarked steps run once with current values (FR-017a); a value is marked cleaned when a passing cleanup step ran with it; build `cleanup.notCleaned` for the evidence, with `unavailable: true` for placeholder entries whose value was not stored (FR-017b; a `forEach` step never runs with them); uncleaned values stay in the ledger
- [X] T083 [US7] Implement cleanup-only runs (`kind: 'cleanup-only'`) in `src/main/test-orchestrator/test-run-orchestrator.ts` using the stored ledger: no preflight, the same host guard (allowed hosts and non-local confirmation), inputs form, and unexpected-401 credentials pause, and the same `busy` guard as full runs (a cleanup-only run is refused while any run of the plan is active, and vice versa) (FR-005e, FR-005f, FR-020, US7-AS3); list `unavailable` values in its setup screen (FR-017b); and add `testRun:forgetCaptures` to `src/main/ipc/test-orchestrator/test-run-ipc.ts`
- [X] T084 [US7] Add "Run cleanup only" to `src/renderer/src/components/api-client/sidebar/collection-tree-menu.ts` (shown only when `uncleanedCaptures > 0`) and to `TestRunSummary.tsx`, plus a "Forget captured values" action with confirmation
- [x] T085 [P] [US7] Unit tests in `src/main/test-orchestrator/test-run-cleanup.test.ts`: `forEach` expansion over overwritten values, cleaned marking, not-cleaned list after a 500, cleanup-only uses earlier-run values and skips preflight, cleanup-only refused with `busy` while a full run is active and vice versa, `unavailable` placeholders listed as not cleaned and never sent (SC-006, FR-020, FR-017b)
- [X] T086 [P] [US7] Add US7 strings to `src/renderer/src/i18n/locales/en.json`

---

## Phase 8: User Story 5 - Pause for manual queries without database screenshots (Priority: P2)

**Goal**: Manual mode pauses before and after each step with queries, shows them resolved with copy, and records them as run manually.

**Independent Test**: Run the full map in Manual mode; the run pauses before SC-1 with resolved queries, accepts pasted text and Continue, pauses again after the request, and the evidence marks queries "run manually by the user" with the pasted text and no database screenshots (quickstart 14).

- [x] T087 [US5] Implement `src/main/test-orchestrator/database-modes/manual-query-runner.ts`: per step and side (`before`/`after`) raise one `manual-queries` pause with every query resolved (display copy masked, copy action raw); `continue` with optional `pasted: Record<queryId, string>` → `how: 'manual'` with `pastedText`; `skip: queryId[]` → `skipped-by-user`; no screenshots; waits indefinitely (FR-006c)
- [x] T088 [P] [US5] Add the `manual-queries` variant to `src/renderer/src/components/api-client/test-run/TestRunPauseCard.tsx`: each query resolved with a one-click copy action (SC-005a), optional paste-result textarea, Continue and per-query Skip
- [X] T089 [US5] Enable the Manual choice in `DatabaseModePicker.tsx` and make it the first-time default (spec Assumptions), add the user's wait time to each Manual query block, record `databaseMode: { mode: 'manual' }`, and render Manual query blocks (`run manually by the user`, pasted text as a `text` fence, `skipped by user`) in `src/shared/test-orchestrator/evidence-markdown.ts` with a golden case
- [x] T090 [P] [US5] Orchestrator test in `src/main/test-orchestrator/manual-query-runner.test.ts`: pauses before and after, pasted text recorded, Skip marked, paused time excluded from step duration
- [x] T091 [P] [US5] Add US5 strings to `src/renderer/src/i18n/locales/en.json`

---

## Phase 9: User Story 4 - Run queries in a web database console open in Orca's browser (Priority: P2)

**Goal**: Browser mode drives a signed-in web console in an Orca browser tab via `AgentBrowserBridge`, without revealing or focusing it.

**Independent Test**: Open `fake-db-console.html` in an Orca browser tab, pick it in Browser mode, and confirm each query is typed and run there, the evidence has a browser screenshot and result text in order around the request, and the Orca window is never focused or raised (quickstart 12–13).

- [x] T092 [P] [US4] Create the fixture console `tests/e2e/test-orchestrator/fixtures/fake-db-console.html`: a `textarea`, a "Run" button, a results `table` answered from an in-page table, plus switches to show a sign-in screen, an error banner, pagination, a result row containing the run's token, and a `canvas`-drawn result grid
- [x] T093 [US4] Implement `src/main/test-orchestrator/database-modes/browser-console-driver.ts` on `AgentBrowserBridge` by `browserPageId` (R7): locate editor (Monaco/CodeMirror/Ace/`textarea`) and run button matching `/^(run|execute|ejecutar|run query|▶)/i` via `snapshot()`, with test-map `databaseConsole` selectors taking precedence; enter via `focus` → `selectAll` → `keyboardInsertText`; run via `click`, falling back to `keypress` with Cmd+Enter on Mac and Ctrl+Enter elsewhere; wait by polling an `evaluate()` result-DOM hash until change, sign-in/error, or the SQL tab's query timeout from feature 002's settings (30 s when unset); blur sensitive values with T093a before capturing with `screenshot()` (`ensureVisible: false`), skipping the screenshot when T093a reports `residual`/`uninspectable`; read the first table/grid as text (masked); flag `partial` when pagination is visible; parse every `evaluate` result with zod (no casts)
- [x] T093a [US4] Implement `src/main/test-orchestrator/database-modes/browser-console-redaction.ts` (FR-025b, R7 steps 5–7): an `evaluate()` script that takes the run's sensitive set (with feature 001's `variants()` spellings and short-value rule), walks visible text nodes, `input`/`textarea` values, open shadow roots, and same-origin frames, and puts an opaque blurred overlay (solid background + `backdrop-filter: blur`) over each match's client rects; re-reads the visible text and returns `{ covered, residual, uninspectable }` (cross-origin frames or `canvas` in the result region count as uninspectable), parsed with zod; a `restore()` that removes every overlay, always called in `finally`
- [x] T094 [US4] Implement the Browser `DatabaseQueryRunner` in `src/main/test-orchestrator/database-modes/browser-query-runner.ts`: record `blurredCount` or `screenshotWithheld` on each `QueryEvidence` (queries with sensitive values are typed and run, not refused); on error/sign-in/timeout/tab closed raise `browser-recovery` with a screenshot data URL and handle `retry`, `do-manually`, `skip`, `pick-tab`, `switch-rest-to-manual`, `skip-remaining-queries`; a data-changing query runs only when the step was approved (FR-006b, FR-009, US4-AS4)
- [X] T095 [US4] Wire `testRun:listConsoleTabs` (from `AgentBrowserBridge.tabList`) and the browser branch of `testRun:testDatabase` (locate editor and run control, return `console-not-found` with screenshot) in `src/main/ipc/test-orchestrator/test-run-ipc.ts`; record `databaseMode: { mode: 'browser', site }` and remember `origin` to pre-select a matching tab
- [X] T096 [P] [US4] Add the Browser choice with a tab picker (pre-selected by remembered origin) and a note that sensitive values are blurred in console screenshots (withheld if they cannot be) to `DatabaseModePicker.tsx`, and the `browser-recovery` variant (screenshot + recovery actions) to `TestRunPauseCard.tsx`; when `testRun:testDatabase` returns `console-not-found`, show its screenshot in the setup screen with "Check again" (after the user fixes the page), "Choose another mode", and "Cancel", keeping Start disabled until the check passes (US4-AS1)
- [X] T097 [US4] Render Browser query blocks (`run in browser console`, screenshot, result text, `> Result may be partial (the console paginates results).`, `> N sensitive values blurred in the screenshot.`, `> Screenshot withheld: …`) in `src/shared/test-orchestrator/evidence-markdown.ts` with a golden case
- [x] T098 [P] [US4] Unit tests in `src/main/test-orchestrator/database-modes/browser-console-driver.test.ts` with a fake bridge: selector hints win, locate failure, sign-in/timeout → recovery pause, platform modifier for the fallback keypress, no screenshot taken when redaction reports `residual` or `uninspectable`, overlays restored when capture throws; plus `browser-console-redaction.test.ts` running the script in happy-dom: token in the editor and in a result cell covered, percent-encoded and JSON-escaped forms covered, cross-origin frame and `canvas` reported uninspectable, `restore()` leaves the DOM as before
- [X] T099 [P] [US4] Add US4 strings to `src/renderer/src/i18n/locales/en.json`

---

## Phase 10: User Story 8 - Concurrent request scenarios (Priority: P3)

**Goal**: Steps sharing a `concurrentGroup` are sent together and checked with `expectAll` in any arrival order.

**Independent Test**: Run the `race` group; both requests show `sent +0 ms` / `sent +≤10 ms` and the combined `201` + `409 · AM00107` expectation passes in either order (quickstart 18).

- [x] T100 [P] [US8] Add the `expectAll` multiset matcher (bipartite matching over the small set of responses, any order) to `src/shared/test-orchestrator/step-verdict.ts` with tests in `step-verdict.test.ts`
- [X] T101 [US8] Send concurrent groups in `src/main/test-orchestrator/test-run-step-executor.ts` with `Promise.all(executeRequest…)` started in the same tick, record `sentOffsetMs` per request, evaluate the group with `expectAll`, and write one request image per member (`-<n>` suffix) (FR-018); an unexpected 401 on any member raises one `credentials` pause and, on resume, re-sends the whole group together (FR-015)
- [X] T102 [US8] Render concurrent groups in `src/shared/test-orchestrator/evidence-markdown.ts` (one Request/Response block per request with `sent +N ms` and the group verdict) with a golden case, and add a concurrent-group case to `test-run-orchestrator.test.ts`

---

## Phase 11: Polish & Cross-Cutting Concerns

- [x] T103 [P] Generate `docs/reference/orca-test-map.schema.json` from `TestMapFileSchema` with `z.toJSONSchema` via a script registered alongside the repo's other generated-file checks, so CI fails when it is stale
- [x] T104 [P] Write the author/agent reference page `docs/reference/orca-test-map.md` (format, examples, load-time behavior, evidence location) based on contracts/test-map-format.md, and link it from the API Client docs
- [X] T105 Playwright e2e `tests/e2e/test-orchestrator/test-map-load-run-evidence.spec.ts` with `ORCA_BACKGROUND_LAUNCH=1` and CDP screenshots only: import fixtures → load test map → Run as test → fill inputs → finish → Open evidence; assert `report.md` exists and contains no token text; record each real snapshot's render-to-PNG time and assert the median is under 500 ms (plan Performance Goals); in the main process, subscribe to `app.on('browser-window-created')` and each window's `show`/`focus` events and poll `isVisible()`/`isFocused()` after every step, then assert the evidence snapshot window was never visible or focused and no window was shown, focused, or raised during the run (SC-008)
- [X] T106 Playwright e2e `tests/e2e/test-orchestrator/browser-console-mode.spec.ts`: serve `fake-db-console.html`, open it in an Orca browser tab, run in Browser mode, assert screenshots and that the window was never shown/focused; with the token-row switch on, assert the evidence reports at least one blurred value, the token cell's region in the saved PNG is a single solid color (overlay is opaque), and that `report.md` has no token text; with the canvas switch on, assert the screenshot is withheld with its note
- [X] T107 [P] Cross-platform review: Windows-safe slugs and timestamps in `evidence-writer.ts`, `/` in Markdown links on Windows, Linux offscreen capture, Ctrl+Enter fallback; add a Windows-path case to `src/main/test-orchestrator/evidence-writer.test.ts`
- [X] T108 [P] Verify SSH gating: every `testRun:*` handler returns `not-local` for SSH worktrees and the menu items are hidden with the API Client's reason (quickstart 21)
- [X] T109 Run `pnpm tc`, `pnpm test src/shared/test-orchestrator src/main/test-orchestrator`, `oxlint`, `pnpm run check:code-quality:changed`, and the localization verification; split any file over `max-lines` instead of disabling it
- [ ] T110 Run the quickstart.md manual scenarios 1–23 on macOS and scenarios 6, 7, 12, 22 on Windows and Linux; record results in the PR description

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: none.
- **Foundational (Phase 2)**: depends on Setup; blocks every story.
- **US2 (Phase 3)**: after Foundational.
- **US1 (Phase 4)**: after Foundational. It can run a collection with no map on its own; with US2 done it also uses loaded maps (phases, `expect`, captures).
- **US3 (Phase 5)**: after US1 (extends the step executor, setup screen, and evidence Markdown).
- **US6 (Phase 6)** and **US7 (Phase 7)**: after US1; independent of each other except that US6's Stop → Run cleanup uses US7's `forEach` expansion when present.
- **US5 (Phase 8)**: after US1 (pause card shell, step executor DB hooks from US3's T070 and the picker from T073).
- **US4 (Phase 9)**: after US3 (`DatabaseQueryRunner`, picker) and benefits from US5 (`do-manually` reuses manual behavior).
- **US8 (Phase 10)**: after US1.
- **Polish (Phase 11)**: after the desired stories.

### Within Each Story

- Pure `src/shared` logic and its tests → main execution → IPC → renderer UI → strings.
- Files touched by several stories (`test-run-step-executor.ts`, `evidence-markdown.ts`, `TestRunPauseCard.tsx`, `DatabaseModePicker.tsx`, `en.json`, `test-run-ipc.ts`) are edited sequentially across stories, never in parallel.

---

## Parallel Examples

### Phase 2

```text
T007 host-locality.ts   |  T009 export snapshotScope  |  T010 persisted view kind
T014 schema tests       |  T016 linking tests         |  T017 plan-phases.ts
T021 test-run-pauses.ts |  T024 preload bridge        |  T025 renderer slice
```

### User Story 2

```text
T026 test-map-export.ts  |  T032 CollectionTreeRow marker  |  T033 VerificationQueryEditor.tsx
```

### User Story 1

```text
T037 plan-steps.ts  |  T038 plan-inputs.ts  |  T039 plan-target-hosts.ts  |  T040 step-verdict.ts
T041 response-capture.ts  |  T042 run-sensitive-values.ts  |  T043 evidence-truncation.ts
T059 TestRunInputsForm  |  T061 TestRunProgress  |  T062 TestRunPauseCard shell  |  T063 TestRunSummary
```

### User Story 3

```text
T068 database-query-runner.ts  |  T071 QueryEvidenceCard.tsx  |  T075 PG integration test
```

---

## Implementation Strategy

### MVP (P1 core)

1. Phase 1 Setup → Phase 2 Foundational.
2. Phase 3 (US2) and Phase 4 (US1) → validate quickstart 1–8 and 19–23.
3. **Stop and demo**: a full no-database run with evidence, which is the most common deployed-environment case.

### Incremental Delivery

1. - US3 (Automatic mode) → all P1 done (quickstart 9–11); internal demo only until US5 restores the Manual default.
2. - US6 and US7 (control and cleanup) → safe for shared environments (15–17).
3. - US5 (Manual) → restricted environments (14).
4. - US4 (Browser) → web-console environments (12–13).
5. - US8 (concurrent) → race scenarios (18).
6. Polish → e2e, schema publication, docs, cross-platform.

---

## Notes

- Never commit or stage evidence; never show, focus, or raise a window (SC-008).
- Every evidence string and snapshot model goes through the run's masker before it leaves main (SC-003).
- Commit only when the user asks.

---

## Phase 12: Convergence

- [X] T111 Build `dataChangingSteps` in `src/main/test-orchestrator/test-run-setup.ts` with the same rule the runners enforce (`query.changesData || classifyDataChange(query.sql)` from `database-modes/automatic-query-runner.ts`), so unflagged write statements can be approved at the start instead of always being skipped as not approved; add a case to the setup tests per FR-009, US3/AC3, US4/AC4 (partial)
- [X] T112 Record the user's wait time in Manual mode: measure from raising the `manual-queries` pause to its answer in `src/main/test-orchestrator/database-modes/manual-query-runner.ts` and set `waitedMs` on each resulting `QueryEvidence` so the report shows `run manually by the user · waited …`; extend `manual-query-runner.test.ts` per edge case "Manual pause left open" and T089 (partial)
- [X] T113 Remember the last database mode on every Start, whatever the "Remember inputs" toggle says: save `PlanSettings.databaseMode` in `src/main/test-orchestrator/test-run-setup.ts` (`applyRememberChoices`/`saveRememberChoices`) without storing inputs the user chose not to remember; add a test per FR-006 (partial)
