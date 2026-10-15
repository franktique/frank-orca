# Implementation Plan: SQL Tab (PostgreSQL query client)

**Branch**: `franktique/feat-postgress-line-tab` (spec dir `002-sql-query-tab`) | **Date**: 2026-10-14 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/002-sql-query-tab/spec.md`, planned with Orca's current tech stack. User direction: Terax keeps connections in a left panel inside the tab; here they go in Orca's **right side panel**, the one that already switches content for API Client tabs, and it shows connections, schema, and saved queries **only while the active tab is a SQL tab**.

## Summary

Add a `sql` tab type to Orca, offered in the '+' menu next to "New API Client" for local worktrees and folder workspaces. The tab's main area is a toolbar, a Monaco editor (`pgsql` language) on top, a draggable divider, and a virtualized results grid below where clicking a cell copies it and ranges copy as TSV. While a SQL tab is focused, the right side panel renders `SqlSidebarPanel` (connections, schema browser, saved queries and collections) through the same render-time override the API Client uses; other tabs get their usual panel back.

The main process owns all data and database work. PostgreSQL is reached with `pg` (pure JS, no native module) and `pg-cursor`, with every value returned as PostgreSQL's text form so copies match `psql`. Each SQL tab has its own database session; multi-statement runs are split client-side and wrapped in one transaction (all-or-nothing); results stop at 50 MB. Connections and saved queries are stored per Orca project under `userData/sql-client/<hash>/`, passwords sealed with the existing `SecretStore`; tab drafts ride on the existing workspace-session tab persistence. Agents get read/run-only `orca sql` commands: any statement on local hosts, read-only sessions elsewhere, 30 s default timeout. Details: [research.md](./research.md).

## Technical Context

**Language/Version**: TypeScript (strict), Node 24, Electron 43.7, React 19

**Primary Dependencies**: Existing: electron (`safeStorage` via `SecretStore`), zustand, zod, radix-ui/shadcn primitives, Tailwind, lucide-react, `@monaco-editor/react` + `monaco-editor` (built-in `pgsql` language), `@tanstack/react-virtual`, i18next. **New**: `pg`, `pg-cursor` (runtime, pure JS, MIT); `@types/pg`, `@types/pg-cursor` (dev). `pg-native` is explicitly not used.

**Storage**: Per-project JSON in `app.getPath('userData')/sql-client/<hashWorktreeId(projectKey)>/` (`meta.json`, `connections.json`, `queries.json`) written with `writeFileDurable`; passwords sealed via `SecretStore`; per-tab drafts on the unified tab (`tab.sql`) in the workspace session; results and schema cache in memory only

**Testing**: Vitest (unit + Testing Library/happy-dom), Vitest integration against a real `postgres:16` (`ORCA_TEST_PG_URL`, skipped when unset), Playwright Electron e2e with `ORCA_BACKGROUND_LAUNCH=1` and CDP screenshots

**Target Platform**: Orca desktop on macOS, Linux, Windows (local execution host only; SSH worktrees excluded by spec). Unix-socket hosts on macOS/Linux only

**Project Type**: Desktop app (Electron main + preload + React renderer + `orca` CLI)

**Performance Goals**: 1000 × 40 result renders and scrolls without visible lag; editor typing unaffected while a query runs (SC-003). '+' to first rows in under 1 minute (SC-001)

**Constraints**: No files in the repo working tree (SC-004). No plaintext passwords on disk or in any IPC/RPC response (FR-008). Agents cannot write data (FR-033) and cannot write to non-local databases (FR-032a). Result cap 50 MB; implicit 1000-row cap for bare `SELECT`/`WITH`. Agent timeout 30 s default. Must pass design-system lint, localization verification, `max-lines` (no disables), and the no-vague-file-names rule

**Scale/Scope**: Tens of connections and hundreds of saved queries per project; several SQL tabs open across worktrees of one project; results up to 50 MB

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

`.specify/memory/constitution.md` is still the unfilled template, so the project's binding rules in `AGENTS.md` (plus `docs/STYLEGUIDE.md`) act as the constitution, as in feature 001.

| Gate (AGENTS.md)                                                                           | Status | How the design satisfies it                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------ | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Design system: tokens + `components/ui` primitives, no raw palette, no computed classNames | PASS   | R16: existing primitives only; status colors from semantic tokens; grid built on tokens + `@tanstack/react-virtual`; resize handle reused from the API Client                                                                                                                                                                                                                        |
| Reuse before reimplementing                                                                | PASS   | Reuses the right-sidebar override (R4), local-host guard and availability (generalized, R2), `SecretStore` codec (moved to a neutral module, R13), `writeFileDurable`, `hashWorktreeId`, tombstone/GC lifecycle, session tab persistence (`tab.apiClient` pattern), Monaco wrapper, clipboard bridge, CLI/RPC pattern of `orca api`, and Terax's `applyDefaultLimit` logic and tests |
| SSH use case considered                                                                    | PASS   | Local-only per spec; gated in the '+' menu and in every IPC/RPC handler (R2)                                                                                                                                                                                                                                                                                                         |
| Folder workspaces as well as git worktrees                                                 | PASS   | Project key covers both (`repo:` / `folder-workspace:`); folder-workspace removal deletes its data (R13)                                                                                                                                                                                                                                                                             |
| Remote wire compatibility                                                                  | PASS   | New RPC methods only; `sql` tabs not published to paired clients; session parse already tolerates unknown tab types (R3)                                                                                                                                                                                                                                                             |
| Cross-platform (paths, shortcuts, child processes, native modules)                         | PASS   | `path.join`; `CtrlCmd` in Monaco; no child processes; `pg` is pure JS (no glibc/ABI risk); socket-path locality uses `path.posix.isAbsolute` (unix sockets are macOS/Linux only)                                                                                                                                                                                                     |
| Electron UI validation in the background                                                   | PASS   | quickstart e2e uses `ORCA_BACKGROUND_LAUNCH=1`, CDP screenshots, no focus                                                                                                                                                                                                                                                                                                            |
| Agent status store                                                                         | N/A    | No agent-status producers                                                                                                                                                                                                                                                                                                                                                            |
| Git safety / Git compatibility / provider compatibility                                    | N/A    | No git commands added                                                                                                                                                                                                                                                                                                                                                                |
| File naming, `.ts` over `.d.ts`, checked types, no `max-lines` disables                    | PASS   | Domain names below (`sql-statement-splitter.ts`, `sql-batch-executor.ts`, …); zod parsing instead of casts; `pg` row types narrowed by schema; UI split into focused components                                                                                                                                                                                                      |
| Brief comments only                                                                        | PASS   | Implementation guidance                                                                                                                                                                                                                                                                                                                                                              |

**Post-design re-check (after Phase 1)**: PASS. The contracts add no agent write paths to Orca data, no repo files, no native modules, and no wire changes beyond new RPC methods. Additions that need justification are listed under Complexity Tracking.

## Project Structure

### Documentation (this feature)

```text
specs/002-sql-query-tab/
├── spec.md
├── plan.md              # This file
├── research.md          # Phase 0
├── data-model.md        # Phase 1
├── quickstart.md        # Phase 1
├── contracts/
│   ├── ipc-renderer-main.md
│   ├── cli-rpc.md
│   └── storage-format.md
├── checklists/requirements.md
└── tasks.md             # Phase 2 (/speckit-tasks — not created here)
```

### Source Code (repository root)

```text
src/shared/
├── tab-types.ts                                  # + 'sql'; + `sql?: SqlPersistedTab` on the unified tab
├── workspace-session-tab-type-schema.ts          # + 'sql'
├── sql-client/
│   ├── sql-client-types.ts                       # entities from data-model.md
│   ├── sql-client-schemas.ts                     # zod: storage files
│   ├── sql-client-ipc-schemas.ts                 # zod: IPC payloads + SqlClientFailure
│   ├── sql-statement-splitter.ts                 # quotes, $tag$, comments → { text, startOffset }[]
│   ├── sql-default-limit.ts                      # ported from Terax limit.ts (+ tests)
│   ├── sql-transaction-control.ts                # BEGIN/COMMIT/… and read-only-bypass detection
│   ├── sql-connection-locality.ts                # agentAccess: full | read-only
│   ├── pg-identifier-quoting.ts                  # "CaseManagement"."SurgicalCase"
│   └── result-grid-tsv.ts                        # range → TSV with header row
└── rpc-contract/sql-client-params.ts             # RPC zod params

src/main/
├── workspace-local-host-guard.ts                 # generalized from api-client-local-host-guard.ts
├── secret-value-codec.ts                         # sealSecretValue/openSecretCipher moved from api-client
└── sql-client/
    ├── sql-project-key.ts                        # worktreeId → repo:<id> | folder-workspace:<id>
    ├── sql-client-storage-paths.ts               # userData/sql-client/<hash>, meta.json
    ├── sql-client-store.ts                       # per-project cache, revisions, write-through, events
    ├── sql-client-data-deletion.ts               # tombstone + async removal
    ├── sql-client-data-gc.ts                     # startup orphan GC (catalog-based)
    ├── pg-client-factory.ts                      # pg.Client options: SSL modes, socket hosts, raw-text parsers
    ├── sql-session-manager.ts                    # per-tab sessions, connection status, reconnect-once, cancel
    ├── sql-batch-executor.ts                     # split → tx wrap → cursor last stmt → 50 MB stop
    ├── sql-type-names.ts                         # oid → format_type cache per connection
    ├── sql-schema-introspection.ts               # schemas / relations / columns queries
    ├── sql-agent-runner.ts                       # read-only wrap, statement_timeout, bypass rejection
    └── test-support/ (seed.sql, pg-test-database.ts)
src/main/ipc/sql-client/sql-client-ipc.ts         # contracts/ipc-renderer-main.md handlers
src/main/runtime/rpc/methods/sql-client.ts        # + register in methods/index.ts
src/main/ipc/repos/repo-catalog-handlers.ts       # + deleteProjectSqlData on repos:remove / removeForHost
src/main/runtime/runtime-repository-settings-controller.ts   # + deleteProjectSqlData
src/main/ipc/repos/project-host-setup-handlers.ts            # + deleteProjectSqlData on rollback removal
src/main/ipc/worktrees/removal/remove-folder-workspace.ts    # + delete folder-workspace SQL data
src/main/startup/…                                # drain tombstones + schedule GC (next to api-client GC)

src/preload/api/sql-client-api.ts (+ bridge)       # window.api.sqlClient

src/renderer/src/
├── lib/ensure-sql-tab.ts                         # modeled on ensure-api-client-tab.ts
├── lib/local-workspace-tab-availability.ts       # generalized from api-client-availability.ts
├── store/slices/sql-client.ts                    # project snapshots, per-tab runtime, subscriptions
├── store/slices/sql-client-tab-persistence.ts    # tab.sql draft write-through (like api-client-tab-persistence)
├── hooks/ipc-events/content-creation-ipc-bridge.ts   # + sqlClient:show
├── components/tab-bar/tab-create-menu-options.ts      # + 'new-sql' (+ the 'api-client' footprint)
├── components/right-sidebar/right-sidebar-panel-content.tsx  # dispatch: api-client | sql | routed panel
├── components/right-sidebar/sql-sidebar-selector.ts           # focused SQL tab → { worktreeId, tabId }
└── components/sql-client/
    ├── SqlPane.tsx                               # tab root: toolbar + editor/results split
    ├── toolbar/ (SqlToolbar, ConnectionSelect, SaveQueryDialog)
    ├── editor/SqlEditor.tsx                      # Monaco pgsql, run keybindings, error markers
    ├── results/ (SqlResultsGrid, ResultCell, ResultFooter, ResultStates, use-grid-selection.ts)
    └── sidebar/
        ├── SqlSidebarPanel.tsx                   # Connections | Schema | Saved Queries sections
        ├── ConnectionList.tsx, ConnectionFormDialog.tsx
        ├── SchemaBrowser.tsx
        └── SavedQueryTree.tsx, SavedQueryDialogs.tsx

src/cli/specs/sql-client.ts, src/cli/handlers/sql-client.ts   # orca sql connections|queries|run
skill-guides/ (bundled CLI guide update)                       # verify:bundled-skill-guides
tests/e2e/sql-client/                                          # Playwright scenarios from quickstart.md
```

**Structure Decision**: Follow Orca's existing split, exactly as feature 001 did: `src/shared` for pure logic and contracts, `src/main` for data and database execution, `src/preload` for the bridge, `src/renderer/src` for UI, `src/cli` for agent access. Tests sit next to their sources (`*.test.ts[x]`); e2e under `tests/e2e`. Two small refactors (local-host guard, secret codec) make API Client code shareable instead of copying it.

## Right side panel behavior (user direction)

| Focused tab   | Right side panel shows                                                                                                                                                                 |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sql`         | `SqlSidebarPanel`: **Connections** (status, connect/disconnect, edit, delete, add), **Schema** of the tab's connection, **Saved Queries** of that connection (collections + ungrouped) |
| `api-client`  | `ApiClientSidebarPanel` (unchanged)                                                                                                                                                    |
| anything else | the user's routed panel (Explorer, Source Control, …), unchanged                                                                                                                       |

The panel acts on the focused SQL tab: selecting a connection sets it on that tab; clicking a saved query loads it into that tab (with the unsaved-changes prompt of FR-026). The override is render-time only; the persisted `RightSidebarRoute` never changes. Creating a SQL tab from the '+' menu opens the right sidebar if it is collapsed (the connection list is needed to run anything); the API Client does not do this today, so it is a small SQL-only addition in `ensure-sql-tab.ts`. Afterwards the user's collapse choice is respected.

## Implementation Phasing (input to /speckit-tasks)

1. **Foundation (P1)**: refactors (local-host guard, secret codec), shared types/schemas, project key, storage + deletion + GC, `sql` tab type with '+' entry, right-sidebar dispatch with Connections section and connection form. Covers US5 and US1-1/US1-2.
2. **Run and read (P1)**: `pg` client factory, session manager, statement splitter, batch executor, default limit, size limit, cancel; Monaco editor, toolbar, results grid with states and footer. Covers US1.
3. **Copy (P1)**: cell copy, NULL handling, range/row/column TSV. Covers US2.
4. **Saved queries (P2)**: save/save-as/rename/move/delete, collections, unsaved marker, load-into-tab. Covers US3.
5. **Schema browser (P2)**: introspection queries, lazy tree, refresh, quoted-name copy. Covers US4.
6. **Agent access (P3)**: agent runner (locality, read-only, timeout, bypass rejection), RPC, CLI, skill guide. Covers US6.

## Complexity Tracking

| Addition                                                                                  | Why Needed                                                                                                         | Simpler Alternative Rejected Because                                                                                                          |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| New deps `pg` + `pg-cursor`                                                               | Orca has no PostgreSQL client; Terax's is Rust (`tokio_postgres`) and cannot be reused                             | `pg-native` is a native module (ABI rebuilds, glibc floor); shelling to `psql` is not installed everywhere and its output is fragile to parse |
| Client-side statement splitter                                                            | FR-015a needs to name the failed statement; streaming the last result needs one statement per cursor               | Sending the whole text through the simple protocol cannot identify the failing statement and buffers every result                             |
| Per-tab database sessions instead of a pool                                               | Two tabs on one connection must run independently with predictable `SET` state; cancel needs the exact backend pid | A shared pool makes session settings hop between tabs                                                                                         |
| Moving `sealSecretValue`/`openSecretCipher` and the local-host guard out of `api-client/` | Two features need them                                                                                             | Copying would create two definitions of "local workspace" and of secret sealing that can drift                                                |
