---
description: 'Task list for the SQL Tab (PostgreSQL query client) feature'
---

# Tasks: SQL Tab (PostgreSQL query client)

**Input**: Design documents from `specs/002-sql-query-tab/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/ (ipc-renderer-main, cli-rpc, storage-format), quickstart.md

**Tests**: Included. research.md R17 and quickstart.md "Automated checks" require Vitest unit suites (splitter, default limit, transaction control, locality, TSV, project key, storage/tombstone/GC, secret sealing), Vitest integration against a real PostgreSQL (`ORCA_TEST_PG_URL`, tagged `sql-integration`, skipped when unset), renderer component tests, and Playwright e2e for the P1 flows. Tests sit next to their sources (`*.test.ts[x]`); e2e under `tests/e2e/sql-client/`.

**Organization**: Tasks are grouped by user story. Phases follow spec priority: US1, US2, US5 (P1) → US3, US4 (P2) → US6 (P3).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: US1–US6 (spec.md)

## Rules that apply to every task (from AGENTS.md / plan.md)

- UI: only `src/renderer/src/components/ui/` primitives and tokens from `src/renderer/src/assets/main.css`; no raw palette colors, no computed `className` strings (`docs/STYLEGUIDE.md`). Status dots use the semantic success/warning/destructive/muted tokens.
- All user-visible strings via `translate()` with keys under the `sqlClient.*` namespace in `src/renderer/src/i18n/locales/en.json` (other locales per the localization verifiers).
- No `max-lines` disables — split files instead. No vague file names (`utils`, `helpers`). No type assertions except `as const`; parse with zod.
- Shortcuts: Monaco `KeyMod.CtrlCmd`; DOM handlers use the platform check (`metaKey` on Mac, `ctrlKey` elsewhere). Paths use `path.join`.
- Every main-process SQL entry point (IPC and RPC) rejects non-local worktrees with code `not-local` (FR-002). The renderer sends `worktreeId`, never a project key.
- No password or cipher in any IPC response, event, RPC result, or log (FR-008).
- Comments: brief, non-obvious only.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: New dependencies and PostgreSQL test infrastructure.

- [x] T001 Add `pg` and `pg-cursor` as runtime dependencies and `@types/pg`, `@types/pg-cursor` as dev dependencies in `package.json` (`pnpm add pg pg-cursor && pnpm add -D @types/pg @types/pg-cursor`), updating `pnpm-lock.yaml`; do NOT add `pg-native`; confirm `pnpm tc` passes and that the main-process bundle config (electron-vite / electron-builder externals) packages `pg` without trying to resolve the optional `pg-native` import
- [x] T002 [P] Create seed fixture `src/main/sql-client/test-support/seed.sql`: schema `"CaseManagement"` with table `"SurgicalCase"` (uuid PK, text, `numeric(30,10)`, jsonb, timestamptz, `int[]`, bytea, interval, and nullable columns, including a row whose text column is the literal `'NULL'`), a view over it, a materialized view, and a table `wide_rows` with 40 columns and 5 000 rows (generated with `generate_series`); put the table `big_text` holding ~60 MB of text across rows (for the 50 MB limit) in a separate `src/main/sql-client/test-support/seed-big-text.sql` so suites that do not test the size limit stay fast
- [x] T003 [P] Create `src/main/sql-client/test-support/pg-test-database.ts`: reads `ORCA_TEST_PG_URL`; exports `describeSqlIntegration` (a `describe.skipIf(!url)` wrapper whose suite names include `sql-integration`), `createScratchDatabase({ withBigText = false })` (creates a uniquely named database, runs `seed.sql` and, only when asked, `seed-big-text.sql`; returns connection fields + `drop()`), and `nonLoopbackHost()` (reads `ORCA_TEST_PG_LAN_HOST`, else the first non-internal IPv4 from `os.networkInterfaces()`) for read-only agent tests
- [x] T004 [P] Add a `postgres:16` service container (password `orca-test-pw`, port 5432) to the PR CI workflow that runs Vitest (find it with `rg -l "pnpm test" .github/workflows`) and export `ORCA_TEST_PG_URL=postgres://postgres:orca-test-pw@localhost:5432/postgres` for that job

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared refactors, shared model, main-owned project store, IPC/preload bridge, the `sql` tab type with its '+' entry, the right-sidebar dispatch, and the empty pane + right side panel shells.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

### Refactors (reuse API Client code instead of copying it)

- [x] T005 Move the local-workspace check from `src/main/api-client/api-client-local-host-guard.ts` into `src/main/workspace-local-host-guard.ts` (`WorkspaceHostGuardStore`, `assertLocalWorkspace(store, worktreeId)`), keep the API Client callers working by importing the new module (delete the old file and update imports found with `rg -l "api-client-local-host-guard" src`), and move/adjust its tests; behavior unchanged
- [x] T006 [P] Move `UNSEALED_CIPHER`, `sealSecretValue`, `openSecretCipher`, and `getSecretProtection` from `src/main/api-client/api-client-secret-codec.ts` into `src/main/secret-value-codec.ts`; `api-client-secret-codec.ts` keeps only its environment-specific functions and imports the moved ones; split `api-client-secret-codec.test.ts` accordingly into `src/main/secret-value-codec.test.ts`; behavior unchanged
- [x] T007 [P] Generalize `src/renderer/src/lib/api-client-availability.ts` into `src/renderer/src/lib/local-workspace-tab-availability.ts` (`LocalWorkspaceTabAvailability = 'available' | 'remote' | 'hidden'`, `getLocalWorkspaceTabAvailability(...)`); update API Client callers (`rg -l "api-client-availability" src/renderer`), move its tests; behavior unchanged

### Shared model and pure logic

- [x] T008 [P] Define the entities from data-model.md in `src/shared/sql-client/sql-client-types.ts`: `SqlSslMode = 'disable' | 'prefer' | 'require'`, `SealedSecret = { cipher: string }`, `SqlConnection` (with `password: SealedSecret | null`, `revision`), `SqlConnectionView` (no `password`; adds `passwordState: 'set' | 'empty' | 'needs-reentry' | 'session-only'`, `agentAccess: 'full' | 'read-only'`, `status`), `SqlConnectionStatus` (`{ state: 'idle' | 'connecting' | 'connected' } | { state: 'error', message, code? }`), `SqlQueryCollection`, `SqlSavedQuery`, `ProjectSqlData`, `SqlPersistedTab`, `SqlColumn`, `SqlRunResult` (`rows` / `command` / `error` / `cancelled` / `timed-out` exactly as in data-model.md), `SqlRunError` (`category: 'syntax' | 'connection' | 'auth' | 'ssl' | 'read-only' | 'not-local' | 'other'`, `position` is a 1-based offset into the whole run text), `SqlSchema`, `SqlRelation` (`kind: 'table' | 'view' | 'materialized-view' | 'partitioned-table' | 'foreign-table'`), `SqlColumnInfo`
- [x] T009 Create zod schemas for the storage files in `src/shared/sql-client/sql-client-schemas.ts` per contracts/storage-format.md (`schemaVersion: 1` on every file; `meta.json` `{ schemaVersion, projectKey, createdAt }`; `connections.json`; `queries.json` with `collections` + `queries`). Enforce verbatim: connection `name` "1–100 chars, trimmed; unique within the project (case-insensitive)", `host` "1–255 chars; hostname, IPv4/IPv6 literal, or absolute socket dir path", `port` "integer 1–65535, default 5432", `user` "1–63 chars", `database` "1–63 chars", `sslMode` "default `prefer`"; collection `name` "1–100 chars; unique within the connection"; query `name` "1–200 chars", `sql` "1 char – 1 MB", `collectionId` "must belong to the same connection"; `SqlPersistedTab.splitRatio` "0.15–0.85, default 0.5"; uniqueness/cross-reference rules as exported refinement functions used by the store (depends on T008)
- [x] T010 [P] Create zod schemas for every IPC request/response in `src/shared/sql-client/sql-client-ipc-schemas.ts` per contracts/ipc-renderer-main.md, including `SqlClientFailure` (`code: 'not-local' | 'not-found' | 'conflict' | 'invalid' | 'storage' | 'encryption-unavailable'`), the snapshot response (`encryptionAvailable`, optional `protectionGapMessage`), the update rule (`password` omitted keeps the stored one, `''` clears it), and both event payloads (`sqlClient:changed`, `sqlClient:connectionStatus`); add a test asserting no response schema accepts a `password`/`cipher` key (depends on T008)
- [x] T011 [P] Implement `src/shared/sql-client/sql-connection-locality.ts`: `getSqlAgentAccess(host): 'full' | 'read-only'` — `full` iff host is `localhost` (case-insensitive), an IPv4 in `127.0.0.0/8`, `::1` (with or without brackets), or an absolute POSIX path (`path.posix.isAbsolute`; unix-socket hosts are macOS/Linux only, so a Windows drive path is not a socket and is `read-only`); LAN IPs, `0.0.0.0`, and `host.docker.internal` are `read-only`; tests in `src/shared/sql-client/sql-connection-locality.test.ts`
- [x] T012 Add `'sql'` to `TabContentType` and `WorkspaceVisibleTabType` and `sql?: SqlPersistedTab` on the unified tab in `src/shared/tab-types.ts`, and `'sql'` to the persisted enum in `src/shared/workspace-session-tab-type-schema.ts` (with the `SqlPersistedTab` zod schema from T009 for `tab.sql`); extend `src/shared/workspace-session-tab-type-schema.test.ts` (round-trip of a `sql` tab; unknown types still dropped) (depends on T009)
- [x] T013 Extend every `'api-client'` switch branch / exhaustive map with `'sql'` (list them with `rg -l "'api-client'" src -g '!*.test.*'`): `toVisibleTabType`, tab-bar projection, tab icon (lucide `Database`), tab title default ("SQL"), close and bulk-close, tab cycling, drag data, command-palette tab search; fix any exhaustiveness errors from `pnpm tc` (depends on T012)
- [x] T014 Exclude `sql` tabs from the tab snapshots published to paired mobile/web clients, in the same projection that excludes `api-client` (`rg -n "'api-client'" src/main/runtime -g '!*.test.*'`), with a regression test next to it (R3, remote wire compatibility)

### Main-process store

- [x] T015 [P] Implement `src/main/sql-client/sql-project-key.ts`: `resolveSqlProjectKey(store, worktreeId)` → `repo:<repoId>` for git worktree ids (`getRepoIdFromWorktreeId`), `folder-workspace:<id>` for folder workspace keys `folder:<id>`; returns `null` for unknown ids; tests in `src/main/sql-client/sql-project-key.test.ts` (two worktrees of one repo share a key; folder workspace is its own key)
- [x] T016 [P] Implement `src/main/sql-client/sql-client-storage-paths.ts`: `getSqlClientRoot()` = `path.join(app.getPath('userData'), 'sql-client')`, `getProjectSqlDir(projectKey, root?)` using `hashWorktreeId(projectKey)` (16 hex), `getSqlTombstoneDir(root)` = `.tombstones`; mirror `src/main/api-client/api-client-storage-paths.ts`
- [x] T017 Implement `src/main/sql-client/sql-client-store.ts` (`SqlClientStore`): per-project in-memory cache loaded lazily from `meta.json`/`connections.json`/`queries.json` (parsed with T009; a file with `schemaVersion` > 1 is rejected without being overwritten and reported as `storage` with "data written by a newer Orca"); write-through with `writeFileDurable`; `revision` incremented on each write and `baseRevision` mismatch → `conflict`; connection passwords sealed with `sealSecretValue` from `src/main/secret-value-codec.ts` and opened only inside main; when encryption is unavailable keep the password in a memory-only map and persist `password: null` (`passwordState: 'session-only'`); decrypt failure → `needs-reentry`; `toConnectionView()` derives `passwordState` and `agentAccess` (T011); emits `sqlClient:changed` through an injected emitter; new ids from `crypto.randomUUID()`, never changed by updates (FR-034); exposes CRUD for connections, queries, collections including cascade delete of a connection's queries/collections returning counts (depends on T009, T015, T016, T006)
- [x] T018 Unit tests for T017 in `src/main/sql-client/sql-client-store.test.ts` using a temp `userData` and a fake `SecretStore`: create/update/delete round-trip, ids unchanged after update and after reload from disk (FR-034), password kept when update omits it and cleared with `''`, case-insensitive duplicate connection name → `invalid`, stale `baseRevision` → `conflict`, cascade counts, `session-only` and `needs-reentry` states, newer `schemaVersion` not overwritten, and `grep` of the data dir never finds the plaintext test password
- [x] T019 Implement `src/main/ipc/sql-client/sql-client-ipc.ts` with `registerSqlClientHandlers(...)`: data channels from contracts/ipc-renderer-main.md "Data (invoke)" (`getSnapshot`, `createConnection`, `updateConnection`, `deleteConnection`, `saveQuery`, `renameQuery`, `moveQuery`, `deleteQuery`, `createCollection`, `renameCollection`, `deleteCollection`), every handler validating with T010, calling `assertLocalWorkspace` (T005) and `resolveSqlProjectKey` (T015) before touching the store, and returning `{ ok: true, … } | SqlClientFailure`; broadcast `sqlClient:changed` to all windows; register it in `src/main/ipc/register-core-handlers/register-core-handlers.ts` next to `registerApiClientHandlers` (depends on T017)
- [x] T020 [P] Add `src/preload/api/sql-client-api.ts` (and its bridge file, mirroring `api-client-api.ts` / `api-client-bridge.ts`) exposing `window.api.sqlClient` with typed methods for every channel in contracts/ipc-renderer-main.md plus `onChanged`/`onConnectionStatus` subscriptions returning unsubscribe functions; add the type to the preload API surface (depends on T010)

### Renderer foundation

- [x] T021 Create `src/renderer/src/store/slices/sql-client.ts`: per-project snapshots keyed by `projectKey` (fetched by `worktreeId`), debounced refetch on `sqlClient:changed`, live connection status map from `sqlClient:connectionStatus`, per-tab runtime state `SqlTabRuntimeState` (`idle` / `running { runId, startedAt }` / `done { result }`, never persisted); register the slice in the root store (depends on T020)
- [x] T022 Create `src/renderer/src/store/slices/sql-client-tab-persistence.ts` modeled on `api-client-tab-persistence.ts`: read/write `tab.sql` (`draftText`, `connectionId`, `savedQueryId`, `savedQueryRevision`, `splitRatio`), debounced 500 ms while typing; a draft over 1 MB is kept in memory only and flagged so the pane shows a notice (data-model: "≤ 1 MB persisted; larger kept in memory with a notice") (depends on T012)
- [x] T023 [P] Implement `src/renderer/src/lib/ensure-sql-tab.ts` modeled on `ensure-api-client-tab.ts`: always creates a new `sql` tab (multiple allowed, FR-005) with default `tab.sql`, focuses it, and opens the right side panel if it is collapsed (plan "Right right side panel behavior"); tests in `src/renderer/src/lib/ensure-sql-tab.test.ts` (depends on T012, T022)
- [x] T024 Add the `new-sql` kind to `src/renderer/src/components/tab-bar/tab-create-menu-options.ts` right after `new-api-client`, before the agent list, label "New SQL", keywords `sql`, `postgres`, `database`, `query`; availability from T007 (disabled with "local workspaces only" hint on SSH worktrees); wire it to `ensureSqlTab`; extend the menu options test (depends on T007, T023)
- [x] T025 [P] Add `sqlClient:show` `{ worktreeId, connectionId?, savedQueryId? }` handling to `src/renderer/src/hooks/ipc-events/content-creation-ipc-bridge.ts` calling `ensureSqlTab` (loading the query is completed in T063) (depends on T023)
- [x] T026 Create `src/renderer/src/components/right-sidebar/sql-sidebar-selector.ts` (`selectSqlSidebarTarget(state)` → `{ worktreeId, tabId } | null` for the focused `sql` tab) and change `src/renderer/src/components/right-sidebar/right-sidebar-panel-content.tsx` into a dispatch on the focused tab's `contentType`: `api-client` → `ApiClientSidebarPanel` (unchanged), `sql` → lazy `SqlSidebarPanel`, anything else → the routed panel; the persisted `RightSidebarRoute` is never written; add a test covering the three cases and returning to the routed panel (depends on T021)
- [x] T027 Create the tab root `src/renderer/src/components/sql-client/SqlPane.tsx` (toolbar slot, editor slot on top, draggable divider reusing the API Client resize-handle pattern, results slot below; split ratio from `tab.sql.splitRatio` clamped 0.15–0.85; dragging the divider writes the new ratio back to `tab.sql.splitRatio` through T022 so it is kept per tab, FR-004) and register it where tab content is rendered by `contentType` (same place `ApiClientPane` is lazily mounted) (depends on T022)
- [x] T028 Create the panel shell `src/renderer/src/components/sql-client/sidebar/SqlSidebarPanel.tsx` with three `Collapsible` sections (Connections, Schema, Saved Queries) for the target from T026, loading the project snapshot on mount; each section renders an empty placeholder filled by later stories (depends on T026)
- [x] T029 [P] Add the `sqlClient.*` string catalog skeleton (tab title, '+' entry, local-only hint, section titles, empty states) to `src/renderer/src/i18n/locales/en.json` and the other locale files required by `pnpm run verify:localization-catalog`

**Checkpoint**: A SQL tab opens from '+', persists across restart as an empty pane, and the right side panel switches to the empty SQL panel only while it is focused.

---

## Phase 3: User Story 1 - Add a connection and run a query (Priority: P1) 🎯 MVP

**Goal**: Add a PostgreSQL connection, select it, run selected text or the whole editor, and see rows, affected counts, or errors.

**Independent Test**: With a reachable PostgreSQL database, open a SQL tab, add a connection, run `SELECT` on a table, and confirm the grid shows the same columns and rows as `psql` (quickstart scenarios 1–8, 11, 12).

### Tests for User Story 1

- [x] T030 [P] [US1] Unit tests `src/shared/sql-client/sql-statement-splitter.test.ts`: `;` inside single quotes, `E'\''` escapes, double-quoted identifiers, `$$…$$` and `$tag$…$tag$` dollar quoting (including `;` inside), `--` line comments, nested `/* /* */ */` block comments, trailing statement without `;`, empty statements dropped, and correct `startOffset` for each statement
- [x] T031 [P] [US1] Port Terax's `limit.ts` tests into `src/shared/sql-client/sql-default-limit.test.ts` (source: `/Users/franktique/frank/TERMINAL/frank-terax-ai`, find with `rg -l "applyDefaultLimit"`): cap applies only to a single `SELECT`/`WITH` statement without `LIMIT n` / `LIMIT ALL` / `FETCH FIRST`; trailing `;` and comments handled; multi-statement runs are not capped; a `WITH` whose outer statement is `DELETE`/`UPDATE`/`INSERT` is not capped (appending `LIMIT` would be a syntax error)
- [x] T032 [P] [US1] Unit tests `src/shared/sql-client/sql-transaction-control.test.ts`: detects `BEGIN`, `START TRANSACTION`, `COMMIT`, `END`, `ROLLBACK`, `SAVEPOINT`, `RELEASE`, `PREPARE TRANSACTION` (case-insensitive, after comments) and does not match them inside strings or identifiers
- [x] T033 [P] [US1] Integration tests `src/main/sql-client/sql-batch-executor.integration.test.ts` (wrapped in `describeSqlIntegration`): text forms of every `SurgicalCase` column equal `psql -At` output (numeric precision, jsonb as PostgreSQL's text form, timestamptz, `int[]`, bytea hex, interval); 1000-row cap flag; `command` result with affected rows; two-statement batch where statement 2 fails rolls back statement 1 and returns `failedStatementIndex: 1`, `nothingApplied: true`; explicit `BEGIN; …; COMMIT;` honored as written; `INSERT …; COMMIT; <bad statement>` keeps the insert, returns `nothingApplied: false` and `failedStatementIndex: 2` (statements 1–2 already ran); SSL modes against the CI server (SSL off): `prefer` falls back to an unencrypted connection and succeeds, `require` fails with category `ssl`, `disable` succeeds; `big_text` read (scratch database created with `withBigText: true`) stops past 50 MB with `sizeLimitReached: true` and every returned cell complete; cancel of `pg_sleep(60)` returns `cancelled` within 2 s; dropped connection (terminate backend with `pg_terminate_backend`) reconnects once
- [x] T034 [P] [US1] Component tests `src/renderer/src/components/sql-client/sidebar/ConnectionFormDialog.test.tsx`: required fields, port default 5432, SSL default `prefer`, edit shows empty password with "unchanged" placeholder and omits `password` when untouched, protection-gap message shown when `encryptionAvailable` is false, Test connection shows server version or error

### Shared pure logic for User Story 1

- [x] T035 [P] [US1] Implement `src/shared/sql-client/sql-statement-splitter.ts`: `splitSqlStatements(text): { text: string; startOffset: number }[]` per T030
- [x] T036 [P] [US1] Implement `src/shared/sql-client/sql-default-limit.ts` ported from Terax `limit.ts` (same regexes): `applyDefaultLimit(statements, limit = 1000): { statements; rowCapApplied: boolean }` per T031
- [x] T037 [P] [US1] Implement `src/shared/sql-client/sql-transaction-control.ts`: `isTransactionControlStatement(text)` and `containsTransactionControl(statements)` per T032

### Main-process database execution for User Story 1

- [x] T038 [US1] Implement `src/main/sql-client/pg-client-factory.ts`: `createPgClient(connection, password, extra?: { options?: string; applicationName?: string })` returning a `pg.Client` with `application_name: 'Orca SQL'`, host as unix socket dir when absolute, SSL mapping (`disable` → `ssl: false`; `require` → `{ rejectUnauthorized: false }`; `prefer` → try `{ rejectUnauthorized: false }` and fall back to no SSL only when the server does not support SSL, as libpq does), and a `types.getTypeParser` override returning raw text for every oid; map connection errors to `SqlRunError.category` (`auth` for 28P01/28000, `ssl` for "SSL required"/"does not support SSL", `connection` for ECONNREFUSED/ENOTFOUND/ETIMEDOUT/ECONNRESET/57P01)
- [x] T039 [P] [US1] Implement `src/main/sql-client/sql-type-names.ts`: per-connection cache of `oid → format_type(oid, NULL)` filled with one `SELECT oid, format_type(oid, NULL) FROM pg_type WHERE oid = ANY($1)` for unknown oids
- [x] T040 [US1] Implement `src/main/sql-client/sql-batch-executor.ts`: `executeSqlBatch(client, sqlText, { rowCap, sizeLimitBytes = 50 * 1024 * 1024, onBackendPid, readOnly = false })` → `SqlRunResult`: split (T035), apply cap (T036), then: when `readOnly`, every run (one statement or many) is wrapped in `BEGIN READ ONLY` and always ends with `ROLLBACK`, never `COMMIT` (transaction-control text never reaches it; T084 rejects it); otherwise: one statement → run as-is; >1 statements with no transaction control (T037) → `BEGIN`, run each, `ROLLBACK` on first error with `failedStatementIndex`, `failedStatementText`, `nothingApplied: true`, `COMMIT` on success; explicit transaction control → run in order and stop at first error (error says which statements already ran); non-last statements via plain query (row counts kept), last statement via `pg-cursor` in 500-row batches summing `Buffer.byteLength` per cell and stopping past the size limit (`sizeLimitReached: true`, cursor closed); `rows` as `(string | null)[][]`; columns with names from T039; error `position` mapped to the whole-run offset via the statement's `startOffset`; `elapsedMs` measured around the batch (depends on T035–T039)
- [x] T041 [US1] Implement `src/main/sql-client/sql-session-manager.ts` (`SqlSessionManager`): one lazily opened `pg.Client` per (tabId, connectionId); per-connection status (`idle` / `connecting` / `connected` / `error`) derived from its sessions plus an explicit metadata client opened by `connect`, emitted as `sqlClient:connectionStatus`; `run(tabId, connectionId, runId, sql)` with one active run per tab (second run → `invalid` "a query is already running in this tab"); reconnect-once only when the failure happened before the batch's first statement was sent, else error "connection lost"; `cancel(tabId, runId)` opens a short-lived client and runs `SELECT pg_cancel_backend($1)` with the session's `processID` (no-op when the run already finished); `closeTabSession(tabId)`; `disconnect(connectionId)` closes every session and the metadata client; `closeAll()` on app quit; deleting a connection closes its sessions (depends on T038, T040)
- [x] T042 [US1] Add the connection and run channels to `src/main/ipc/sql-client/sql-client-ipc.ts`: `testConnection` (unsaved form values or saved id; returns `serverVersion`), `connect`, `disconnect`, `run`, `cancel`, `closeTabSession`, all behind `assertLocalWorkspace`, with the run password opened from the store in main only; close all sessions on `before-quit` (depends on T019, T041)

### Renderer for User Story 1

- [x] T043 [P] [US1] Implement `src/renderer/src/components/sql-client/sidebar/ConnectionFormDialog.tsx` (`Dialog` + `Input` + `Select`): name, host, port (default 5432), user, password (edit: empty with "unchanged" placeholder; untouched → omitted), database, SSL mode (disable / prefer / require, default prefer), "Test connection", protection-gap message from the snapshot when encryption is unavailable, "re-enter password" prompt for `needs-reentry`; client-side validation matching T009 limits; shows `conflict`/`invalid` failures inline
- [x] T044 [US1] Implement `src/renderer/src/components/sql-client/sidebar/ConnectionList.tsx` and fill the Connections section of `SqlSidebarPanel.tsx`: each row shows name, `host:port/database`, status dot (semantic tokens), connect/disconnect, edit, delete with a confirmation `Dialog` stating how many saved queries and collections will be deleted (counts from the project snapshot), then `deleteConnection`; open SQL tabs using it fall back to "No connection" and keep their editor text (FR-009), "+ Add connection"; clicking a row sets `tab.sql.connectionId` on the focused SQL tab (depends on T028, T043)
- [x] T045 [P] [US1] Implement `src/renderer/src/components/sql-client/toolbar/ConnectionSelect.tsx` (`Select` with status dots; "No connection" option) bound to `tab.sql.connectionId`; switching connection calls `closeTabSession`
- [x] T046 [US1] Implement `src/renderer/src/components/sql-client/editor/SqlEditor.tsx`: generalize/reuse `src/renderer/src/components/api-client/ApiClientCodeEditor.tsx` (Monaco via `@/lib/monaco-setup`) with language `pgsql`, line numbers on, minimap off, Orca light/dark Monaco themes; `KeyMod.CtrlCmd | KeyCode.Enter` and `KeyCode.F5` run the selection (`getValueInRange`) or the whole model; error `position` shown as a Monaco marker on the mapped line/column (offset of the selection start added when the run was a selection); text changes write the draft via T022 (depends on T022)
- [x] T047 [US1] Implement `src/renderer/src/components/sql-client/toolbar/SqlToolbar.tsx`: `ConnectionSelect`, New (clears editor and result, unlinks saved query, keeps connection — FR-014), Run (disabled with "select a connection" hint when none — FR-011), Cancel while running, Save slot (filled in US3); run flow in the slice (T021) generates `runId`, sets `running`, calls `sqlClient.run`, stores the result (depends on T045, T046)
- [x] T048 [P] [US1] Implement `src/renderer/src/components/sql-client/results/ResultStates.tsx`: empty state ("Run a query with Cmd/Ctrl+Enter or F5", platform-specific label), running state (elapsed timer, Cancel), error state (message, SQLSTATE, position, detail, hint, failed statement number, and either "nothing was applied" when `nothingApplied` is true or "statements 1–N already ran" (derived from `failedStatementIndex`) when the run used explicit transaction control — FR-015a), `command` state ("N rows affected"), `cancelled` state
- [x] T049 [P] [US1] Implement `src/renderer/src/components/sql-client/results/ResultFooter.tsx`: row count (or affected rows) and elapsed time; notices "Limited to 1000 rows — add LIMIT to change" when `rowCapApplied`, "Size limit (50 MB) reached; showing rows loaded so far" when `sizeLimitReached`
- [x] T050 [US1] Implement `src/renderer/src/components/sql-client/results/SqlResultsGrid.tsx` (display only; copy is US2): `@tanstack/react-virtual` virtualizing rows and columns, sticky header with column name + `dataTypeName`, row-number gutter, column widths measured from header and first 100 rows clamped 80–480 px and user-resizable, `ResultCell.tsx` showing truncated text with a `Tooltip` of up to the first 2 000 characters and NULL as an italic muted `NULL` token distinct from the text `'NULL'`
- [x] T051 [US1] Assemble `SqlPane.tsx`: toolbar, editor, divider, and results area switching between `ResultStates`, `SqlResultsGrid` + `ResultFooter` from the tab runtime state; closing the tab calls `closeTabSession` (depends on T027, T047–T050)
- [x] T052 [US1] Add `sqlClient.*` strings for connections, toolbar, editor, results states, and notices to `src/renderer/src/i18n/locales/en.json` and other required locales
- [x] T053 [US1] Playwright e2e `tests/e2e/sql-client/sql-run.e2e.ts` (`ORCA_BACKGROUND_LAUNCH=1`, CDP screenshots, skipped without `ORCA_TEST_PG_URL`): quickstart scenarios 1–5 and 8 ('+' entry position, right panel switching between SQL / terminal / API Client tabs, add connection, run all and selection, cancel)

**Checkpoint**: US1 is fully functional and testable on its own — the MVP.

---

## Phase 4: User Story 2 - Copy data from the results (Priority: P1)

**Goal**: Click/Enter/Space copies a cell's full value; ranges, rows, and columns copy as TSV with a header row.

**Independent Test**: Run a query returning text, numeric, JSON, timestamp, and NULL values; click each cell and paste; confirm pasted text matches the stored value exactly (quickstart scenarios 9–10).

### Tests for User Story 2

- [x] T054 [P] [US2] Unit tests `src/shared/sql-client/result-grid-tsv.test.ts`: header row first, NULL → empty field, values containing tab / newline / `"` wrapped in `"…"` with `"` doubled, row and column selections, single cell
- [x] T055 [P] [US2] Component tests `src/renderer/src/components/sql-client/results/SqlResultsGrid.test.tsx`: click copies full (untruncated) value via the clipboard bridge mock; Enter/Space on focused cell copies; NULL copies `''`; "copied" feedback and aria-live announcement; Shift+click and Shift+arrows extend a range; row-number click selects the row; header click selects the column; Cmd/Ctrl+C copies TSV; arrow keys move focus (single tab stop)

### Implementation for User Story 2

- [x] T056 [P] [US2] Implement `src/shared/sql-client/result-grid-tsv.ts`: `selectionToTsv(columns, rows, range)` per T054
- [x] T057 [US2] Implement `src/renderer/src/components/sql-client/results/use-grid-selection.ts`: focused cell, rectangular range anchor/extent, row and column selection, roving tabindex keyboard model (arrows, Shift+arrows, Enter/Space, Cmd/Ctrl+C with the platform check)
- [x] T058 [US2] Wire copy into `SqlResultsGrid.tsx` and `ResultCell.tsx`: single-cell copy through the existing `writeClipboardText` bridge (`clipboard:writeText`), brief "copied" cell state, aria-live region, selection highlight with tokens, TSV copy via T056 (depends on T056, T057)
- [x] T059 [US2] Add `sqlClient.*` strings for copy feedback and selection announcements to the locale files
- [x] T060 [US2] Playwright e2e `tests/e2e/sql-client/sql-copy.e2e.ts`: quickstart scenarios 9 (per-type clipboard text equals `psql -At` output) and 10 (range/row/column TSV)

**Checkpoint**: US1 + US2 work independently.

---

## Phase 5: User Story 5 - Work survives restarts and stays out of the repository (Priority: P1)

**Goal**: Drafts, selected connection, and all project SQL data restore after restart; nothing lands in the repo; passwords encrypted; project removal deletes data; worktree removal does not.

**Independent Test**: Add a connection, save a query, type an unsaved draft in a second SQL tab, restart; everything restored, `git status` clean, password not readable in Orca's data (quickstart scenarios 16–19, 24).

### Tests for User Story 5

- [x] T061 [P] [US5] Unit tests `src/main/sql-client/sql-client-data-deletion.test.ts` and `src/main/sql-client/sql-client-data-gc.test.ts` modeled on the API Client equivalents: project deletion tombstones then removes asynchronously and evicts the store cache; startup drains `.tombstones/`; GC tombstones dirs whose `meta.projectKey` names a repo / folder workspace no longer in the catalog and older than 5 minutes; a project whose folder is missing on disk but still in the catalog is kept
- [x] T062 [P] [US5] Renderer tests `src/renderer/src/store/slices/sql-client-tab-persistence.test.ts`: draft round-trip through `tab.sql`, debounce, >1 MB draft kept in memory with the notice flag, deleted connection / saved query ids fall back to `null` on hydrate

### Implementation for User Story 5

- [x] T063 [US5] Restore and reconcile on hydrate in `src/renderer/src/store/slices/sql-client-tab-persistence.ts`: restored tabs keep `draftText`, `connectionId`, `savedQueryId`, `savedQueryRevision`, `splitRatio`; connections start `idle`; ids missing from the project snapshot become `null`; finish `sqlClient:show` loading of `connectionId`/`savedQueryId` in `content-creation-ipc-bridge.ts`
- [x] T064 [P] [US5] Implement `src/main/sql-client/sql-client-data-deletion.ts` (`deleteProjectSqlData(projectKey, root?)`, `drainSqlClientPendingDeletes(root?)`, cache evictor hook) reusing the tombstone/retry pattern of `src/main/api-client/api-client-data-deletion.ts` (extract a shared tombstone module only if it avoids copying; name it after what it does, e.g. `src/main/tombstone-tree-deletion.ts`)
- [x] T065 [P] [US5] Implement `src/main/sql-client/sql-client-data-gc.ts` (`scheduleSqlClientGc(store)`) modeled on `src/main/api-client/api-client-data-gc.ts`, catalog-based with the 5-minute age guard
- [x] T066 [US5] Wire startup: call `drainSqlClientPendingDeletes()` and `scheduleSqlClientGc(...)` next to `scheduleApiClientGc` in `src/main/window/attach-main-window-services.ts` (and the drain next to the API Client drain in `src/main/startup/main-process-runtime-launch.ts` if it lives there) (depends on T064, T065)
- [x] T067 [US5] Call `deleteProjectSqlData` at the project-removal sites: `repos:remove` and `removeProjectForHost` (only when the repo id is gone from every host) in `src/main/ipc/repos/repo-catalog-handlers.ts`, `removeProject` in `src/main/runtime/runtime-repository-settings-controller.ts`, the rollback removal in `src/main/ipc/repos/project-host-setup-handlers.ts`, and the folder-workspace removal in `src/main/ipc/worktrees/removal/remove-folder-workspace.ts` (`folder-workspace:<id>`); worktree removal must not call it; add a test per call site next to the existing ones (depends on T064)
- [x] T068 [US5] Playwright e2e `tests/e2e/sql-client/sql-persistence.e2e.ts`: seed a saved query and a collection through `window.api.sqlClient.saveQuery` / `createCollection` (Foundational IPC, T019), not through the Save UI, so US5 does not depend on US3; quickstart scenarios 16 (restart restores drafts, connections idle, no results), 17 (`git status` clean; data dir contains no plaintext test password), 18 (second worktree sees same data; other project does not), 19 (closed tab's draft gone); plus: switching the worktree's branch keeps its SQL tab drafts (FR-029), and removing one worktree of a two-worktree project drops only that worktree's SQL tab drafts while `sql-client/` data stays (US5-6)

**Checkpoint**: All P1 stories (US1, US2, US5) work; the feature is shippable.

---

## Phase 6: User Story 3 - Save queries per connection (Priority: P2)

**Goal**: Save / Save As / rename / move / delete queries under a connection, with collections, an unsaved marker, and load-into-tab.

**Independent Test**: Save two queries under one connection (one in a collection), restart, select each from the right side panel; the editor shows the saved text with the right connection (quickstart scenarios 13–14).

### Tests for User Story 3

- [x] T069 [P] [US3] Component tests `src/renderer/src/components/sql-client/sidebar/SavedQueryTree.test.tsx` and `src/renderer/src/components/sql-client/toolbar/SaveQueryDialog.test.tsx`: name prefilled from the first 40 chars of the SQL after collapsing whitespace, collection optional, Save updates in place, Alt/Option+Save creates new, unsaved marker on `draftText !== savedQuery.sql`, only the selected connection's queries listed, loading a query while another loaded query has unsaved changes prompts save/discard (FR-026), delete-collection confirmation shows the query count and the "delete queries too" choice

### Implementation for User Story 3

- [x] T070 [P] [US3] Implement `src/renderer/src/components/sql-client/toolbar/SaveQueryDialog.tsx`: name (1–200 chars, default "first 40 chars of the SQL after collapsing whitespace") and optional collection (existing or new); calls `saveQuery` with `id`/`baseRevision` for Save, without `id` for Save As; `conflict` shows "changed elsewhere — reload or save as new"
- [x] T071 [US3] Add Save to `SqlToolbar.tsx` (Alt/Option+click or Alt/Option-modified shortcut = Save As), the loaded query name, and the unsaved-changes dot (FR-023); after save update `tab.sql.savedQueryId`/`savedQueryRevision` (depends on T070)
- [x] T072 [US3] Implement `src/renderer/src/components/sql-client/sidebar/SavedQueryTree.tsx` and `SavedQueryDialogs.tsx`, filling the Saved Queries section for the focused tab's connection: expandable collections + ungrouped queries showing name and start of text; actions (`DropdownMenu`/`ContextMenu`) rename, move to collection, delete (confirmation); create / rename / delete collection (confirmation states its query count and offers ungroup vs. delete queries); clicking a query loads `sql`, `connectionId`, `savedQueryId`, `savedQueryRevision` into the focused tab, with the FR-026 save/discard prompt
- [x] T073 [US3] Handle edits from elsewhere in the slice: a loaded query deleted → tab keeps its text and unlinks (`savedQueryId: null`); renamed → toolbar name updates; both SQL tabs on one project refresh from `sqlClient:changed`
- [x] T074 [US3] Add `sqlClient.*` strings for saving, collections, and confirmations to the locale files; Playwright e2e `tests/e2e/sql-client/sql-saved-queries.e2e.ts` for quickstart scenarios 13–14
- [x] T075 [US3] Playwright e2e for quickstart scenario 20 in `tests/e2e/sql-client/sql-saved-queries.e2e.ts`: with saved queries and collections under a connection used by two tabs, delete the connection; the confirmation shows the correct counts, the queries and collections are gone, and both tabs show "No connection" with their text kept (FR-009)

**Checkpoint**: US3 works on top of US1.

---

## Phase 7: User Story 4 - Browse the database structure (Priority: P2)

**Goal**: Lazy schema → relation → column tree for a connected connection, with refresh and quoted-name copy.

**Independent Test**: Expand a schema and a table; tables, views, and columns match the database; create a table elsewhere, Refresh, it appears (quickstart scenario 15).

### Tests for User Story 4

- [x] T076 [P] [US4] Unit tests `src/shared/sql-client/pg-identifier-quoting.test.ts`: bare only when matching `^[a-z_][a-z0-9_$]*$` and not a reserved keyword; otherwise `"…"` with `"` doubled; qualified `"CaseManagement"."SurgicalCase"`; `user`, `order`, `select` quoted
- [x] T077 [P] [US4] Integration tests `src/main/sql-client/sql-schema-introspection.integration.test.ts` (`describeSqlIntegration`): system schemas `pg_catalog`, `information_schema`, `pg_toast`, `pg_temp_*`, `pg_toast_temp_*` hidden; relation kinds for table / view / materialized view; columns with type, nullability, PK marker, ordinal order; refresh sees a newly created table

### Implementation for User Story 4

- [x] T078 [P] [US4] Implement `src/shared/sql-client/pg-identifier-quoting.ts` (`quotePgIdentifier`, `quoteQualifiedName`) with PostgreSQL's reserved keyword list
- [x] T079 [US4] Implement `src/main/sql-client/sql-schema-introspection.ts`: `listSchemas`, `listRelations(schema)` (`pg_class.relkind` → `table`/`view`/`materialized-view`/`partitioned-table`/`foreign-table`), `listColumns(schema, relation)` (`format_type`, `attnotnull`, PK from `pg_index`), using parameterized catalog queries on the connection's metadata client; per-connection cache cleared by `refresh`
- [x] T080 [US4] Add `listSchemas` / `listRelations` / `listColumns` channels to `src/main/ipc/sql-client/sql-client-ipc.ts` and preload (`refresh?: boolean` on `listSchemas`); they connect the metadata client on demand (depends on T079)
- [x] T081 [US4] Implement `src/renderer/src/components/sql-client/sidebar/SchemaBrowser.tsx` and fill the Schema section: shown only when the tab's connection is connected (else a "Connect" action), lazy expand at each level, `Badge` for relation kind and PK, nullability shown, Refresh, copy quoted name via T078 and the clipboard bridge; add `sqlClient.*` strings; Playwright e2e `tests/e2e/sql-client/sql-schema.e2e.ts` for quickstart scenario 15

**Checkpoint**: US4 works on top of US1.

---

## Phase 8: User Story 6 - Agents run queries from the command line (Priority: P3)

**Goal**: `orca sql connections|queries|run` with full access on local hosts, read-only sessions elsewhere, 30 s default timeout, no write commands for Orca data.

**Independent Test**: From a terminal in the worktree, list connections, run a saved query and an ad-hoc `SELECT`; output has columns and rows matching the UI and no password (quickstart scenarios 21–23).

### Tests for User Story 6

- [x] T082 [P] [US6] Integration tests `src/main/sql-client/sql-agent-runner.integration.test.ts` (`describeSqlIntegration`): local host runs `INSERT` and returns affected rows; non-local host (`nonLoopbackHost()`) rejects `DELETE` with category `read-only` and row count unchanged; `SELECT` works read-only; `SELECT 1; SELECT 2;` on a non-local host succeeds with no PostgreSQL warnings and `SHOW transaction_read_only` inside the run returns `on`; text containing transaction control or `SET`/`RESET` of `transaction_read_only` / `default_transaction_read_only` / `RESET ALL` / `SET SESSION CHARACTERISTICS` is rejected before sending on non-local hosts; `pg_sleep(5)` with 1 s timeout → `timed-out` and no leftover backend in `pg_stat_activity`; `SELECT pg_sleep(0.8); SELECT pg_sleep(0.8);` with 1 s timeout → `timed-out` (the limit covers the whole run, FR-032b); on a local host `INSERT …; COMMIT; SELECT pg_sleep(5)` with 1 s timeout → `timed-out` and the committed insert stays; size limit flagged
- [x] T083 [P] [US6] Unit tests `src/main/runtime/rpc/methods/sql-client.test.ts` and `src/cli/handlers/sql-client.test.ts`: param validation (`timeoutSeconds` 1–600, exactly one of `sql`/`savedQuery`), connection by id or case-insensitive name, ambiguous name lists matching ids, no `password`/`cipher` keys in any result, exit codes 0/1/2/3/4 per contracts/cli-rpc.md, `method not found` → "this Orca version does not support `orca sql`; update Orca"

### Implementation for User Story 6

- [x] T084 [US6] Implement `src/main/sql-client/sql-agent-runner.ts`: `runAgentQuery({ connection, password, sql, timeoutMs })` computes `agentAccess` from the current host (T011); opens a fresh client via T038 with `options: '-c statement_timeout=<ms>'` (plus `-c default_transaction_read_only=on` when read-only); on read-only rejects bypass text before sending (T037 + SET/RESET checks) with "Agents only have read access to non-local connections."; read-only runs call T040 with `readOnly: true` (the executor owns the transaction; the runner issues no `BEGIN`/`ROLLBACK` itself); maps `25006` → category `read-only` with the same "Agents only have read access to non-local connections." message, and `57014` → `timed-out`; `statement_timeout` is per statement, so the runner also starts a run deadline when the run starts: at `timeout` it calls `pg_cancel_backend` on the run's backend pid (from `onBackendPid`) and returns `timed-out`, and if the server has not answered by `timeout + 5 s` it force-closes the client and still returns `timed-out`; same row cap and 50 MB limit via T040; always closes the client
- [x] T085 [P] [US6] Add zod params in `src/shared/rpc-contract/sql-client-params.ts` (`sql.connections { worktree? }`, `sql.queries { worktree?, connection? }`, `sql.run { worktree?, connection, sql?, savedQuery?, timeoutSeconds? }` default 30, range 1–600) and regenerate the params catalog (`node config/scripts/generate-rpc-params-catalog.mjs`, checked by `verify:rpc-params-catalog`)
- [x] T086 [US6] Implement `src/main/runtime/rpc/methods/sql-client.ts` (`sql.connections`, `sql.queries`, `sql.run`) resolving the worktree like the `api-client` RPC methods, rejecting non-local with `not-local`, unknown connection/query with `not-found`, returning shapes from contracts/cli-rpc.md; register in `src/main/runtime/rpc/methods/index.ts`; no create/edit/delete methods (FR-033) (depends on T084, T085)
- [x] T087 [US6] Implement `src/cli/specs/sql-client.ts` and `src/cli/handlers/sql-client.ts` mirroring `orca api`: `orca sql connections`, `orca sql queries [--connection]`, `orca sql run --connection (--sql | --file | --query | stdin) [--timeout <seconds>] [--json]`; human output prints an aligned table (first 100 rows) and footer `N rows · M ms` plus `row cap 1000 applied` / `size limit 50 MB reached`; exit codes per contract; register the spec where `api-client` CLI specs are registered (depends on T086)
- [x] T088 [US6] Add an `orca sql` section to the bundled CLI skill guide (`skill-guides/orca-cli.md` and a new `skill-guides/orca-cli/references/sql-client.md` modeled on `references/api-client.md`): list → pick connection → run, access levels (full on local hosts, read-only elsewhere, recommend a read-only DB role for shared databases), `--timeout`; run `node config/scripts/generate-bundled-skill-guides.mjs` so `pnpm verify:bundled-skill-guides` passes
- [x] T089 [US6] Manual/e2e check of quickstart scenarios 21–23 from a terminal in a worktree (document results in the PR)

**Checkpoint**: All user stories independently functional.

---

## Phase 9: Polish & Cross-Cutting Concerns

- [x] T090 [P] Performance check for SC-003: `SELECT * FROM wide_rows LIMIT 1000` renders and scrolls both ways without visible lag, and typing in another SQL tab's editor stays responsive during `pg_sleep(30)`; fix any non-virtualized rendering found (quickstart scenario 11)
- [x] T091 [P] Theme check (FR-010): CDP screenshots of a SQL tab in light and dark themes (editor, grid, sidebar, dialogs) under `ORCA_BACKGROUND_LAUNCH=1`
- [x] T092 [P] Fill all non-English locale files for the new `sqlClient.*` keys and run `pnpm run verify:localization-catalog`, `verify:localization-runtime-catalog`, `verify:localization-extraction`, `verify:localization-coverage`
- [x] T093 Run `pnpm tc`, `pnpm test src/shared/sql-client src/main/sql-client src/renderer/src/components/sql-client`, `ORCA_TEST_PG_URL=… pnpm test src/main/sql-client --testNamePattern sql-integration`, `oxlint`, `pnpm run check:code-quality:changed`, `pnpm run check:max-lines-ratchet`; fix all findings without `max-lines` disables
- [x] T094 Run the full quickstart.md scenario table (1–25) and record any gaps as follow-up tasks. Result: 1–5, 8–11, 13–23 and 25 run in e2e (`tests/e2e/sql-client/*.spec.ts`); 6, 7 (reconnect) and 12 are covered by the PostgreSQL integration tests only; 24 (project removal) by unit tests only; T092 (non-English translations) left open

---

## Dependencies & Execution Order

### Phase dependencies

- **Setup (Phase 1)**: none.
- **Foundational (Phase 2)**: depends on Setup (T001 for types). Blocks every story.
- **US1 (Phase 3)**: depends on Foundational. MVP.
- **US2 (Phase 4)**: depends on US1's grid (T050).
- **US5 (Phase 5)**: depends on Foundational; T063 and T068 use US1's pane. Can run in parallel with US2.
- **US3 (Phase 6)**: depends on US1 (toolbar, editor).
- **US4 (Phase 7)**: depends on US1's session manager metadata client (T041); independent of US2/US3.
- **US6 (Phase 8)**: depends on US1's main execution (T038, T040) and Foundational store; independent of all renderer stories.
- **Polish (Phase 9)**: after the stories you ship.

### Story completion order

```text
Setup → Foundational → US1 ─┬─> US2
                            ├─> US5 (P1 complete here)
                            ├─> US3
                            ├─> US4
                            └─> US6
```

### Within each story

Tests first (they should fail), then shared pure logic → main-process execution/IPC → renderer → strings → e2e.

## Parallel Opportunities

- Setup: T002, T003, T004 together after T001.
- Foundational: T005 / T006 / T007 refactors in parallel; T008, T011, T015, T016 in parallel; T009 and T010 after T008, T012 after T009; T020 after T010; T023, T025, T029 in parallel once T012/T022 land.
- US1: tests T030–T034 together; T035, T036, T037 together; T039 alongside T038; T043, T045, T048, T049 together.
- US2: T054 and T055 together, T056 alongside T057.
- US5: T061 and T062 together; T064 and T065 together.
- After US1, US2 / US5 / US3 / US4 / US6 can be staffed in parallel (different files).

### Parallel example: User Story 1

```text
Task: "T030 Unit tests src/shared/sql-client/sql-statement-splitter.test.ts"
Task: "T031 Port Terax limit tests into src/shared/sql-client/sql-default-limit.test.ts"
Task: "T032 Unit tests src/shared/sql-client/sql-transaction-control.test.ts"
Task: "T033 Integration tests src/main/sql-client/sql-batch-executor.integration.test.ts"
Task: "T034 Component tests ConnectionFormDialog.test.tsx"
# then
Task: "T035 sql-statement-splitter.ts" | "T036 sql-default-limit.ts" | "T037 sql-transaction-control.ts"
```

### Parallel example: User Story 6

```text
Task: "T082 sql-agent-runner.integration.test.ts"
Task: "T083 RPC + CLI handler tests"
Task: "T085 src/shared/rpc-contract/sql-client-params.ts"
```

## Implementation Strategy

### MVP first (US1 only)

1. Phase 1 Setup → Phase 2 Foundational.
2. Phase 3 US1.
3. **Stop and validate**: quickstart scenarios 1–8 against a Docker PostgreSQL.

### Incremental delivery

1. MVP (US1) → add US2 (copy) → add US5 (restart/removal lifecycle) — all P1 done, shippable.
2. Add US3 (saved queries) and US4 (schema browser).
3. Add US6 (agent CLI), which the future smoke-test workflow needs.
4. Polish.

## Notes

- [P] = different files, no dependency on an incomplete task.
- Integration tests skip (not fail) without `ORCA_TEST_PG_URL`.
- Never commit unless the user asks; leave changes in the working tree.

## Phase 10: Convergence

- [x] T095 Split `src/main/sql-client/sql-session-manager.ts` (oxlint `max-lines` error: 301 > 300) by moving the metadata-session lifecycle (`getMetadataSession`, `resetMetadataSession`, `connect`) into its own focused module, without any `max-lines` disable, so `oxlint` passes per plan: Constraints "Must pass … `max-lines` (no disables)" / T093 (contradicts)
- [x] T096 [P] Add a copy-quoted-name action to schema rows in `src/renderer/src/components/sql-client/sidebar/SchemaBrowser.tsx` (`quotePgIdentifier(schema.name)`, same `CopyButton` used for tables and columns) per FR-028 (partial)
- [x] T097 [P] Translate the 126 `sqlClient.*` keys into `es.json`, `fr.json`, `ja.json`, `ko.json`, `zh.json` under `src/renderer/src/i18n/locales/` and re-run the four `verify:localization-*` scripts per T092 (partial)
- [x] T098 [P] Extend `tests/e2e/sql-client/` with quickstart scenarios 5 (select one of two statements, F5 runs only the selection), 8 (`pg_sleep(60)` + Cancel → "cancelled", other SQL tab stays responsive), and 10 (range / row / column Cmd/Ctrl+C → TSV with header row) per T053 / T060 / FR-011 / FR-013 / FR-019 (partial)
- [x] T099 [P] Add `tests/e2e/sql-client/sql-persistence.spec.ts` covering quickstart scenarios 18 (second worktree of the same repo sees the same data, another project does not) and 19 (closed tab's draft gone, saved queries intact), plus branch switch keeps drafts and removing one of two worktrees keeps `sql-client/` data per T068 / US5-4 / US5-5 / US5-6 / FR-029 (partial)
- [x] T100 [P] Add quickstart scenario 14 (rename, move, delete a query; delete a collection with its count shown in the confirmation) to the e2e suite per T074 / US3-3 / US3-4 (partial)
- [x] T101 Update connection status when an open session or metadata client drops (`end`/`error` on a tab session in `sql-session-manager.ts` currently only sets `session.lost`; the toolbar and panel keep showing "connected"): set `error` "Connection lost" when no live client remains per FR-007 / edge case "connection drops" (partial)

## Phase 11: Convergence

- [x] T102 Bring `src/main/sql-client/sql-session-manager.ts` back under the oxlint `max-lines` limit (currently 301 > 300 after T101) without any `max-lines` disable — format it with `oxfmt` first and, if still over, move another cohesive piece (e.g. the `ensureClient` reconnect/probe logic) into its own module — so `oxlint` passes per plan: Constraints "`max-lines` (no disables)" / T093 / T095 (contradicts)
- [x] T103 [P] Run `oxfmt --write` on the files left in the wrong style (double quotes, semicolons, 80-col wrap): `src/main/sql-client/sql-session-manager.ts`, `src/main/sql-client/sql-metadata-sessions.ts`, `src/renderer/src/components/sql-client/sidebar/SchemaBrowser.tsx`, `src/renderer/src/store/slices/worktrees/teardown/removed-worktree-renderer-teardown.ts`, `tests/e2e/sql-client/sql-e2e-setup.ts`, `sql-persistence.spec.ts`, `sql-run-controls.spec.ts`, `sql-saved-queries.spec.ts`; confirm `oxfmt --check` is clean per T093 / AGENTS.md "format with `pnpm format`" (contradicts)
- [x] T104 In `SqlSessionManager.run`'s `catch` (`src/main/sql-client/sql-session-manager.ts`), call `markLost` after setting `session.lost = true` so a run that throws on a dropped client moves the connection status off "connected" when no live client remains, matching the `connection`-category branch per FR-007 / T101 (partial)
