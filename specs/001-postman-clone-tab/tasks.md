---
description: 'Task list for the API Client Tab (Postman-compatible) feature'
---

# Tasks: API Client Tab (Postman-compatible)

**Input**: Design documents from `specs/001-postman-clone-tab/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/ (ipc-renderer-main, cli-rpc, storage-format, script-sandbox-api), quickstart.md

**Tests**: Included. research.md R16 and quickstart.md "Automated checks" require unit suites for the import round-trip, variable resolution, storage tombstone/GC, secret encryption, the sandbox `pm` API, and runner sequencing, plus Playwright e2e for the P1 flows. Tests sit next to their sources (`*.test.ts[x]`); e2e under `tests/e2e/api-client/`.

**Organization**: Tasks are grouped by user story. The agent/CLI requirements (FR-032 – FR-037, clarification Q1) are **US7 – Agent and CLI access** in spec.md.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: US1–US7 (see above)

## Rules that apply to every task (from AGENTS.md / plan.md)

- UI: only `src/renderer/src/components/ui/` primitives and tokens from `src/renderer/src/assets/main.css`; no raw palette colors, no computed `className` strings (`docs/STYLEGUIDE.md`).
- All user-visible strings via `translate()` with keys under the `apiClient.*` namespace in `src/renderer/src/i18n/locales/en.json`.
- No `max-lines` disables — split files instead. No vague file names (`utils`, `helpers`). No type assertions except `as const`; parse with zod.
- Shortcuts use the platform check (`metaKey` on Mac, `ctrlKey` elsewhere); paths use `path.join`.
- Every main-process entry point rejects non-local worktrees with code `not-local` (FR-001a).
- Comments: brief, non-obvious only.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: New dependencies, test fixtures, and test infrastructure.

- [x] T001 Add `quickjs-emscripten` as a runtime dependency and `chai` as a dev dependency in `package.json` (`pnpm add quickjs-emscripten`, `pnpm add -D chai ajv`), updating `pnpm-lock.yaml`; confirm `pnpm tc` still passes
- [x] T002 [P] Create `config/scripts/build-api-client-chai-bundle.mjs` that uses esbuild (existing dev dependency) to bundle `chai` as an IIFE string and writes `src/main/api-client/script-sandbox/chai-bundle-source.ts` (`export const CHAI_BUNDLE_SOURCE: string`); add `build:api-client-chai` and a `--check` mode wired as `verify:api-client-chai` in `package.json` (also added to the `lint` script so CI runs it), and check in the generated file
- [x] T003 [P] Create synthetic fixture `src/shared/api-client/__fixtures__/smoke.postman_collection.json` (Postman v2.1): 2 top-level folders (`MAIN` and `SECONDARY`), nested groups G1–G10, exactly 37 requests each with a test script, headers using `{{baseUrl}}`/`{{tenantId}}`, raw JSON bodies, one urlencoded and one formdata body, collection- and folder-level variables, collection/folder/request pre-request scripts, one test that sets an environment variable (token) used by a later request, one request with `protocolProfileBehavior.strictSSL: false`, one script calling `pm.sendRequest` (for import warnings), and unknown extra fields (for passthrough). No real tokens
- [x] T004 [P] Create fixtures `src/shared/api-client/__fixtures__/smoke.postman_environment.json` (27 variables, at least 2 of type `secret`, at least 1 disabled), `src/shared/api-client/__fixtures__/smoke-v2.0.postman_collection.json` (small v2.0 collection with string URLs and array-form auth), and `src/shared/api-client/__fixtures__/invalid.postman_collection.json` (item with a numeric `request.url`)
- [x] T004a [P] Add the official Postman Collection v2.1 JSON schema to `src/shared/api-client/__fixtures__/postman-collection-v2.1.schema.json`, saved from `https://schema.getpostman.com/json/collection/v2.1.0/collection.json`, with its source URL and license in a sibling `postman-collection-v2.1.schema.README.md`; used only by T093
- [x] T005 [P] Create test-only local server `src/main/api-client/test-support/local-echo-server.ts` built on `node:http` on a random port: `/echo` (returns method, url, headers, body as JSON), `/status/:code`, `/delay/:ms`, `/large/:mb` (JSON of N MB), `/binary`, `/redirect/:n`, `/token` (returns `{ token }`); exports `startLocalEchoServer(): Promise<{ baseUrl, close }>`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared model, main-owned store, IPC/preload bridge, the `api-client` tab type with its '+' entry, and the empty pane + side panel shells.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

### Shared model

- [x] T006 [P] Define all entities from data-model.md in `src/shared/api-client/api-client-types.ts`: `ApiNodeId`, `WorktreeApiData` (`schemaVersion: 1`, `activeEnvironmentId: ApiNodeId | null`, `revision`), `Collection`, `Folder` (`kind: 'folder'`), `Request` (`kind: 'request'`; `method` upper-cased, `url: { raw; query: KeyValue[] }` + `pathVariables: KeyValue[]`, `body.mode: 'none' | 'raw' | 'urlencoded' | 'formdata' | 'file' | 'graphql'`, `settings: { sslVerification?; followRedirects?; timeoutMs? }`), `KeyValue = { key, value, enabled, description? }`, `Auth` (`noauth`, `inherit`, `bearer`, `basic`, `apikey` + preserved others), `Variable`/`EnvironmentVariable` (`value: string | null`, `type: 'default' | 'secret'`, runtime-only `needsReentry?: boolean`), `Environment`, `ScriptEvents`/`Script` (`exec: string[]`), `LatestResult` (`origin: 'manual' | 'run' | 'agent'`, `ApiErrorCode`: `network`, `timeout`, `cancelled`, `certificate`, `dns`, `unsupported-auth`, `script-error`, `invalid-url`), `ResponseSnapshot` (`body.encoding: 'utf8' | 'base64' | 'omitted'`, `truncated`), `TestResult`, `LogLine` (`level: 'log'|'info'|'warn'|'error'`, `phase: 'prerequest'|'test'`), `ConsoleEntry`, `Run` (`options.iterations: 1–1000`, `options.delayMs: 0–60000`, `state: 'running' | 'stopped' | 'completed' | 'failed-to-start'`, `stoppedEarly: boolean`, `origin: 'manual' | 'agent'`), `RunRequestResult`, and `postmanExtra: Record<string, unknown>` on every Postman-derived node
- [x] T007 Create zod schemas in `src/shared/api-client/api-client-schemas.ts` for every on-disk file in contracts/storage-format.md (`meta.json` `{ schemaVersion: 1, worktreeId, createdAt }`, `state.json`, collection, environment with persisted secret form `{ key, enabled, type: 'secret', cipher: <base64> }` and no plain `value`, `results/<requestId>.json`, `runs/<scopeId>.json`) and for every IPC payload/response in contracts/ipc-renderer-main.md (`{ ok: true, ... } | { ok: false, code, message }` with codes `not-local`, `not-found`, `conflict`, `invalid-import`, `busy`, `duplicate-name`, plus the optional success field `secretProtection: { level: 'memory-only' | 'weak', message }`); enforce collection/environment `name` 1–200 chars, iterations 1–1000, delayMs 0–60000 (depends on T006)
- [x] T008 [P] Implement pure tree operations in `src/shared/api-client/collection-tree.ts`: `findNode`, `getAncestorChain` (collection → outer → inner folder), `flattenRequestsDepthFirst(scope)` (FR-021 order), `insertNode`, `removeNode` (returns removed request ids), `moveNode`, `duplicateNode` (fresh ids for the copy), `renameNode`
- [x] T009 [P] Unit tests for T008 in `src/shared/api-client/collection-tree.test.ts` (depth-first order on nested folders, move across folders, duplicate gives new ids, remove returns all nested request ids)

### Tab type plumbing

- [x] T010 Add `'api-client'` to `TabContentType` and `WorkspaceVisibleTabType` in `src/shared/tab-types.ts` and to the persisted enums in `src/shared/workspace-session-tab-type-schema.ts`; make session parsing drop a tab with an unknown `contentType` instead of failing the whole session (R3); add tests in `src/shared/workspace-session-tab-type-schema.test.ts`
- [x] T011 Exclude `api-client` tabs from tab snapshots published to paired mobile/web clients (the projection used by the `mobile-session-*` code; find it with `rg -n "'simulator'" src/main src/shared -g '!*.test.*'`) and add a regression test next to that projection (R3, remote wire compatibility)
- [x] T012 Walk the simulator tab footprint in the renderer (`rg -l "'simulator'" src/renderer -g '!*.test.*'`, ~45 files across `src` total) and add the `api-client` branch everywhere a tab type is switched on: tab icon (lucide icon), tab title, tab-bar projection, close/bulk-close, tab cycling, drag data, command palette search, `toVisibleTabType`, `src/renderer/src/store/slices/tabs/tabs-surface.ts`, `src/renderer/src/store/slices/tabs/tabs-reconciliation.ts`; `pnpm tc` must report no non-exhaustive switch
- [x] T013 [P] Create the `apiClient` translation namespace in `src/renderer/src/i18n/locales/en.json` with the shared strings (tab title "API Client", "Local worktrees only", empty-state text, Save/Discard/Cancel, error-code messages for each `ApiErrorCode` and IPC error code); later tasks add their own keys here

### Main-process data layer

- [x] T014 [P] Implement `src/main/api-client/api-client-storage-paths.ts`: root `path.join(app.getPath('userData'), 'api-client')`, per-worktree dir from `hashWorktreeId` (`src/main/terminal-history-id.ts`), subpaths `meta.json`, `state.json`, `collections/<id>.json`, `environments/<id>.json`, `results/<requestId>.json`, `runs/<scopeId>.json`, `corrupt/`, and the `.pending-delete/` dir; take the root as a parameter so tests can use a temp dir
- [x] T015 [P] Implement `src/main/api-client/api-client-secret-codec.ts` on top of `SecretStore` (`src/shared/secret-store.ts`, desktop `src/main/host/electron-secret-store.ts`): `encryptEnvironmentSecrets` (secret values → `{ cipher: base64 }`, plain value never kept in the persisted object), `decryptEnvironmentSecrets` (failure → `value: null`, `needsReentry: true`, FR-009b), the "encryption unavailable" path (secrets kept in memory only, never written; reported as `secretProtection: { level: 'memory-only', message: describeProtectionGap() }`), and the Linux `basic_text` path (still encrypt and write, but report `secretProtection.level: 'weak'` with the `describeProtectionGap()` text)
- [x] T016 [P] Unit tests for T015 in `src/main/api-client/api-client-secret-codec.test.ts` with a fake `SecretStore`: round-trip, ciphertext contains no plaintext, decrypt failure yields `null` + `needsReentry`, unavailable encryption never writes the value, and the `basic_text` case writes cipher text and reports a warning
- [x] T017 Implement `ApiClientStore` in `src/main/api-client/api-client-store.ts`: one lazily loaded in-memory cache per worktree; zod-validated reads with invalid files moved to `corrupt/<name>.<ts>.json` and reported while the rest loads; writes via `writeFileDurable` (`src/main/durable-file-write.ts`); `meta.json` created on first write; monotonic `revision` per worktree and per collection/environment with `conflict` on a stale `baseRevision` (R9); an unknown higher `meta.schemaVersion` opens read-only; emits change events `{ worktreeId, revision, kind: 'collection'|'environment'|'active-environment', id? }`; methods `getSnapshot`, `setActiveEnvironment` (depends on T007, T014, T015)
- [x] T018 Unit tests for T017 in `src/main/api-client/api-client-store.test.ts` using a temp dir: lazy creation, write-through survives a fresh store instance (restart), stale revision → `conflict`, corrupt file quarantined while others load, two worktree ids never see each other's data (FR-030), the data dir comes only from `hashWorktreeId(worktreeId)` and a store reopened with the same worktree id (as after a branch switch, where path and id are unchanged) loads the same collections, environments, and active environment (FR-028)
- [x] T019 [P] Implement `src/main/api-client/api-client-local-host-guard.ts`: `assertLocalApiClientWorktree(worktreeId)` that resolves the worktree's execution host and returns `{ ok: false, code: 'not-local' }` unless it is `LOCAL_EXECUTION_HOST_ID`; covers folder workspaces as local

### IPC, preload, renderer state

- [x] T020 Create `src/main/ipc/api-client/api-client-ipc.ts` with `registerApiClientHandlers()` implementing `apiClient:getSnapshot` and `apiClient:setActiveEnvironment`, zod-validating every payload, applying T019, and broadcasting store change events as `apiClient:changed`; register it in `src/main/ipc/register-core-handlers/register-core-handlers.ts`
- [x] T021 Create `src/preload/api/api-client-api.ts` (types) and `src/preload/api/api-client-bridge.ts` exposing `window.api.apiClient` (invoke wrappers + `onChanged` subscription); wire into `src/preload/index.ts` and `src/preload/api-types.ts`, mirroring `emulator-api.ts`/`emulator-bridge.ts`
- [x] T022 Create the renderer slice `src/renderer/src/store/slices/api-client.ts`: per-worktree snapshot cache refreshed on `apiClient:changed`; per-tab state `{ tabId, worktreeId, view: { kind: 'empty' } | { kind: 'request'; requestId } | { kind: 'environment'; environmentId } | { kind: 'runner'; scope }, draft, consoleCollapsed, consoleHeight, splitRatio }`; register it in the root store
- [x] T023 Create `src/renderer/src/lib/ensure-api-client-tab.ts` modeled on `src/renderer/src/lib/ensure-simulator-tab.ts` (create or activate an API Client tab for a worktree, optionally setting its view)

### Tab entry point and shells

- [x] T024 Add the `new-api-client` kind to `src/renderer/src/components/tab-bar/tab-create-menu-options.ts`, grouped with the other tab types and above the agent list (FR-001); add a `hasApiClient` flag to the menu context computed from the active worktree's execution host — on SSH worktrees render the option disabled with the "Local worktrees only" hint (FR-001a); selecting it calls T023; add a test in `src/renderer/src/components/tab-bar/tab-create-menu-options.test.ts`
- [x] T025 Create `src/renderer/src/components/api-client/ApiClientPane.tsx` (tab root: header area, request/response region, console region placeholder, empty state) and route `contentType === 'api-client'` to it from the tab content renderer used for simulator tabs
- [x] T026 Add the right-sidebar render-time override (R4): in `src/renderer/src/components/right-sidebar/index.tsx` (routing in `use-right-sidebar-tab-routing.ts`) render `src/renderer/src/components/api-client/sidebar/ApiClientSidebarPanel.tsx` (sections "Collections" and "Environments", empty states, Import button placeholder) when the focused group's active tab is `api-client`; do not change the persisted `RightSidebarRoute`; test that switching to another tab restores the previous panel

**Checkpoint**: An empty API Client tab can be opened from '+' on a local worktree, and the side panel switches while it is active.

---

## Phase 3: User Story 1 - Import a Postman collection and environment (Priority: P1) 🎯 MVP

**Goal**: Import Postman v2.0/v2.1 collections and environment files into a worktree and see them in the side panel with identical structure.

**Independent Test**: Open an API Client tab, import `smoke.postman_collection.json` and `smoke.postman_environment.json`; every folder, request, and the 27 variables appear with the same names, order, and nesting; secrets are masked; importing `invalid.postman_collection.json` shows an error naming the problem and changes nothing.

### Tests for User Story 1

- [x] T027 [P] [US1] Unit tests in `src/shared/api-client/postman-import.test.ts`: the smoke fixture imports with 2 top-level folders, 37 requests in original order/nesting, all headers/bodies/scripts/variables preserved (SC-001); v2.0 fixture normalizes to the v2.1 shape; Postman ids reused when unique, UUIDs generated otherwise and duplicate ids regenerated; `pm.sendRequest` produces an import warning; invalid fixture returns an error with the zod path (e.g. `item[3].request.url: expected string or object`); environment import keeps name, value, enabled, type
- [x] T028 [P] [US1] Unit tests in `src/main/api-client/api-client-import.test.ts`: invalid file writes nothing (acceptance 1.4); same-name collection without `onDuplicate` returns `duplicate-name` + `existingId`; `replace` keeps the existing id; `keep-both` adds the suffix ` (2)`; secret values are encrypted on disk after environment import

### Implementation for User Story 1

- [x] T029 [P] [US1] Implement Postman zod schemas in `src/shared/api-client/postman-schema.ts`: Collection v2.0 and v2.1 (info, item tree, request with string-or-object `url`, header, body modes, auth in array and object forms, event/script, variable, `protocolProfileBehavior`) and environment export (`values[]` with `key`, `value`, `enabled`, `type`), `.passthrough()` on every object
- [x] T030 [US1] Implement `src/shared/api-client/postman-import.ts`: detect collection vs environment, normalize v2.0 → v2.1, map to internal types (unknown fields into `postmanExtra`, `strictSSL`/`followRedirects` into `request.settings`, scripts kept as `exec: string[]`, query kept in sync with `url.raw`), assign stable ids (FR-034), and build `importWarnings` by scanning scripts for `pm.sendRequest`, `pm.visualizer`, `pm.cookies`, `pm.require`, `setNextRequest`, `require(` and for unsupported auth/body types; return `{ ok: false, message }` with the zod issue path on failure (depends on T029)
- [x] T031 [US1] Add `importCollection` / `importEnvironment` to `src/main/api-client/api-client-store.ts` with `onDuplicate?: 'replace' | 'keep-both'` (suffix ` (2)`, ` (3)` …), all-or-nothing writes, collection/environment order updated in `state.json`
- [x] T032 [US1] Add `apiClient:importFile` to `src/main/ipc/api-client/api-client-ipc.ts` (`{ worktreeId, filePath, onDuplicate? }` → `{ kind, id, warnings[] }` or `invalid-import` / `duplicate-name`) and expose it in `src/preload/api/api-client-bridge.ts`; file selection uses the existing open-file dialog bridge with a `.json` filter
- [x] T033 [US1] Implement tree management (FR-005): `treeOp` in `api-client-store.ts` (create/rename/duplicate/move/delete for collections, folders, requests using T008; deleting removes `results/<id>.json` and `runs/<id>.json` for every removed node) and `apiClient:treeOp` in `api-client-ipc.ts` + preload
- [x] T034 [P] [US1] Implement `src/renderer/src/components/api-client/sidebar/CollectionTree.tsx`: virtualized (`@tanstack/react-virtual`) folder tree with expand/collapse, HTTP method badge (`Badge`) next to each request name, name search filter (FR-006), and a `DropdownMenu`/`ContextMenu` with New request, New folder, Rename, Duplicate, Move to… (a `Dialog` listing the collection's folders plus the collection root, excluding the node itself and its descendants), Delete (Run and Export entries added in US4/US6); clicking a request sets the active tab's view to `{ kind: 'request', requestId }`
- [x] T035 [P] [US1] Implement `src/renderer/src/components/api-client/sidebar/EnvironmentList.tsx` listing environments with variable counts and the active marker
- [x] T036 [P] [US1] Implement `src/renderer/src/components/api-client/sidebar/ImportDialog.tsx` (`Dialog`): choose a file, show the error message on failure, offer Replace / Keep both on `duplicate-name`, and list import warnings after success
- [x] T037 [US1] Wire T034–T036 into `src/renderer/src/components/api-client/sidebar/ApiClientSidebarPanel.tsx` with the Import button and a "New collection" button (calls `apiClient:treeOp` `create` with `kind: 'collection'`, then starts an inline rename), and add the new `apiClient.*` strings to `src/renderer/src/i18n/locales/en.json`
- [x] T038 [P] [US1] Component test `src/renderer/src/components/api-client/sidebar/CollectionTree.test.tsx` (Testing Library + happy-dom): nested order, expand/collapse, search filter, method badges, Move to… excludes the node and its descendants

**Checkpoint**: Importing the fixtures shows the full tree and environment in the side panel.

---

## Phase 4: User Story 2 - Send a request and inspect the result (Priority: P1)

**Goal**: Edit and send the selected request with the active environment; see the response, tests, and a collapsible console.

**Independent Test**: With the fixtures imported and `baseUrl` pointed at the local echo server, select a request, pick the environment, Send: variables are resolved, the response with status/time/size/headers/pretty JSON shows, tests list pass/fail, and the console entry expands to full details.

### Tests for User Story 2

- [x] T039 [P] [US2] Unit tests in `src/shared/api-client/variable-resolution.test.ts`: scope precedence (script `pm.variables` → environment → folder chain innermost first → collection), disabled variables ignored, last enabled duplicate wins, `{{ name }}` whitespace, dynamic `{{$guid}}`/`{{$timestamp}}`/`{{$isoTimestamp}}`/`{{$randomInt}}`, unknown names and unknown `$` names left literal and reported as unresolved spans
- [x] T039a [P] [US2] Unit tests in `src/shared/api-client/secret-masking.test.ts` (FR-009c): a secret inside a longer string (`Bearer abc123`), in a URL query, inside a JSON body, echoed back in a response body, in a script log line; a percent-encoded secret in a query string; a secret with quotes or backslashes inside a JSON body; Basic auth whose password is a secret → `Basic ••••`; values under 4 characters masked only when they fill a whole field; overlapping secrets
- [x] T040 [P] [US2] Unit tests in `src/main/api-client/script-sandbox/pm-api-shim.test.ts` running real QuickJS against canned responses: `pm.test` pass/fail/throw, `pm.expect` chai assertions, `pm.response.json()/text()/code/headers.get`, `pm.response.to.have.status`, environment/collection/variables get/set, `console.*` capture, legacy `tests[...]`/`responseBody`/`postman.setEnvironmentVariable`, `NotSupportedError` naming `pm.sendRequest`, 5 s timeout and 32 MB memory limit enforced, no access to `require`/`process`/`globalThis` host objects
- [x] T041 [P] [US2] Unit tests in `src/main/api-client/http-request-sender.test.ts` against T005 with an injected fetch: resolved request sent, manual redirect loop (max 10, hops recorded, `followRedirects: false` honored), body capped at 10 MB with `truncated`, binary detection, `AbortController` cancel → `cancelled`, closed port → `network`, timeout → `timeout`, `net::ERR_CERT_*` → `certificate`, forbidden headers dropped with a warning
- [x] T042 [P] [US2] Unit tests in `src/main/api-client/request-execution.test.ts`: script order (collection → folders outer→inner → request for prerequest and test), prerequest throw aborts send with `script-error`, secrets masked via `maskSecrets` in `resolvedRequest`, response body, script logs, and console entries (a secret token sent to `/echo` appears nowhere in the saved result), `LatestResult` written to `results/<requestId>.json` with origin, console ring buffer receives the entry; auth inheritance: a request with `inherit` (or no auth) uses the nearest folder's auth, then the collection's, `noauth` at any level stops inheritance, `{{var}}` inside inherited bearer/basic/apikey fields resolves with the request's scopes, and an inherited unsupported type (oauth2) gives `unsupported-auth`

### Implementation for User Story 2

- [x] T043 [P] [US2] Implement `src/shared/api-client/variable-resolution.ts`: `buildScopeChain`, `resolveTemplate(text, scopes)` → `{ text, unresolved: { name, start, end }[] }`, `resolveRequest(request, scopes)` covering URL, params, headers, body, and auth (FR-012/013); dynamic variables generated per call
- [x] T043a [P] [US2] Implement `src/shared/api-client/secret-masking.ts` (FR-009c): `collectSecretValues(environment)` (each secret plus its `encodeURIComponent` and JSON-escaped variants, deduplicated), `maskSecrets(text, secretValues)` (longest value first; values under 4 characters masked only as a whole field), and `maskAuthorizationHeader(header, secrets)` (masks the whole `Basic …` value when the decoded `user:pass` contains a secret)
- [x] T044 [P] [US2] Implement `src/main/api-client/api-client-console-buffer.ts`: 500-entry ring buffer per worktree with `append`, `list`, `clear`, and an append listener; body previews capped at 256 KB
- [x] T045 [P] [US2] Implement `src/main/api-client/http-request-sender.ts`: `ses.fetch()` (not `net.fetch`, which always uses the default session) on `session.fromPartition('orca-api-client')` or `session.fromPartition('orca-api-client-insecure')` (the latter with `setCertificateVerifyProc((_, cb) => cb(0))`), both created once lazily, chosen by request override → app-wide `GlobalSettings.apiClientSslVerification` (FR-017a); OS proxy via Chromium (FR-017b); `redirect: 'manual'` follow loop; streamed body capped at 10 MB; total time and TTFB; `AbortController` cancel; error mapping to `ApiErrorCode` with the certificate message pointing to the SSL switch; fetch injectable for tests
- [x] T046 [US2] Implement `src/main/api-client/script-sandbox/pm-api-shim.ts`: the JS source injected into each QuickJS context defining `pm`, `postman`, `tests`, `responseBody`, `responseCode`, `console`, `atob`/`btoa`, `crypto.randomUUID`, `require('chai')`, and `NotSupportedError` stubs exactly as listed in contracts/script-sandbox-api.md, using `CHAI_BUNDLE_SOURCE` (T002) for `pm.expect`
- [x] T047 [US2] Implement `src/main/api-client/script-sandbox/script-sandbox-worker-entry.ts`: worker-thread entry that creates a fresh QuickJS context per script with a 32 MB memory limit and a 5 s interrupt-based timeout, injects T046 plus serialized inputs (request, response, variable scopes, info), and returns `{ tests, logs, variableWrites, requestMutations, error? }`
- [x] T048 [US2] Implement `src/main/api-client/script-sandbox/script-sandbox-client.ts` using `LazyWorkerThreadHost` (`src/main/lazy-worker-thread-host.ts`, see `src/main/usage/usage-scan-worker-client.ts` for usage) and add the worker entry to the main build config next to the existing worker entries; make sure the QuickJS `.wasm` asset ships in packaged builds (add it to electron-builder `asarUnpack`/`files`, or load the wasm variant that embeds it as a module)
- [x] T049 [US2] Implement `src/main/api-client/request-execution.ts`: run prerequest scripts in Postman order → apply mutations → resolve variables (T043) → resolve effective auth via `getAncestorChain` (T008: request → inner → outer folder → collection; `inherit`/absent continues, `noauth` stops) → check auth support (`unsupported-auth`) → send (T045) → run test scripts → commit variable writes to the stored environment/collection → build `LatestResult` (every text field passed through `maskSecrets` from T043a before it is saved or added to the console) → persist via the store → append `ConsoleEntry` (T044); takes `origin` and an optional unsaved `draft`
- [x] T050 [US2] Extend `src/main/ipc/api-client/api-client-ipc.ts` with `apiClient:send` (`{ worktreeId, requestId, draft? }` → `{ executionId }`), `apiClient:cancel`, `apiClient:getLatestResult`, `apiClient:getConsole`, `apiClient:clearConsole`, `apiClient:saveRequest` (`baseRevision` → `conflict`), and events `apiClient:executionFinished`, `apiClient:consoleAppended`; expose all in `src/preload/api/api-client-bridge.ts`
- [x] T051 [US2] Extend `src/renderer/src/store/slices/api-client.ts` with in-flight executions per tab, latest results per request (loaded on view, updated on `executionFinished`), console entries per worktree (initial `getConsole` + `consoleAppended`), request drafts, and the save/discard guard used when switching or closing (FR-003a)
- [x] T051a [P] [US2] Slice tests in `src/renderer/src/store/slices/api-client.test.ts` with two API Client tabs on the same worktree and a fake `window.api.apiClient` (FR-003, edge case "several tabs"): `apiClient:changed` for a request updates the tab showing it with no draft; a tab with a draft keeps it and sets `changedElsewhere`; saving that draft returns `conflict` and Reload replaces the draft; `setActiveEnvironment` from one tab updates both tabs' selector; `executionFinished` from a send in tab A updates the latest result shown in tab B for the same request (FR-003b); a change event for another worktree is ignored (FR-030)
- [x] T052 [P] [US2] Implement `src/renderer/src/components/api-client/request-editor/KeyValueTable.tsx` (semantic `<table>` with enabled checkbox, key, value, description, add/delete rows, unresolved-variable highlighting from T043, secret masking) used by params and headers
- [x] T053 [P] [US2] Implement `src/renderer/src/components/api-client/request-editor/UrlBar.tsx`: method `Select` (standard verbs + custom), URL input with unresolved `{{var}}` highlighting (FR-013), Send / Cancel button bound to the execution state
- [x] T054 [US2] Implement `ParamsTable.tsx` and `HeadersTable.tsx` in `src/renderer/src/components/api-client/request-editor/` on T052 (depends on T052), keeping `url.raw` and `query` in sync both ways
- [x] T055 [US2] Implement `src/renderer/src/components/api-client/request-editor/BodyEditor.tsx`: mode selector (none/raw/urlencoded/formdata; file/graphql shown read-only with a "sent as raw" note), Monaco for raw with language selector, T052 for urlencoded/formdata (depends on T052)
- [x] T056 [P] [US2] Implement `src/renderer/src/components/api-client/request-editor/AuthEditor.tsx` for `inherit`, `noauth`, `bearer`, `basic`, `apikey`; other types shown as "not supported, preserved for export"
- [x] T057 [P] [US2] Implement `src/renderer/src/components/api-client/request-editor/ScriptsEditor.tsx`: Monaco JS editors for pre-request and test scripts (join/split `exec` on `\n`)
- [x] T058 [P] [US2] Implement `src/renderer/src/components/api-client/request-editor/RequestSettings.tsx`: per-request SSL verification (inherit/on/off), follow redirects, timeout. Add the app-wide `apiClientSslVerification` setting (default `true`) to `GlobalSettings` in `src/shared/global-settings-types.ts` and the defaults in `src/shared/constants.ts`, with its `Switch` in the Settings page
- [x] T059 [US2] Implement `src/renderer/src/components/api-client/request-editor/RequestEditor.tsx`: `Tabs` for Params/Headers/Body/Auth/Scripts/Settings, draft handling, Save button and Cmd/Ctrl+S (platform check), the "changed in another tab" notice while a draft exists (from `changedElsewhere`) and, on `conflict`, a `Dialog` offering Reload (discard draft) or Cancel, and the unsaved-changes `Dialog` on request switch or tab close
- [x] T060 [P] [US2] Implement `src/renderer/src/components/api-client/EnvironmentSelector.tsx` (`Select` with "No environment"), calling `apiClient:setActiveEnvironment` (FR-010), placed in the pane header
- [x] T061 [P] [US2] Implement the response viewer in `src/renderer/src/components/api-client/response-viewer/`: `ResponseSummary.tsx` (status + text, time, size, origin), `ResponseBody.tsx` (Pretty/Raw `Tabs` toggle always available; Pretty is the default for JSON ≤ 2 MB, Raw otherwise; binary/truncated notice), `ResponseHeaders.tsx`, `TestResultsList.tsx` (name, pass/fail, failure message), and the readable error state including the certificate hint (acceptance 2.5)
- [x] T062 [P] [US2] Implement the console in `src/renderer/src/components/api-client/console/`: `ApiConsolePanel.tsx` (virtualized list newest at bottom, collapse whole console, clear, resizable via the existing resize-handle pattern from `components/activity/activity-thread-list-resize-handle.tsx`) and `ConsoleEntryRow.tsx` (`Collapsible`: method, resolved URL, status, time, origin badge; expanded: request headers/body, response headers/body, script logs) with secrets masked
- [x] T063 [US2] Compose `ApiClientPane.tsx`: header (request name, EnvironmentSelector), request editor / response viewer split with persisted `splitRatio`, console with persisted `consoleCollapsed`/`consoleHeight` that gives freed space back when collapsed (acceptance 2.4); show the request's latest result whenever it is displayed (FR-003b); add strings to `en.json`
- [x] T064 [P] [US2] Component tests `src/renderer/src/components/api-client/console/ApiConsolePanel.test.tsx` (entry expand/collapse, whole-console collapse, clear) and `src/renderer/src/components/api-client/request-editor/UrlBar.test.tsx` (unresolved variable highlight)

**Checkpoint**: US1 + US2 together deliver the core API client.

---

## Phase 5: User Story 5 - Data lives with the worktree, not the repository (Priority: P1)

**Goal**: Data survives restarts and branch switches, is isolated per worktree, and is deleted with the worktree (including orphans).

**Independent Test**: Import data, confirm `git status` is clean, restart Orca and see the same data/active env/latest results, then delete the worktree through Orca and confirm `<userData>/api-client/<hash>/` is gone.

### Tests for User Story 5

- [x] T065 [P] [US5] Unit tests in `src/main/api-client/api-client-data-deletion.test.ts` and `src/main/api-client/api-client-data-gc.test.ts`: delete renames into `.pending-delete/` synchronously and removes asynchronously with retries; a recreated worktree with the same hash starts empty; startup drains `.pending-delete/`; GC tombstones dirs whose `meta.worktreeId` is not live and older than 5 minutes, and keeps young or live ones
- [x] T066 [P] [US5] Extend an existing removal test (`src/main/runtime/orca-runtime-tests/worktree-removal-and-reconciliation.spec.ts` and the worktree removal IPC tests using `src/main/ipc/worktrees-test-harness.ts`) to assert `deleteWorktreeApiClientData` is called for git worktrees and folder workspaces

### Implementation for User Story 5

- [x] T067 [US5] Implement `src/main/api-client/api-client-data-deletion.ts` mirroring `src/main/terminal-history-deletion.ts`: `deleteWorktreeApiClientData(worktreeId)` (evict the store cache, rename to `.pending-delete/<hash>.<ts>.<rand>`, async remove with retries) and `drainApiClientPendingDeletes()`
- [x] T068 [US5] Call `deleteWorktreeApiClientData(worktreeId)` next to both `deleteWorktreeHistoryDir(worktreeId)` call sites: `removeWorktreeMetadataAndTransientState` in `src/main/ipc/worktrees/removal/worktree-removal-ownership.ts` and `src/main/runtime/orca-runtime-resolve-worktree-removal-target.ts`
- [x] T069 [US5] Implement `src/main/api-client/api-client-data-gc.ts` mirroring `src/main/terminal-history-gc.ts` (live worktree + folder-workspace snapshot, 5-minute age guard) and schedule drain + GC where terminal history GC is scheduled in `src/main/window/attach-main-window-services.ts`
- [x] T070 [US5] Persist API Client tab view (`requestId`/`environmentId`/runner scope) and layout with the tab session so restart restores the open request and its latest result; on restore, a view pointing at a deleted node falls back to `{ kind: 'empty' }` (`src/renderer/src/store/slices/api-client.ts` + session serialization used for simulator tabs)

**Checkpoint**: All P1 stories complete — MVP ready (US1 + US2 + US5).

---

## Phase 6: User Story 3 - Edit environments (Priority: P2)

**Goal**: Full environment editing with a scrolling variable table, masking, and unsaved-change prompts.

**Independent Test**: Open the 27-variable environment, scroll to the last variable (header and Save stay visible), change it, save, send a request using it, and confirm the new value; closing with unsaved edits prompts.

### Tests for User Story 3

- [x] T071 [P] [US3] Component tests `src/renderer/src/components/api-client/environment-editor/EnvironmentEditor.test.tsx`: table is the scroll container with a sticky header and visible Save, secret masked until revealed, `needsReentry` notice, unsaved-changes prompt on close
- [x] T072 [P] [US3] Unit tests in `src/main/api-client/api-client-store.test.ts` for `envOp` (create/rename/duplicate/delete) and `saveEnvironment` (secrets encrypted, `conflict` on stale revision, deleting the active environment clears `activeEnvironmentId`, saving with untouched `unchanged: true` secrets keeps their cipher text byte-for-byte, changing one secret re-encrypts only that one)

### Implementation for User Story 3

- [x] T073 [US3] Add `envOp` and `saveEnvironment` to `src/main/api-client/api-client-store.ts` (encrypt secrets via T015 before writing; duplicate copies secrets re-encrypted) and the `apiClient:envOp` / `apiClient:saveEnvironment` handlers plus `revealSecrets: true` on `apiClient:getSnapshot` in `src/main/ipc/api-client/api-client-ipc.ts`; expose in preload
- [x] T074 [P] [US3] Implement `src/renderer/src/components/api-client/environment-editor/VariablesTable.tsx`: semantic `<table>` in a `ScrollArea` with a sticky header, columns enabled `Checkbox` / name / value / type (`Select` default|secret), per-row reveal for secrets, add/delete rows, "re-enter value" notice for `needsReentry` (FR-009b); each row tracks whether its secret was revealed or edited, and unrevealed rows are sent as `unchanged: true`
- [x] T075 [US3] Implement `src/renderer/src/components/api-client/environment-editor/EnvironmentEditor.tsx`: sticky header with name and Save (Cmd/Ctrl+S), draft state, a protection notice driven by `secretProtection`, unsaved-changes `Dialog` on close or view switch (acceptance 3.3); render it from `ApiClientPane.tsx` for `{ kind: 'environment' }`
- [x] T076 [US3] Add environment actions to `src/renderer/src/components/api-client/sidebar/EnvironmentList.tsx`: open in editor, New, Rename, Duplicate, Delete (confirm `Dialog`), Set active; add strings to `en.json`

**Checkpoint**: Environments are fully editable in-app.

---

## Phase 7: User Story 4 - Run a folder or whole collection (Priority: P2)

**Goal**: Runner view with include/exclude, options, live progress, stop, summary, filters, and persisted latest run per scope.

**Independent Test**: Run the `MAIN` folder against the echo server: requests run once in depth-first order, the token set by an early test is used later, totals equal per-request sums, Stop halts further requests.

### Tests for User Story 4

- [x] T077 [P] [US4] Unit tests in `src/main/api-client/collection-runner.test.ts` with T005: depth-first order, excluded requests skipped, iterations and delay honored, stop keeps finished results and starts no new request, stop-on-failure ends with `completed` (stopped early), variable set by an earlier test reaches a later request and is persisted, edits during a run do not affect it, a second run on the same scope returns `busy`, missing environment → `failed-to-start`, totals match results, iteration 1 details still available after iteration 2 runs, the run file stays under the size cap

### Implementation for User Story 4

- [x] T078 [US4] Implement `src/main/api-client/collection-runner.ts`: snapshot included requests at start, run sequentially through `request-execution.ts` with `origin: 'run'` (or `'agent'`), in-run working copy of environment + collection variables committed after each request, `iterations: 1–1000`, `delayMs: 0–60000`, `stopOnFailure`, stop via `AbortController`, progress callback per `RunRequestResult` (each with a `detail` built through `maskSecrets`, enforcing the 256 KB preview and 50 MB per-run caps from data-model.md), derived `totals`, state transitions from data-model.md
- [x] T079 [US4] Persist the latest `Run` to `runs/<scopeId>.json` (`scopeId = folderId ?? collectionId`) in `src/main/api-client/api-client-store.ts`, plus `clearRun`
- [x] T080 [US4] Add `apiClient:startRun`, `apiClient:stopRun`, `apiClient:getLatestRun`, `apiClient:clearRun` and events `apiClient:runProgress`, `apiClient:runFinished` to `src/main/ipc/api-client/api-client-ipc.ts` and preload
- [x] T081 [US4] Extend `src/renderer/src/store/slices/api-client.ts` with runner state per scope (setup selections, live results, totals, filter)
- [x] T082 [P] [US4] Implement `src/renderer/src/components/api-client/runner/RunnerSetup.tsx`: ordered request list with include `Checkbox` (all selected by default), environment `Select`, iterations, delay, stop-on-failure, Run button
- [x] T083 [P] [US4] Implement `src/renderer/src/components/api-client/runner/RunnerResults.tsx`: virtualized live results (status, time, per-test pass/fail), filter All/Passed/Failed, Stop button, clicking a result opens its `detail` from the run (works after restart and for every iteration); `detail: null` shows the "details not kept" notice
- [x] T084 [P] [US4] Implement `src/renderer/src/components/api-client/runner/RunSummary.tsx`: total requests, tests passed, tests failed, total duration, failed tests with messages, "Stopped at first failure" when `stoppedEarly`, Clear (calls `apiClient:clearRun`)
- [x] T085 [US4] Add "Run" to the collection/folder menu in `CollectionTree.tsx`, set the tab view to `{ kind: 'runner', scope }`, render the runner (setup, then results + summary; shows the last stored run on open) from `ApiClientPane.tsx`; add strings to `en.json`

**Checkpoint**: Folder/collection runs work end to end.

---

## Phase 8: User Story 7 - Agent and CLI access (FR-032 – FR-037)

**Goal**: `orca api list|envs|run|result|show` — read and run only, secrets never returned.

**Independent Test**: From a terminal in the worktree: `orca api list --json` returns the tree with ids; `orca api run <folderId> --json` returns structured results with `••••` secrets, console entries are marked agent, exit code 1 when a test fails; `orca api show <requestId>` opens the tab showing the request and its result.

### Tests for User Story 7

- [x] T086 [P] [US7] Unit tests for the RPC methods next to `src/main/runtime/rpc/methods/api-client.ts` (`api-client.test.ts`): no secret value in any result (a run against `/echo` with a secret token returns no copy of the token anywhere in the JSON), no mutation methods exist, run results update LatestResult with `origin: 'agent'`, non-local worktree rejected, `--timeout` stops the run and returns partial results, `show` on a non-active worktree leaves the visible worktree unchanged
- [x] T087 [P] [US7] Unit tests in `src/cli/handlers/api-client.test.ts`: human table and `--json` output, exit codes (0 all passed, 1 otherwise), 64 KB body truncation unless `--full-body`, unknown-method error mapped to "This Orca version does not support the API Client"

### Implementation for User Story 7

- [x] T088 [P] [US7] Define RPC param schemas in `src/shared/rpc-contract/api-client-params.ts`: `apiClient.list { worktree? }`, `apiClient.environments { worktree? }`, `apiClient.run { worktree?, targetId, environment?: string | null, iterations?, delayMs?, stopOnFailure?, timeoutMs? }` (default timeout 10 min), `apiClient.result { worktree?, requestId }`, `apiClient.show { worktree?, requestId }`; regenerate the catalog so `pnpm verify:rpc-params-catalog` passes
- [x] T089 [US7] Implement `src/main/runtime/rpc/methods/api-client.ts` (list, environments, run, result, show) on the store/runner/request-execution with `origin: 'agent'`, all results passed through `maskSecrets` (T043a), and register it in `src/main/runtime/rpc/methods/index.ts`; do not add the methods to the mobile RPC allowlist
- [x] T090 [US7] Implement `apiClient.show`: main sends `apiClient:show { worktreeId, requestId }` to the renderer; handle it in `src/renderer/src/hooks/ipc-events/content-creation-ipc-bridge.ts` (as `emulator.onPaneFocus` does) by creating or updating the API Client tab in the target worktree's tab set via `ensure-api-client-tab.ts` without activating that worktree (never switch the visible worktree, no `focus()`/`show()`), selecting the request in the tree, showing its latest result, and acknowledging with `{ tabId }`
- [x] T091 [US7] Add CLI specs in `src/cli/specs/api-client.ts` (register in `src/cli/specs/index.ts`) and handlers/formatting in `src/cli/handlers/api-client.ts` for `orca api list`, `orca api envs`, `orca api run <id> [--env <id|name|none>] [--iterations n] [--delay ms] [--stop-on-failure] [--timeout ms] [--full-body]`, `orca api result <requestId>`, `orca api show <requestId>`, all with `--worktree` and `--json`, mirroring `src/cli/specs/emulator.ts` / `src/cli/handlers/emulator.ts`
- [x] T092 [US7] Add a bundled skill guide `skill-guides/orca-api-client.md` describing the commands, ids, masking, and exit codes; link it from `skill-guides/orca-cli.md` and update the bundled guide table so `pnpm verify:bundled-skill-guides` passes

**Checkpoint**: Agents can list, run, read results, and show requests.

---

## Phase 9: User Story 6 - Export back to Postman (Priority: P3)

**Goal**: Export a collection or environment to a Postman-compatible file.

**Independent Test**: Import the smoke collection, export unchanged, and confirm the export deep-equals the original modulo key order (SC-007); re-import into Orca works; environment export warns about plain secrets.

### Tests for User Story 6

- [x] T093 [P] [US6] Unit tests in `src/shared/api-client/postman-export.test.ts`: unmodified smoke collection and environment round-trip with the same folders, requests, headers, bodies, scripts, variables, and `postmanExtra` fields; an edited request appears in the export; v2.0 imports export as v2.1; every exported collection validates against the official Postman Collection v2.1 JSON schema (`src/shared/api-client/__fixtures__/postman-collection-v2.1.schema.json`) using `ajv` (SC-007)

### Implementation for User Story 6

- [x] T094 [US6] Implement `src/shared/api-client/postman-export.ts`: internal model → Postman v2.1 collection (re-emitting `postmanExtra`, `request.settings` → `protocolProfileBehavior`, ids as `_postman_id`/`id`) and environment export (secret values written as plain values)
- [x] T095 [US6] Add `apiClient:export` (`{ worktreeId, kind, id, filePath }`) to `src/main/ipc/api-client/api-client-ipc.ts` (decrypts secrets in main only for the file write) and preload; file path chosen via the existing save-file dialog bridge
- [x] T096 [US6] Add "Export" to the collection menu in `CollectionTree.tsx` and environment menu in `EnvironmentList.tsx`, with a warning `Dialog` before exporting an environment containing secrets; add strings to `en.json`

**Checkpoint**: All user stories complete.

---

## Phase 10: Polish & Cross-Cutting Concerns

- [x] T097 [P] Add translations for every new `apiClient.*` key in `src/renderer/src/i18n/locales/{es,fr,ja,ko,zh}.json` as the localization scripts require, then run `pnpm verify:localization-catalog`, `verify:localization-extraction`, `verify:localization-coverage`, and `verify:localization-runtime-catalog`
- [x] T098 [P] Playwright e2e in `tests/e2e/api-client/` (run with `ORCA_BACKGROUND_LAUNCH=1`, CDP screenshots, no window focus) covering quickstart scenarios 1–3, 6–9, 11, 13, 18: '+' entry, import, send against a `node:http` server, env edit, run MAIN, clean `git status`, restart restore, CLI run/show, delete-worktree cleanup, two-tab sync and branch switch (run the switch as a `git` command in the worktree, not through the UI) _(done: scenarios 2, 3, 7, 8, 9, 18 and the 5 MB / 120-request budget in `api-client-import-send-run-restore.spec.ts`; 1, 11 and 13 are covered by unit tests only)_
- [x] T099 Performance check for SC-006: load a 5 MB JSON response and a 100+ request run; confirm smooth scroll/typing in the response viewer, console, and runner results (adjust virtualization/pretty-print thresholds if needed)
- [x] T100 Run `pnpm tc`, `oxlint`, `pnpm run check:code-quality:changed`, and `pnpm format`; split any file over the `max-lines` limit into focused components instead of disabling the rule
- [x] T101 Run every check in `specs/001-postman-clone-tab/quickstart.md` (automated block + manual table rows 1–18), plus one script execution (`pm.test`) in a packaged build to confirm the QuickJS wasm ships (T048), and record results _(done: all 5 automated checks green — `pnpm tc` 0 errors; api-client suites 24 files/194 tests; `check:code-quality:changed`, `oxlint`, format clean; e2e `--project=electron-headless` 3 passed (import/send/run+restart-restore, two-tab sync+branch switch, 5 MB/120-request budget). Packaged proof: `dist/mac-arm64/Orca.app` (electron-builder `--dir`, after installing the mobile workspace's own deps so `build:mobile-web` could satisfy the pack guard) launched isolated via CDP — imported fixtures, sent `proof-r1`, both `pm.test` assertions passed and the secret stayed masked (`PROOF-OK`), confirming T048. Manual rows: 2, 3, 7, 8, 9, 14, 18 via e2e; 1, 4, 6, 10, 12, 13, 17 via unit tests only; 5 (self-signed TLS), 11 (live CLI from a terminal), 15 and 16 (real Postman app) not run. Pre-existing failures elsewhere, unrelated to this feature: `verify:localization-catalog`/`extraction` on other features' keys, `secure-dns-census.test.ts` timeout, `typecheck:e2e` errors in other spec files.)_

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: none.
- **Foundational (Phase 2)**: needs Setup (T001 for types/tooling). Blocks every story.
- **US1 (Phase 3)**: needs Foundational.
- **US2 (Phase 4)**: needs Foundational; practically needs US1 data (import or create via T033) to have a request to send. T046–T047 need T002.
- **US5 (Phase 5)**: needs Foundational (store). Independent of US1/US2 code, but its independent test uses US1 import.
- **US3 (Phase 6)**: needs Foundational; its independent test sends a request (US2).
- **US4 (Phase 7)**: needs US2 (`request-execution.ts`).
- **US7 (Phase 8)**: needs US2 (single request) and US4 (folder/collection runs) for `apiClient.run`; `list`/`envs`/`result`/`show` only need Foundational + US2.
- **US6 (Phase 9)**: needs US1 (import model); otherwise independent.
- **Polish (Phase 10)**: after the desired stories.

### Story completion order

```text
Setup → Foundational → US1 → US2 → US5   (MVP)
                               ├→ US3
                               ├→ US4 → US7
                        US1 ───┴→ US6
```

### Within each story

- Tests first (should fail), then shared/pure logic → main store/execution → IPC + preload → renderer slice → components → pane wiring.
- `api-client-store.ts`, `api-client-ipc.ts`, `api-client-bridge.ts`, `store/slices/api-client.ts`, `ApiClientPane.tsx`, `CollectionTree.tsx`, and `en.json` are edited by several stories: tasks touching the same file run sequentially.

---

## Parallel Examples

### Phase 1 / 2

```text
T002 chai bundle script | T003 collection fixture | T004 env fixtures | T004a schema fixture | T005 echo server
T006 types | T008 collection-tree | T013 en.json namespace | T014 storage paths | T015 secret codec | T019 local guard
```

### User Story 1

```text
T027 postman-import tests | T028 import store tests | T029 postman-schema
then: T034 CollectionTree | T035 EnvironmentList | T036 ImportDialog | T038 tree component test
```

### User Story 2

```text
T039 | T039a | T040 | T041 | T042 | T051a (tests)
T043 variable-resolution | T043a secret-masking | T044 console buffer | T045 http sender
T052 KeyValueTable | T053 UrlBar | T056 AuthEditor | T057 ScriptsEditor | T058 RequestSettings | T060 EnvironmentSelector | T061 response viewer | T062 console
then (after T052): T054 Params/Headers | T055 BodyEditor
```

### User Story 4

```text
T082 RunnerSetup | T083 RunnerResults | T084 RunSummary
```

### User Story 7

```text
T086 RPC tests | T087 CLI tests | T088 RPC params
```

---

## Implementation Strategy

### MVP first (P1: US1 + US2 + US5)

1. Phase 1 Setup → Phase 2 Foundational.
2. US1: import and browse → **validate** with the fixtures.
3. US2: send, inspect, console → **validate** against the echo server.
4. US5: deletion/GC/restart → **validate** `git status` clean, restart, delete worktree.
5. Stop and demo: this is the usable MVP.

### Incremental delivery

6. US3 environments → 7. US4 runner → 8. US7 agent/CLI (unblocks the future smoke-test workflow) → 9. US6 export → 10. Polish.

### Notes

- [P] = different files, no dependency on an incomplete task.
- Never commit unless the user asks; leave changes in the working tree.
- Stop at any checkpoint to validate a story on its own.

---

## Phase 11: Convergence

- [x] T102 Keep every open API Client tab's latest result current for all origins: push the saved `LatestResult` to the renderer after runner and agent executions too (e.g. emit `executionFinished` from `executeRequest`'s callers in `src/main/api-client/collection-runner.ts` and `src/main/runtime/rpc/methods/api-client.ts`, or add the result to `consoleAppended`) and update `apiClientResultsByWorktree` in `src/renderer/src/store/slices/api-client-execution.ts`; make the `apiClient:show` handler in `src/renderer/src/hooks/ipc-events/api-client-ipc-bridge.ts` reload the result even when the tab already shows that request; add slice tests for a run-origin and an agent-origin result reaching a tab that is already displaying the request per FR-003b, FR-037, US7/AC3 _(done: push `executionFinished` for runner/agent runs via `RequestExecutionDeps.onExecuted`; `apiClient:show` reloads the result; slice tests added)_
- [x] T103 Snapshot the run scope's collection (request plus ancestor folders' scripts, variables, and auth) at run start in `src/main/api-client/collection-runner.ts` and execute against that snapshot instead of re-locating the request in the live collection (`locate` in `src/main/api-client/request-execution.ts`), so a request deleted, moved, or whose folder is edited mid-run still runs as it was and does not end the run early; extend `src/main/api-client/collection-runner.test.ts` with delete-mid-run and folder-script-edit-mid-run cases per edge case "edited while a run is in progress" _(done: runner snapshots collection/folder settings per request (`scope`), collection variables stay live; delete-mid-run and folder-script-edit tests added)_
- [x] T104 Mark unresolved `{{variable}}` references in the raw body editor (`src/renderer/src/components/api-client/request-editor/BodyEditor.tsx`, e.g. Monaco decorations or an "Unresolved: …" line using `findUnresolvedVariables`) and in auth fields (`src/renderer/src/components/api-client/request-editor/AuthEditor.tsx`), with a component test per FR-013, US2/AC2 _(done: `UnresolvedVariablesNotice` in raw body and auth fields, with component test)_
- [x] T105 Add Playwright e2e coverage in `tests/e2e/api-client/` (with `ORCA_BACKGROUND_LAUNCH=1`, CDP screenshots, no focus) for quickstart scenarios 1 ('+' entry above agents; disabled with "Local worktrees only" on an SSH worktree), 11 (`orca api list --json`, `orca api run <folderId> --json` with masked secrets and exit code 1 on a failing test, `orca api show <requestId>` without switching worktrees), and 13 (delete worktree through Orca removes `<userData>/api-client/<hash>/`) per T098 _(done: `api-client-entry-cli-cleanup.spec.ts` covers rows 1, 11, 13; passes with the rest of `tests/e2e/api-client/` (6 passed))_
- [x] T106 Add an e2e scenario against a local self-signed HTTPS server (test-only, next to `src/main/api-client/test-support/local-echo-server.ts`): the send fails with the certificate message pointing to the SSL switch, then succeeds after turning verification off app-wide and, separately, per request; record the result in T101's notes per FR-017a, US2/AC5, quickstart row 5 _(done: `api-client-self-signed-tls.spec.ts` against `test-support/local-self-signed-https-server.ts`; refused, then OK per request and app-wide)_
- [x] T107 Make the unsaved-changes dialog copy match the draft type in `src/renderer/src/components/api-client/ApiClientUnsavedDialog.tsx` (environment vs request), adding the new `apiClient.unsaved.*` keys to `en.json` and the other locales per US3/AC3 _(done: dialog copy follows the draft kind; `apiClient.unsaved.bodyEnvironment` added to all locales)_
- [ ] T108 Manually verify quickstart rows 15 and 16 with the Postman app (MAIN run pass/fail parity; exported collection re-imports with the same requests, scripts, and variables) and record the outcome in T101's notes per SC-003, SC-007 (partial)

---

## Phase 12: Convergence

- [x] T109 Make the "enforces the memory limit" case in `src/main/api-client/script-sandbox/pm-api-shim.test.ts` reach `MemoryError` quickly and deterministically (allocate in larger chunks so the limit trips well before the 5 s script timeout, and assert the error arrives in under ~1 s); it currently takes ~4.9 s against vitest's 5 s default and timed out when run alongside the other api-client suites per T040 (partial)

---

## Phase 13: Convergence

- [ ] T110 Make `apiClient.show` actually display the request when the reusable API Client tab holds an unsaved draft: today `ensureApiClientTab` (`src/renderer/src/lib/ensure-api-client-tab.ts`) calls `requestApiClientTabView`, which only queues a save/discard prompt (`src/renderer/src/store/slices/api-client-drafts.ts`), yet the bridge in `src/renderer/src/hooks/ipc-events/api-client-ipc-bridge.ts` acknowledges success; instead reuse a draft-free API Client tab or open a new one for the show (keeping the user's draft untouched), and add a slice/bridge test where the existing tab has a draft per FR-037, US7/AC5 (partial)
