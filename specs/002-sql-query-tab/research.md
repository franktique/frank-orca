# Phase 0 Research: SQL Tab (PostgreSQL query client)

**Feature**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md) | **Date**: 2026-10-14

Constraints from the user:

1. Build with Orca's current stack (Electron + React 19 + TypeScript + zustand + zod + Tailwind/shadcn, Monaco, Vitest, Playwright). No Rust/Tauri pieces from Terax are carried over.
2. Terax shows connections in a **left** panel inside the tab. Orca uses the **right side panel** instead, the same one that switches content when the active tab is an API Client. It shows connections, schema, and saved queries **only while the active tab is a SQL tab**.

Every decision below reuses an existing Orca mechanism unless none fits. New dependencies are called out explicitly.

---

## R1. New tab type and '+' menu entry (FR-001, FR-005)

- **Decision**: Add `'sql'` to `TabContentType` / `WorkspaceVisibleTabType` (`src/shared/tab-types.ts`) and the persisted zod enum (`src/shared/workspace-session-tab-type-schema.ts`). Add a `new-sql` kind to `src/renderer/src/components/tab-bar/tab-create-menu-options.ts`, right after `new-api-client`, before the agent list, with keywords `sql`, `postgres`, `database`, `query`. Open/ensure flow in `src/renderer/src/lib/ensure-sql-tab.ts`, modeled on the existing `ensure-api-client-tab.ts`.
- **Rationale**: The `api-client` tab is the newest tab type and already went through the full footprint (tab-bar projection, icons, close/bulk-close, cycling, drag data, palette search, `toVisibleTabType`). `rg -l "'api-client'" src -g '!*.test.*'` gives the exact list of switch branches to extend.
- **Alternatives considered**: Opening SQL inside an editor tab with a `.sql` virtual file (rejected: editor tabs assume a file-backed buffer, dirty-file prompts and git diff semantics, and the spec forbids repo files).

## R2. Local-only gating (FR-002)

- **Decision**: Generalize `src/main/api-client/api-client-local-host-guard.ts` into a shared `src/main/workspace-local-host-guard.ts` (`assertLocalWorkspace(store, worktreeId)`) used by both features, and its renderer twin `api-client-availability.ts` into `local-workspace-tab-availability.ts`. The menu shows "New SQL" disabled with a "local workspaces only" hint on SSH worktrees; SQL IPC and RPC handlers reject non-local worktree ids with `not-local`.
- **Rationale**: Reuse before reimplementing; one definition of "local workspace" for both tab types.
- **Alternatives considered**: Copying the guard (rejected: two rules that will drift).

## R3. Remote-wire / mixed-version safety

- **Decision**: Same as `api-client`: `sql` tabs are host-local UI. They are excluded from tab snapshots published to paired mobile/web clients, and session hydration already tolerates unknown `contentType` values (added for the API Client), so older builds drop the tab instead of failing the session parse. New RPC methods only; no new stream opcodes.
- **Rationale**: `docs/reference/remote-wire-compatibility.md`.

## R4. Side panel: right sidebar, only while a SQL tab is active (FR-003, user constraint 2)

- **Decision**: Extend the existing render-time override in `src/renderer/src/components/right-sidebar/right-sidebar-panel-content.tsx`. Today it asks `selectApiClientSidebarWorktreeId`; it becomes a small dispatch on the focused tab's `contentType`:
  - `api-client` → `ApiClientSidebarPanel` (unchanged)
  - `sql` → `SqlSidebarPanel` (new, lazy-loaded)
  - anything else → the user's routed `rightSidebarTab` content

  A new selector `selectSqlSidebarTarget(state)` returns `{ worktreeId, tabId, projectKey }` or `null`. The persisted `RightSidebarRoute` is untouched, so switching to a terminal/editor tab brings back the panel the user had open (explorer, source control, …).

- **Panel content** (top to bottom, each section collapsible with the existing `Collapsible` primitive, sizes persisted per project in renderer UI state):
  1. **Connections**: list with status dot, `host:port/database`, connect/disconnect, edit, delete, "+ Add connection". Clicking a connection selects it for the active SQL tab.
  2. **Schema** of the tab's selected connection (only when connected): schemas → tables/views → columns; refresh; copy quoted name.
  3. **Saved queries** of the selected connection: collections (expandable) + ungrouped queries; rename/move/delete; create/rename/delete collection.
- **Rationale**: Exactly the user's instruction; follows the pattern R4 of feature 001 established, and keeps the tab's main area free for editor + results (no inner left panel as in Terax).
- **Alternatives considered**: A dedicated `RightSidebarTab` value `'sql'` in the activity bar (rejected: visible for non-SQL tabs, needs persistence/migration; user explicitly wants it only for SQL tabs); Terax's left inner panel (rejected by the user).

## R5. PostgreSQL driver

- **Decision**: **`pg` (node-postgres)** in the main process, plus **`pg-cursor`** for incremental row reading. Pure JavaScript; `pg-native` is **not** installed. All type parsers are overridden to return the raw text value (`types.getTypeParser = () => (v) => v`), so every cell is PostgreSQL's own text form (or `null`).
- **Rationale**:
  - Pure JS → no native module, no Electron ABI rebuild, no glibc floor risk (`docs/reference/linux-glibc-compatibility.md`), identical on macOS/Linux/Windows.
  - The most widely used Node PostgreSQL client; supports SSL options, unix sockets, `application_name`, connection-time `options` (needed for R9 read-only sessions), and exposes `processID` for cancellation (R8).
  - Raw text values satisfy SC-002 ("pastes exactly as `psql` prints") and the "no precision loss" edge case for `numeric`, `int8`, intervals, arrays, geometric types, `timestamptz`, `bytea` (hex form like psql) — better than Terax's JSON conversion, which turns `bytea` into base64 and `timestamptz` into RFC 3339.
  - `pg-cursor` reads rows in batches so the 50 MB limit (FR-012a) can stop reading early instead of buffering the whole result.
- **Alternatives considered**: `postgres` (porsager) — fast, but its tagged-template API and connection model fit ad-hoc user SQL worse, and cursor + cancel are less direct. `pg-native`/libpq — native module (rejected for the reasons above). Shelling out to `psql` — not installed everywhere, fragile parsing.
- **New dependencies**: `pg`, `pg-cursor` (runtime, MIT), `@types/pg`, `@types/pg-cursor` (dev).

## R6. Where queries run; sessions and concurrency (FR-005, edge cases "two tabs", "connection drops")

- **Decision**: Main process owns all database work in a `SqlSessionManager`:
  - **UI runs** use one dedicated `pg.Client` per (SQL tab, connection) — a "tab session" — opened lazily on first run (FR "connects first then runs") and closed when the tab closes, switches connection, or the user disconnects. Session state (`SET search_path`, temp tables) behaves like a `psql` session per tab, and two tabs on the same connection run independently.
  - **Connection status** (idle / connecting / connected / error) is per connection, derived from its sessions plus an explicit "Connect" from the side panel, which opens a small metadata client used by the schema browser.
  - **Agent runs** open a short-lived client per command with their own startup options (R9) and always close it afterwards, so agent session settings never leak into UI sessions.
  - **Dropped connection**: on a connection-class error (`ECONNRESET`, `57P01 admin_shutdown`, client `end` event), the session is discarded and the run retried once on a fresh client — only if the failure happened before the batch's first statement was sent; otherwise the error says the connection was lost.
- **Rationale**: Main ownership mirrors the API Client (R9 of 001) and is required because agent CLI runs originate in main. Per-tab sessions match the Terax/`psql` mental model better than a shared pool.
- **Alternatives considered**: `pg.Pool` per connection shared by tabs (rejected: `SET` statements would hop between tabs unpredictably; cancel needs the exact backend pid of the running query anyway).

## R7. Running statements: selection, splitting, all-or-nothing, LIMIT cap (FR-011, FR-012, FR-015a)

- **Decision**: Pure functions in `src/shared/sql-client/`:
  - `sql-statement-splitter.ts`: splits on `;` while respecting single/double quotes, `E''` strings, dollar quoting (`$tag$…$tag$`), line and nested block comments. Returns `{ text, startOffset }[]` so errors can point back to the editor line.
  - `sql-default-limit.ts`: ported from Terax `limit.ts` (same regexes and tests) — applies only when the run has **one** statement that starts with `SELECT`/`WITH` and has no `LIMIT n`/`LIMIT ALL`/`FETCH FIRST`.
  - `sql-transaction-control.ts`: detects explicit `BEGIN`/`START TRANSACTION`/`COMMIT`/`END`/`ROLLBACK`/`SAVEPOINT`/`RELEASE`/`PREPARE TRANSACTION` statements.
- **Execution** (`sql-batch-executor.ts` in main):
  - No explicit transaction control and >1 statement → `BEGIN`; run each statement; on first error `ROLLBACK` and return `{ failedStatementIndex, failedStatementText, nothingApplied: true }`; on success `COMMIT` and return the **last** statement's result.
  - One statement → run as-is (PostgreSQL's implicit transaction is already all-or-nothing).
  - Explicit transaction control present → run statements as written, in order, stop at the first error; the error says which statements already ran (honors "explicit BEGIN/COMMIT honored as written").
  - Statements other than the last run with a plain query (results discarded, row counts kept); the last statement runs through `pg-cursor` in 500-row batches.
  - Statements that cannot run inside a transaction block (`VACUUM`, `CREATE DATABASE`, `CREATE INDEX CONCURRENTLY`, …) work as a single statement; inside a multi-statement run PostgreSQL rejects them and the error is shown as returned.
- **Rationale**: Client-side splitting is the only way to name the failed statement (FR-015a) and to stream the last result with a cursor (extended protocol accepts one statement at a time).
- **Alternatives considered**: Sending the whole text with the simple query protocol (rejected: cannot identify the failing statement, buffers every result, no streaming).

## R8. Cancellation (FR-013) and agent timeout (FR-032b)

- **Decision**:
  - **UI cancel**: main opens a short-lived client on the same connection and runs `SELECT pg_cancel_backend($1)` with the running session's `processID`. The run ends with `cancelled`; inside a batch the transaction is rolled back.
  - **Agent timeout**: the agent client is opened with `options: '-c statement_timeout=<ms>'` (default 30 000; `--timeout <seconds>` per command, max 600). PostgreSQL cancels the statement (`57014 query_canceled`), the transaction rolls back, and the result is `timed-out`. Because `statement_timeout` is per statement, the runner also starts a run deadline when the run starts: at `timeout` it calls `pg_cancel_backend` on the run's backend and reports `timed-out` (so a run of several statements cannot exceed the limit in total); if the server has not answered by `timeout + 5 s` the client is force-closed and the result is still `timed-out`.
- **Rationale**: `pg` has no built-in cancel; `pg_cancel_backend` is what `psql` effectively does over the cancel protocol and needs no superuser for the same role. A server-side `statement_timeout` guarantees the database stops the work (spec: "the database cancels the query").

## R9. Agent access level: full on local, read-only otherwise (FR-032a, SC-007)

- **Decision**:
  - `sql-connection-locality.ts` (shared): local ⇔ host is `localhost`, an IPv4 in `127.0.0.0/8`, `::1`, or an absolute POSIX path (unix socket dir; macOS/Linux only). Anything else — including LAN IPs and `host.docker.internal` — is non-local. Computed at every agent query from the current stored host (so an edit takes effect on the next query).
  - Non-local agent clients start with `options: '-c default_transaction_read_only=on -c statement_timeout=…'` and the batch executor runs every read-only agent run in `BEGIN READ ONLY … ROLLBACK` (read-only runs never need to commit; the executor is the only layer that issues transaction statements).
  - Agent runs on non-local connections **reject before sending** any text containing transaction-control statements (R7) or `SET`/`RESET`/`SET SESSION CHARACTERISTICS` that touch `transaction_read_only`/`default_transaction_read_only`/`RESET ALL`, with the error "agents only have read access to non-local connections". This is stated in spec FR-032a: FR-015a's explicit-transaction behavior does not apply to agents on non-local connections.
  - A write attempt that reaches the server fails with `25006 read_only_sql_transaction`; the CLI maps it to the same message.
- **Rationale**: The database enforces read-only (spec), and closing the two ways a session could switch it off makes SC-007 testable. Documented residual risk: extensions that open their own connections (`dblink`, `postgres_fdw` writes) are outside a read-only transaction's reach; the CLI guide recommends a read-only database role for shared databases.
- **Alternatives considered**: Parsing SQL to allow only `SELECT` (rejected: `SELECT` can call writing functions; parsing is unreliable); always read-only (rejected by clarification: local writes allowed).

## R10. Result size limit and value shape (FR-012a, FR-016 – FR-017, SC-003)

- **Decision**: The executor sums `Buffer.byteLength` of every cell (+ small per-row overhead) while reading cursor batches; once the running total passes 50 MB it stops reading, closes the cursor, and marks `sizeLimitReached: true`. Rows already read are returned whole. Columns carry `{ name, dataTypeId, dataTypeName }`; type names come from one cached `SELECT oid, format_type(oid, NULL) FROM pg_type WHERE oid = ANY($1)` per connection. JSON/JSONB values stay as PostgreSQL text (exactly as `psql` shows them).
- **IPC transport**: results ≤ 50 MB go to the renderer in one `invoke` response as `{ columns, rows: (string | null)[][] }` — arrays, not objects, to halve payload size. The renderer keeps the last result per tab in memory only.
- **Rationale**: Bounded memory in main and renderer; text values make copy exact.

## R11. Results grid and copying (FR-016 – FR-020, US2, SC-002, SC-003)

- **Decision**: New `SqlResultsGrid` built on **`@tanstack/react-virtual`** (already a dependency) virtualizing rows **and** columns, sticky header row with name + type, row-number gutter. Column widths are measured from the header and the first 100 rows, clamped 80–480 px, user-resizable with the existing resize-handle pattern.
  - Cell display: truncated with `title`/`Tooltip` showing up to the first 2 000 characters; NULL rendered as an italic muted `NULL` token (design-system muted foreground), distinct from the text `'NULL'`.
  - Click / Enter / Space on a cell copies the full value via the existing `writeClipboardText` bridge (`clipboard:writeText` IPC), with a brief "copied" state on the cell (aria-live announcement). NULL copies as `''`.
  - Range selection: Shift+click / Shift+arrows extend a rectangular range; clicking a row number selects the row; clicking a column header selects the column; Cmd/Ctrl+C copies the selection as TSV with a header row. TSV escaping: values containing tab, newline, or `"` are quoted per spreadsheet convention (`"` doubled).
  - Keyboard: arrow keys move focus within the grid (roving tabindex), so the grid is a single tab stop.
- **Rationale**: No table/grid primitive exists in `components/ui`; `@tanstack/react-virtual` is already used by the API Client console. 1000×40 cells virtualized keeps SC-003.
- **Alternatives considered**: AG Grid / Glide Data Grid (rejected: heavy new deps, own styling fighting the design-system lint); plain `<table>` without virtualization (rejected: 40 000 cells + tooltips lag).

## R12. SQL editor (FR-010, FR-011)

- **Decision**: Monaco through the existing `@/lib/monaco-setup` loader with the built-in **`pgsql`** language (present in `monaco-editor/esm/vs/basic-languages/pgsql`), line numbers on, minimap off, Orca's light/dark Monaco themes. Commands registered on the editor: Cmd/Ctrl+Enter and F5 → run selection or all; Alt/Option+Cmd/Ctrl+S optional "Save As" is a toolbar action only. Run uses `editor.getModel().getValueInRange(selection)` when the selection is non-empty. Errors with a `position` are highlighted with a Monaco marker on the right line/column (offset mapped through the statement's `startOffset`).
- **Rationale**: Monaco is already shipped and used by the API Client (`ApiClientCodeEditor.tsx`); generalizing that wrapper (language prop already exists) avoids a second editor stack. Terax uses CodeMirror, but adding it to Orca would duplicate the editor.
- **Cross-platform**: Cmd on macOS, Ctrl elsewhere via `monaco.KeyMod.CtrlCmd`.

## R13. Persistence: per project, outside the repo (FR-029 – FR-031, US5, SC-004, SC-005)

- **Project key** (`src/main/sql-client/sql-project-key.ts`):
  - git worktree id `repoId::path` → `repo:<repoId>` (all worktrees of a repo share it; `getRepoIdFromWorktreeId`).
  - folder workspace (`folder:<id>` workspace key) → `folder-workspace:<id>` (spec: "the folder workspace is its own project").
- **Location**: `userData/sql-client/<sha256(projectKey) first 16 hex>/` with `meta.json` (`{ projectKey, createdAt }`), `connections.json`, `queries.json` (saved queries + collections). Written with `writeFileDurable`. Details in [contracts/storage-format.md](./contracts/storage-format.md). Hash computed with the existing `hashWorktreeId` (sha256, 16 hex) from `terminal-history-id.ts`, as `api-client-storage-paths.ts` does.
- **Passwords**: encrypted with the same `SecretStore`/`safeStorage` path as API Client secrets. `sealSecretValue`/`openSecretCipher` are moved from `api-client-secret-codec.ts` into a neutral `src/main/secret-value-codec.ts` and both features import it. Decrypt failure → `passwordState: 'needs-reentry'`. Encryption unavailable → password kept in memory only, `passwordState: 'session-only'`, and the form shows `describeProtectionGap()`.
- **Drafts** (editor text, selected connection id, linked saved-query id, split ratio): stored on the unified tab as `sql?: SqlPersistedTab`, the same way `apiClient?: ApiClientPersistedTab` is (`api-client-tab-persistence.ts`). Session persistence already saves, restores, prunes on worktree removal, and drops on tab close (FR-031) — no new store. Debounced 500 ms while typing. Drafts above 1 MB are kept in memory only with a notice (keeps the session file bounded).
- **Deletion lifecycle**:
  - Project removed → `deleteProjectSqlData(projectKey)` (tombstone + async remove, same pattern as `api-client-data-deletion.ts`) at the `store.removeProject` call sites: `repos:remove` (`repo-catalog-handlers.ts`), runtime `removeProject` (`runtime-repository-settings-controller.ts`), and the rollback in `project-host-setup-handlers.ts`. For `removeProjectForHost`, only when the repo id is no longer present on any host.
  - Folder workspace removed (`remove-folder-workspace.ts`) → delete its `folder-workspace:<id>` data.
  - Worktree removed → nothing in `sql-client/`; its tabs (and drafts) go with the session.
  - Startup GC (next to `api-client-data-gc.ts`): tombstone `sql-client/*` dirs whose `meta.projectKey` names a repo / folder workspace no longer in the store, with the same 5-minute age guard. Presence is checked against Orca's catalog, **not** the disk, so a moved folder keeps its data (edge case).
- **Rationale**: Never inside the repo; follows the proven API Client lifecycle with the project as owner instead of the worktree.

## R14. Main-owned store and change events (FR-022 – FR-026, edge cases "two tabs", "changed outside")

- **Decision**: `SqlClientStore` in main: one cache per project key, write-through, `revision` per entity. Renderer gets a project snapshot via IPC and subscribes to `sqlClient:changed` `{ projectKey, kind, id, revision }` events. Connection status changes stream on `sqlClient:connectionStatus`. Deleting a connection closes its sessions and broadcasts so tabs fall back to "No connection" while keeping their text.
- **Rationale**: Same ownership model as the API Client store; agents read the same data.

## R15. Agent and CLI access (FR-032 – FR-034, US6)

- **Decision**: Runtime RPC methods `sql.connections`, `sql.queries`, `sql.run` in `src/main/runtime/rpc/methods/sql-client.ts` (zod params in `src/shared/rpc-contract/sql-client-params.ts`), CLI group `orca sql` in `src/cli/specs/sql-client.ts` + `src/cli/handlers/sql-client.ts`, mirroring `orca api`. Project resolved from the caller's worktree (cwd / `--worktree`, same resolver as `orca api`). No create/edit/delete commands. Bundled skill guide updated (`verify:bundled-skill-guides`). Contract: [contracts/cli-rpc.md](./contracts/cli-rpc.md).
- **Rationale**: Orca's agent surface is the CLI → runtime RPC → main path. Gives the future smoke-test workflow its hook without building it.

## R16. UI components and design system

- **Decision**: shadcn primitives from `src/renderer/src/components/ui/`: `Button`, `Select` (connection selector), `Dialog` (connection form, save query, confirmations), `DropdownMenu`/`ContextMenu` (row actions), `Input`, `Collapsible`, `ScrollArea`, `Tooltip`, `Badge` (table/view kind, PK marker). Status dot colors use existing semantic tokens (success/warning/destructive/muted) from `assets/main.css`. Editor/results splitter reuses the API Client's resize-handle pattern. Icons from `lucide-react`. Strings through `translate()` with catalog entries.
- **Rationale**: AGENTS.md + `docs/STYLEGUIDE.md`; `check:code-quality:changed` gate.

## R17. Testing strategy

- **Decision**:
  - Vitest unit: statement splitter (quotes, dollar quoting, comments), default-limit (ported Terax tests), transaction-control detection, locality, TSV encoding, project key, storage read/write/tombstone/GC, secret sealing with a fake `SecretStore`.
  - Vitest integration against a **real PostgreSQL**: tests tagged `sql-integration` use `ORCA_TEST_PG_URL`; skipped when unset; CI job starts `postgres:16` as a service container. Covers type text forms (SC-002 matrix), all-or-nothing batches, cancel, agent timeout, read-only rejection on a non-local alias (tests point a non-loopback hostname at the container), 50 MB stop.
  - Renderer component tests (Testing Library + happy-dom): results grid copy/range/NULL, sidebar sections, connection form.
  - Playwright Electron e2e (`ORCA_BACKGROUND_LAUNCH=1`, CDP screenshots) for the P1 flows in [quickstart.md](./quickstart.md).
- **Rationale**: Existing test stack; a real database is the only trustworthy check for type text forms and transaction behavior.

All Technical Context unknowns are resolved; no NEEDS CLARIFICATION remains.
