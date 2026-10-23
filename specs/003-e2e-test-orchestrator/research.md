# Research: E2E Test Orchestrator

**Feature**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md) | **Date**: 2026-10-19

User direction for planning: use Orca's current tech stack. Everything below reuses the stack and the modules built in features 001 (API Client) and 002 (SQL tab); no new runtime dependency is added.

---

## R1. Where the run executes

**Decision**: A new main-process service, `TestRunOrchestrator` (`src/main/test-orchestrator/`), owns every run. It calls the feature 001 `executeRequest()` for each request and a feature 002 query runner for each query. The renderer only starts runs, answers pauses, and shows progress from events. The service is created next to `ApiClientService` and receives its `executionDeps()`.

**Rationale**: FR-005c requires the run to continue when the user switches request, tab, or worktree, and FR-019 requires steps to behave exactly as when sent by hand. Feature 001's `CollectionRunner` already runs in main for the same reason. Keeping execution in main means closing or hiding the API Client tab cannot interrupt a run.

**Alternatives considered**:

- _Extend `CollectionRunner`_: it is a flat loop with iterations and delay, and it has no phases, pauses, captures, queries, or cleanup. Adding all of that would make it a different class behind the same name and would put the 001 runner at risk. The orchestrator reuses its pieces instead (`snapshotScope`, `flattenRequestsDepthFirst`, `capDetailBodies`, `enforceRunSizeCap`, the one-run-per-scope `busy` guard). `snapshotScope` is exported for this.
- _Run in the renderer_: a run would stop when its tab unmounts, and screenshots would compete with the UI thread.

## R2. Run-scoped variables, inputs, and captured values

**Decision**: Add two optional fields to `ExecuteRequestInput` (`src/main/api-client/request-execution.ts`):

- `variableOverlay?: { environment: EnvironmentVariable[]; collection: Variable[] }`: the run's working variables. Inputs and captured values are placed in the environment scope. When the field is present it replaces what is read from the store.
- `variableSink?: (writes: VariableWrite[]) => Promise<void>`: when present, it is called instead of `commitVariableWrites`, so script writes go to the run instead of the user's saved environment.

The orchestrator keeps a `RunVariableScope`. It starts from the selected environment plus the inputs the user entered. After each request it applies the script writes (FR-002d) and the captures declared in the test map. Every assigned value is appended to the plan's capture ledger (R11). Queries resolve `{{name}}` against the same scope with the existing `buildScopeChain`/`resolveVariables` (`src/shared/api-client/variable-resolution.ts`).

**Rationale**: Inputs typed for a run (tokens in particular) must not be written into the saved environment file. FR-008 has its own storage rule for them. FR-017 requires every captured value, not only the latest. Routing writes through a sink gives one place that records them, and with both fields omitted, manual sends and the 001 runner behave exactly as they do today.

**Alternatives considered**: writing inputs into the environment before the run and restoring it afterwards. A crash would leave tokens in the environment, other tabs would see values change, and the result conflicts with FR-008.

## R3. Phase derivation and step order

**Decision**: `src/shared/test-orchestrator/plan-phases.ts` maps a top-level folder name to a phase after normalizing it: lowercase, accents removed, and leading numbering or punctuation stripped (`"01 - Setup"` becomes `setup`). The recognized names are:

| Phase     | Recognized names (EN / ES)                                                                            |
| --------- | ----------------------------------------------------------------------------------------------------- |
| preflight | preflight, pre-flight, precheck, pre-check, smoke, verificacion previa, prevalidacion, comprobaciones |
| setup     | setup, set up, arrange, fixtures, seed, preparacion, configuracion, datos de prueba                   |
| scenario  | scenarios, scenario, tests, test cases, cases, escenarios, casos, casos de prueba, pruebas            |
| cleanup   | cleanup, clean up, teardown, tear down, limpieza, borrado, eliminacion                                |

A `phase` set in the test map overrides the folder. Requests outside these folders are scenarios. Within a phase, steps follow the collection's depth-first order (`flattenRequestsDepthFirst`), which is the same order the 001 runner uses. A `dependsOn` entry never reorders steps: it only flags the result (edge case "dependency failed") and blocks the step when a required capture is missing (FR-012).

**Rationale**: The reference collection already uses phase folders. Spanish names are required by the spec.

## R4. Test map format and validation

**Decision**: The test map is a JSON document versioned as `"orcaTestMap": 1`, validated with zod (`src/shared/test-orchestrator/test-map-schema.ts`). The full schema is in [contracts/test-map-format.md](./contracts/test-map-format.md). A request is referenced by `{ "path": ["Setup", "Create case"] }` (folder path plus name) or by `{ "id": "<001 node id>" }`. Validation has two layers:

1. **Structure** (zod): if it fails, the file is rejected with the zod issue paths, and the current links do not change (FR-003a).
2. **Linking**: each reference is matched against the collection. An `id` match wins. Otherwise the path is matched exactly, then case- and whitespace-insensitively. A path that matches two requests is reported as ambiguous and is never linked (US2-AS2: nothing is linked silently to the wrong request). Unmatched and ambiguous references are listed in one warning.

The stored map keeps each entry's original reference together with the request id it resolved to. When a collection is re-imported (its node ids change), the links are matched again from the stored references (edge case "collection is re-imported").

**Rationale**: Agents write test maps next to the guide, so the format must be small and documented, and it should give useful errors. zod is already used for every 001/002 storage and IPC schema. A JSON Schema export is generated from the zod schema (`z.toJSONSchema`, zod 4) and shipped in the contract for agents' editors.

**Alternatives considered**: putting the queries inside the Postman collection (in request descriptions or as a custom `event`). That makes the collection noisy for Postman users, and the spec clarification fixes the test map as a separate JSON file.

## R5. Deciding a step's result

**Decision**: `src/shared/test-orchestrator/step-verdict.ts` decides the result in this order:

1. Transport error (`outcome.kind === 'error'`): **fail** with the error message.
2. Any failed `pm.test`: **fail** with the failing test names.
3. A test-map `expect` exists: the status must match (a number, or a list of numbers) and, if `errorCode` is set, the code must match. The code is read from `expect.errorCodePath` (a dotted JSON path) when given; otherwise the first of `code`, `errorCode`, `error.code`, `errors[0].code` in a JSON body.
4. Neither scripts nor `expect`: **pass** on any 2xx (FR-002c).

The results `blocked` and `skipped` are decided before sending. The evidence's "Expected" column shows the `expect` text, or the names of the `pm.test` assertions, or "2xx".

**Rationale**: FR-002c says scripts first, then the test map "otherwise or in addition". The error-code lookup covers the reference service's `{ "code": "AM00109" }` shape, and the path override covers other services.

## R6. Screenshots without focus

**Decision**: Use a hidden **evidence snapshot renderer**: one `BrowserWindow` per run, created with `show: false`, `webPreferences.offscreen: true`, `sandbox: true`, `webviewTag: false`, and an in-memory partition. It loads a new renderer entry, `evidence-snapshot.html`, built like `popout.html`. Main sends it a masked, plain-data snapshot model over IPC. The page renders it with the same presentational components the tabs use and replies when it has painted. Main then calls `webContents.capturePage()` and writes a PNG. There are two card kinds:

- **Request card**: method and resolved URL, request headers and body, then `ResponseSummary` (status, time, size), response headers, and the body. This reuses the API Client `response-viewer` components. The body is drawn as a static highlighted block instead of Monaco, cut to what fits in the card.
- **Query card**: the query text plus the SQL tab's results grid in a non-virtualized, height-capped mode (the `SqlResultsGrid` presentational part), so the screenshot matches what the SQL tab shows.

The window is destroyed when the run ends. It is never shown, focused, or activated, and `capturePage` on an offscreen renderer does not need a visible window. This meets AGENTS.md "Electron UI Validation" and SC-008.

**Rationale**: FR-005c lets the user be on another tab or worktree, so the live API Client/SQL tab views may not be mounted, and switching to them would take the view away from the user (FR-024, SC-008). Feeding the same components with masked data also makes masking in screenshots hold by construction (FR-025). There is no pixel-level redaction to get wrong.

**Alternatives considered**:

- _Capture the live main window region_: this needs the tab to be visible and selected. It fails when the user is elsewhere and would flash or steal the view.
- _html-to-image inside the main renderer_: it blocks the UI thread, has problems with fonts and Monaco canvases, and repaints the user's window.
- _Markdown only, no images_: the spec explicitly requires screenshots.

**Theme**: snapshots always use the light theme tokens from `main.css`, so evidence looks the same whatever theme the user has. The evidence footer notes the app version.

## R7. Browser mode: driving a web database console

**Decision**: Use the existing **`AgentBrowserBridge`** (`src/main/browser/agent-browser-bridge*.ts`, created in `main-process-ready-runtime.ts`), which drives Orca browser tabs over CDP by `browserPageId`, through a thin adapter, `src/main/test-orchestrator/browser-console-driver.ts`. Per query:

1. **Locate** (once at start, again on recovery): `snapshot()` (accessibility tree) for a code editor or textbox (Monaco, CodeMirror, Ace, or `textarea`) and a button whose name matches `/^(run|execute|ejecutar|run query|▶)/i`. Optional per-site hints in the test map's `databaseConsole` block (`editorSelector`, `runSelector`, `resultSelector`) take precedence. If either is not found, report it (US4-AS1).
2. **Enter**: `focus(editor)` → `selectAll` → `keyboardInsertText(resolvedQuery)`. This works for rich editors, where `fill` does not.
3. **Run**: `click(run)`, falling back to `keypress` with the platform's Ctrl/Cmd+Enter.
4. **Wait**: poll with `evaluate()` until the result region changes (a hash of the result DOM), a sign-in form or error banner appears, or the query timeout passes (the SQL tab default of 30 s). On error, sign-in, or timeout, raise a `browser-recovery` pause (FR-006b).
5. **Blur**: `evaluate()` a redaction script with the run's sensitive set (R9, feature 001's `variants()` spellings and short-value rule). It walks visible text nodes, `input`/`textarea` values, open shadow roots, and same-origin frames, and places an opaque overlay (solid background plus `backdrop-filter: blur`) over each match's client rects. The overlay is solid so nothing can be recovered from the blur. It then re-reads the visible text and reports `{ covered, residual, uninspectable }`. Uninspectable means a cross-origin frame or a `canvas` inside the result region. The result is parsed with zod.
6. **Capture**: if `residual` or `uninspectable` is non-zero, no screenshot is taken and the query's `screenshotWithheld` reason is set. Otherwise `screenshot()` runs (the bridge already passes `ensureVisible: false`, so the tab is not revealed). Result text comes from `evaluate()` reading the first `table`/grid role in the result region, and is masked like every other evidence string. A note marks the result as possibly partial when the page shows pagination (edge case).
7. **Restore**: a second `evaluate()` removes every overlay, in a `finally` so it also runs when capture fails, and the page is left as the user had it.

Query text typed into the console is the resolved query, sensitive values included, because the console needs them to run it. Step 5 hides them in the editor as well as in the result (FR-025b). Queries are not refused.

**Rationale**: The spec requires reusing Orca's browser automation. `AgentBrowserBridge` already supports targeted, non-visible commands on the user's signed-in tab, so the console session (its cookies) is used as is and Orca never stores console credentials.

**Alternatives considered**: _computer-use (desktop control, `src/main/computer/`)_. It moves the real pointer and activates windows, which steals focus and breaks SC-008. Not used.

## R8. Automatic mode: running queries through the SQL tab capabilities

**Decision**: Generalize feature 002's `runAgentQuery` (`src/main/sql-client/sql-agent-runner.ts`) into `runIsolatedQuery({ connection, password, sql, timeoutMs, readOnly, applicationName })`. `runAgentQuery` becomes a call to it with `readOnly = (agentAccess === 'read-only')`. The orchestrator opens **one dedicated client per run** with `connectPgClient` and `application_name = 'Orca Test Run'`, uses it for every query, and closes it when the run ends. Each query runs with `executeSqlBatch` under the same `statement_timeout`, 50 MB cap, and bypass rejection as feature 002 (assumption: the 002 limits apply unchanged).

For each query, the read-only setting is `readOnly = !(connectionIsLocal || step.approvedDataChange)` (FR-009). Each query runs in a transaction with `SET TRANSACTION READ ONLY` when it is read-only. A query that changes data and lacks approval is not sent at all: it is marked "skipped: data change not approved" before anything runs. A query is treated as changing data when the test map flags it (`changesData`) or when `sql-transaction-control`/statement classification shows a non-read statement, whichever is stricter.

When the connection drops, the remaining queries are recorded as failed with the connection error and requests continue (edge case). Before the run starts, the connection is tested with feature 002's `sql-connection-test.ts`.

**Rationale**: FR-006a and FR-019 require the 002 behavior, not a second client. One client per run keeps the order of queries predictable and avoids opening a connection for each query. Using a separate session (not a SQL tab's session) means the run never changes `SET` state in a tab the user has open.

## R9. Masking the evidence

**Decision**: Add `src/shared/test-orchestrator/run-sensitive-values.ts`. It builds the run's sensitive set from:

- secret environment variables and secret inputs (`collectSecretValues`);
- every value **sent** in an auth header: `Authorization`, `Proxy-Authorization`, `Cookie`, `X-API-Key`, `*-Token`, `*-Key`, `*-Secret` (case-insensitive), plus the Bearer/Basic payload;
- every captured value whose variable name matches `/token|secret|password|key/i`.

All three use feature 001's `variants()` spellings (plain, percent-encoded, `+`-encoded, JSON-escaped). The set only grows during a run. Every string that goes to evidence (Markdown and snapshot models) passes through `maskSecrets`/`maskHeaders`. Because the set grows, the Markdown is written last (R10) and snapshots are taken after the step's own sensitive values are known. A token first seen in step 5 is therefore masked in step 5's screenshot and in earlier text. Earlier screenshots cannot contain a value that did not exist yet.

**Rationale**: FR-025/025a and SC-003. Reusing `maskSecrets` keeps feature 001's rule that values shorter than 4 characters are masked only when they are the whole field.

## R10. Evidence bundle layout and writing

**Decision**: `src/main/test-orchestrator/evidence-writer.ts` writes to `<worktree root>/evidencias/<plan slug>/<YYYY-MM-DD_HH-mm-ss>/`:

- `report.md`: the full format is in [contracts/evidence-bundle-format.md](./contracts/evidence-bundle-format.md).
- `<phase>/<case>/<case>-request.png`, `<phase>/<case>/<case>-before-K.png`, and `<phase>/<case>/<case>-after-K.png`.

The plan slug is ASCII, lowercase, `[a-z0-9-]`, at most 60 characters, so it is valid on Windows, macOS, and Linux. Paths are built with `path.join`, and links in the Markdown always use `/` (relative). If the folder already exists, a `-2`/`-3` suffix is added, so earlier runs are never overwritten. Images are written as each step finishes. `report.md` is rewritten (`writeFileDurable`) after every step with "Run in progress" as its outcome, and written a final time at the end. A crash therefore still leaves readable evidence (FR-027).

The worktree root comes from `splitWorktreeIdForFilesystem(worktreeId).worktreePath`. For folder workspaces it is the folder (edge case). After the first write, `checkIgnoredPaths(root, ['evidencias/'])` (existing `src/main/git/check-ignored-paths.ts`, based on `git check-ignore --stdin`, available long before the Git 2.25 baseline) decides whether to add the "ignored by source control" note. For folder workspaces or when git fails, the check is skipped silently. Nothing is staged or committed.

Body and result limits (FR-026) are applied in `evidence-truncation.ts`: 100 KB per body (UTF-8 bytes, cut at a code-point boundary) and 200 rows per query result, each with a note giving the full size.

## R11. Persistence (test maps, plan settings, captures, latest test run)

**Decision**: Store these under the existing per-worktree API Client directory, so feature 001's tombstone, GC, and deletion lifecycle covers them with no new hook (FR-003b):

```
userData/api-client/<hashWorktreeId>/
├── test-maps/<collectionId>.json     # TestMap + resolved links
├── test-plans/<collectionId>.json    # PlanSettings: last db mode + connection/browser origin, non-secret inputs, sealed secret inputs
├── test-captures/<collectionId>.json # CaptureLedger: every captured value, in order, with cleaned status
└── test-runs/<collectionId>.json     # latest TestRun (results without images), replaced by the next test run
```

These files are added to `ApiClientWorktreePaths` and written with the existing `writeJsonFile`/`readJsonFile` (quarantine on corruption). Secret inputs are sealed with `sealSecretValue` from `src/main/secret-value-codec.ts`, the at-rest protection the API Client uses (FR-008). "Clear remembered secrets" deletes the sealed values. A test plan is keyed by collection id because the spec ties a test map to a collection.

## R12. Pauses and the renderer

**Decision**: A pause is a main-side `Deferred` that the orchestrator waits on. A `testRun:paused` event carries a `PauseRequest` (kinds: `manual-queries`, `browser-recovery`, `credentials`). A dropped Automatic-mode connection does not pause: the remaining queries are marked failed with the connection error and requests continue (spec edge case). The renderer answers with `testRun:answerPause`, and an answer that does not match the pause is rejected with a zod parse error. Paused time is excluded from step durations (FR-006d). A run that is waiting has no timeout (edge case). The renderer store slice `api-client-test-run.ts` keeps the latest snapshot per `(worktreeId, collectionId)` and asks main for it again when it mounts, so returning to the tab shows the current state (FR-005c).

## R13. Non-local host guard

**Decision**: Before Start, `plan-target-hosts.ts` resolves every request URL in the plan with the inputs and environment (the same `prepareRequest`/variable resolution, without sending) and collects the distinct hosts. A host is local by `isLocalHost()`, a new `src/shared/host-locality.ts` extracted from `getSqlAgentAccess` (which keeps its socket-path rule on top of it). The rules are:

- If the test map has `allowedHosts` and any host is not on the list (an exact host match, with an optional `*.` wildcard prefix), the run is refused, naming the host and the list (FR-005f). The same applies to "Run cleanup only".
- Otherwise, every non-local host must be confirmed with a checkbox that names it before Start is enabled.

URLs with unresolved variables are flagged as missing inputs, so Start stays disabled until they are filled.

## R14. Unexpected 401

**Decision**: A response counts as an unexpected 401 when its status is 401 and the step's expectation does not accept 401. In that case the run pauses with `credentials`. The credentials to ask for are the plan inputs referenced by the step's effective auth or its auth-like headers. If none can be identified, every secret input is offered. On resume, the scope is updated, the same step is sent again, and passed steps are never re-run (SC-007). The pause can be answered with Stop, which goes to R15.

## R15. Stop and cleanup

**Decision**: Stop aborts the in-flight request (the existing `AbortSignal` passed to `executeRequest`). The user then chooses "Run cleanup" (the default) or "Keep data". Cleanup steps run as described in FR-017a: a step with `forEach: "X"` runs once for each ledger value of `X` that has not been cleaned yet, with `X` set to that value. Other cleanup steps run once. A value counts as cleaned when a passing cleanup step ran with it. Values that are not cleaned are listed in the evidence and stay in the ledger. "Run cleanup only" runs only the cleanup phase against the ledger, with the same host guard and inputs form. Cleanup also runs after a failed preflight when nothing was captured, which does nothing (FR-017).

## R16. Concurrent groups

**Decision**: The steps that share a `concurrentGroup` are started in the same tick with `Promise.all(executeRequest…)` and evaluated together. The group's `expectAll` is a multiset of outcomes (for example `[{status:201},{status:409,errorCode:"AM00107"}]`) and is matched against the responses in any order, using bipartite matching over a small n. The evidence shows each request's send time offset (in ms) so the reader can see how close they were.

## R17. UI placement

**Decision**: All new UI stays inside the API Client:

- The collection's context menu in `collection-tree-menu.ts` gets "Load test map…", "Export test map…", "Run as test", and "Run cleanup only" (the last only when the ledger has values not yet cleaned).
- `CollectionTreeRow` gets a small marker on requests with linked queries, and a "broken link" state for links whose request was deleted.
- The request view gets a "Verification queries" section (`components/api-client/verification-queries/`) with `ApiClientCodeEditor` in `pgsql` mode, highlighting unresolved variables like the URL bar does (US2-AS6). Save writes the test map in Orca data.
- `ApiClientPersistedView` gets a new `{ kind: 'test-run'; collectionId }` view, rendered by `components/api-client/test-run/` (`TestRunView` → `TestRunSetup` | `TestRunProgress` | `TestRunSummary`, plus `TestRunPauseCard`). It reuses `RunResultDetail` to open a step's full details (FR-005c).
- "Open evidence" opens `report.md` through the editor slice's `openFile`, so it shows in Orca's Markdown preview.

All components use the `components/ui/` primitives and tokens from `main.css`, following `docs/STYLEGUIDE.md`. Status colors use the semantic tokens the 001 runner already uses for pass and fail.

## R18. SSH, folder workspaces, remote wire, and cross-platform

- **SSH**: local-only, like the two tabs. Every new IPC handler goes through the existing `assertLocal()` from `workspace-local-host-guard.ts`, and the menu items are hidden by the existing API Client availability.
- **Folder workspaces**: supported. Evidence goes to the folder root, and the git-ignore check is skipped.
- **Remote wire**: no RPC or CLI methods are added (FR-028), no new stream opcodes, and the `api-client` tab is still not published to paired clients. The new persisted view kind is only parsed by the renderer, which falls back to `empty` for an unknown kind (the 001 tolerant parse).
- **Cross-platform**: `path.join` everywhere, Windows-safe folder names, no child processes except the existing git runner, and the platform modifier for Ctrl/Cmd+Enter in Browser mode. `offscreen` rendering is supported on all three platforms.

## R19. Testing strategy

- **Unit (Vitest)**: test-map schema and linking (exact, case-insensitive, ambiguous, by id, re-match after re-import); phase derivation (EN/ES names); verdict rules; sensitive-value collection and masking (header and name rules, encoded forms); truncation; host locality and allowed hosts; the cleanup `forEach` expansion and "not cleaned" list; the concurrent `expectAll` matcher; evidence Markdown rendering (golden files).
- **Orchestrator (Vitest + feature 001's `local-echo-server`)**: a full plan run with captures, a blocked step, an unexpected 401 then resume, Stop then cleanup, and Manual-mode pauses answered by the test. The SQL runner and browser driver are faked behind their interfaces.
- **Integration**: Automatic mode against `ORCA_TEST_PG_URL` (skipped when unset), as in feature 002; read-only enforcement on a host treated as non-local.
- **E2E (Playwright Electron)**: `ORCA_BACKGROUND_LAUNCH=1`, CDP screenshots of the hidden window. Load a test map → run → open the evidence. Browser mode runs against a local fixture "console" page (a static HTML with a textarea, a Run button, and a table) served from the test.
