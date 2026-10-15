# Feature Specification: SQL Tab (PostgreSQL query client)

**Feature Branch**: `franktique/feat-postgress-line-tab`

**Created**: 2026-10-14

**Status**: Draft

**Input**: User description: "In /Users/franktique/frank/TERMINAL/frank-terax-ai I have a project called Terax, a custom version to which I've added things. One of them is a 'SQL' tab type inspired by Postgres that shows a side panel where connections and saved queries per connection are managed; in the main area the query is pasted in the top part and the result is shown in the bottom part, with a feature to copy data from the result cells. I want to add to this project a new tab type (just as I added the recent 'API Client') to do the same here in Orca."

## Clarifications

### Session 2026-10-14

- Q: Where do connections and saved queries live — per worktree, global, or mixed? → A: Per project: shared by every worktree of the same Orca project (repository or folder workspace), invisible to other projects, and deleted when the project is removed from Orca.
- Q: Which statements may agents run from the command line? → A: Any statement (including INSERT/UPDATE/DELETE/DDL) when the connection points to a local database; read-only queries only for any other connection.
- Q: When several statements run together and one fails, are earlier successful statements kept or rolled back? → A: All-or-nothing: a failure rolls back every statement in that run; the error names the failed statement and says nothing was applied.
- Q: Should agent command-line queries time out on their own? → A: Yes: 30-second default, changeable per command with a flag; the database cancels the query and the agent gets a timed-out error. UI queries have no limit.
- Q: How large may one query result get? → A: Stop loading rows once the result passes 50 MB; keep and show the rows loaded so far with a size-limit notice; cells stay complete; same limit for agents, flagged in their output.

## Product Context

The API Client tab (feature 001) named this tab as the next step of a future end-to-end smoke-test workflow: query the database before a request, send the request, query the database after, and save the evidence. That workflow is **not** part of this feature. This feature delivers the database tab itself, matching what the Terax SQL tab does today, and must not block that later workflow.

Reference behavior from Terax's SQL tab (layout and behavior, not visual style):

- Side panel: a list of connections (name, `host:port/database`, connection status dot, connect/disconnect, edit, delete), a schema browser for the selected connection (schemas → tables and views → columns with type, nullability, and primary-key marker), and the saved queries of the selected connection, optionally grouped in named collections.
- Main area: a toolbar (connection selector, New, Run, Save, name of the loaded saved query with an unsaved-changes dot), a SQL editor with syntax highlighting and line numbers on top, a resizable divider, and the results grid below.
- Running: Cmd/Ctrl+Enter or F5 runs the selected text, or the whole editor when nothing is selected. A bare `SELECT` without `LIMIT` gets a 1000-row cap, with a notice saying so.
- Results: column headers show name and data type; NULL is shown distinctly; clicking a cell (or pressing Enter/Space on it) copies its value, with brief "copied" feedback; a footer shows row count and elapsed time; errors are shown in place of the grid.
- The editor text of each open SQL tab is kept as a draft and restored after a restart.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Add a connection and run a query (Priority: P1)

A developer whose worktree runs a local PostgreSQL (typically in Docker) opens the '+' menu, chooses "New SQL", and adds a connection (name, host, port, user, password, database, SSL mode). They pick the connection in the tab, paste a query in the editor, press Cmd/Ctrl+Enter, and see the rows in the results grid below.

**Why this priority**: Running a query against a database and reading the result is the whole point of the tab; everything else builds on it.

**Independent Test**: With a reachable PostgreSQL database, open a SQL tab, add a connection, run `SELECT` on a table, and confirm the grid shows the same columns and rows as `psql` does.

**Acceptance Scenarios**:

1. **Given** any local worktree or folder workspace, **When** the user opens the '+' menu, **Then** a "New SQL" option is listed with the other tab types (next to "New API Client"), before the agent list.
2. **Given** an open SQL tab, **When** the user adds a connection with valid details, **Then** it appears in the right side panel's connection list showing its name and `host:port/database`, and the password is never shown again in readable form.
3. **Given** a selected connection that is not connected yet, **When** the user runs a query, **Then** the tab connects first and then runs the query, and the connection's status shows as connected.
4. **Given** text is selected in the editor, **When** the user presses Cmd/Ctrl+Enter (or F5, or the Run button), **Then** only the selection runs; with no selection the whole editor runs.
5. **Given** a `SELECT` with no `LIMIT`, **When** it runs, **Then** at most 1000 rows are returned and a notice says the limit was applied; a query with its own `LIMIT` runs unchanged.
6. **Given** a statement that returns no rows (e.g. `UPDATE`, `DELETE`, `INSERT`), **When** it runs, **Then** the result area says how many rows were affected.
7. **Given** a query with a syntax error, or a connection that fails (wrong password, host down), **When** the user runs it, **Then** the database's error message (with position/hint when available) is shown in the result area, and the tab stays usable.

---

### User Story 2 - Copy data from the results (Priority: P1)

While reading results, the developer clicks a cell to copy its value (an id, a timestamp, a JSON document) and pastes it into another query, a request in the API Client, or an agent prompt.

**Why this priority**: The user called this out explicitly; it is how query output moves into the rest of their workflow.

**Independent Test**: Run a query that returns text, numeric, JSON, timestamp, and NULL values; click each cell and paste into a text field; confirm the pasted text matches the stored value exactly.

**Acceptance Scenarios**:

1. **Given** a results grid, **When** the user clicks a cell (or focuses it and presses Enter/Space), **Then** its full value is copied to the clipboard and the cell briefly shows it was copied.
2. **Given** a cell longer than the column width, **When** the user hovers it, **Then** a tooltip shows the value (up to its first 2,000 characters), and copying copies the full value, not the truncated one.
3. **Given** a JSON/JSONB cell, **When** it is copied, **Then** the clipboard holds valid JSON text; **Given** a NULL cell, **Then** the grid shows it as `NULL` (styled differently from the text "NULL") and copying yields an empty string.
4. **Given** a results grid, **When** the user selects a range of cells, a whole row, or a whole column, **Then** they can copy it as tab-separated text with a header row, so it pastes as a table into a spreadsheet.

---

### User Story 3 - Save queries per connection (Priority: P2)

The developer saves useful queries under the current connection, optionally inside a named collection. Later they click a saved query in the right side panel and it loads in the editor with its connection selected, ready to run.

**Why this priority**: The user's day-to-day queries (e.g. the case-management cleanup in the reference screenshot) are reused constantly; without saving, they are retyped.

**Independent Test**: Save two queries under one connection (one in a collection), restart the app, select each one from the right side panel, and confirm the editor shows the saved text with the right connection selected.

**Acceptance Scenarios**:

1. **Given** a non-empty editor and a selected connection, **When** the user presses Save, **Then** they are asked for a name (prefilled from the first characters of the query) and an optional collection, and the query appears under that connection in the right side panel.
2. **Given** a saved query loaded in the editor, **When** the user edits it, **Then** an unsaved-changes marker appears next to its name; **When** they press Save, **Then** the saved query is updated in place; **When** they choose Save As (Alt/Option + Save), **Then** a new saved query is created.
3. **Given** saved queries, **When** the user renames, deletes (with confirmation), or moves a query to another collection, **Then** the right side panel reflects it immediately.
4. **Given** collections of a connection, **When** the user creates, renames, expands/collapses, or deletes a collection, **Then** deleting asks for confirmation and states what happens to its queries.
5. **Given** a different connection is selected in the right side panel, **When** the user looks at Saved Queries, **Then** only that connection's queries and collections are listed.

---

### User Story 4 - Browse the database structure (Priority: P2)

With a connection open, the developer expands the schema browser in the right side panel to find a table and its columns (type, nullable, primary key) without writing catalog queries.

**Why this priority**: Writing queries against schemas such as `"CaseManagement"."SurgicalCase"` needs exact, case-sensitive table and column names.

**Independent Test**: Connect to a database with several user schemas; expand a schema and a table and confirm the tables, views, and columns match the database; create a table elsewhere, press Refresh, and confirm it appears.

**Acceptance Scenarios**:

1. **Given** a connected connection, **When** the user opens the schema browser, **Then** user schemas are listed (system schemas hidden); expanding a schema lists its tables and views marked by kind; expanding a table lists its columns with type, nullability, and a primary-key marker.
2. **Given** the database structure changed, **When** the user presses Refresh, **Then** the browser reloads it.
3. **Given** a table or column in the browser, **When** the user activates its copy action, **Then** its correctly quoted name (e.g. `"CaseManagement"."SurgicalCase"`) is copied for use in a query.

---

### User Story 5 - Work survives restarts and stays out of the repository (Priority: P1)

Connections, saved queries, and collections belong to the Orca project and are shared by all of its worktrees; the editor text of each open SQL tab belongs to that tab. All of it is kept in Orca's own data, outside the repository's working files, and survives app restarts. Passwords are stored encrypted.

**Why this priority**: Losing drafts or connections on restart, or leaking a database password into a commit, would make the tab unsafe or useless.

**Independent Test**: Add a connection, save a query, type an unsaved draft in a second SQL tab, restart the app; confirm everything is restored, the source control panel shows no new or changed files, and the password does not appear as readable text in Orca's data files.

**Acceptance Scenarios**:

1. **Given** saved connections, queries, and open SQL tabs with drafts, **When** the app restarts, **Then** connections, queries, collections, each tab's editor text, and each tab's selected connection are restored (connections start disconnected).
2. **Given** any amount of SQL tab use, **When** the user looks at source control, **Then** no file related to it appears.
3. **Given** a saved connection, **When** its data is stored, **Then** the password is encrypted at rest and the user is never asked for a master password or OS permission prompt.
4. **Given** a SQL tab is closed, **When** the user reopens a new SQL tab, **Then** the closed tab's unsaved draft is gone (only saved queries remain).
5. **Given** a project with two worktrees, **When** the user adds a connection or saves a query in one, **Then** it is also listed in the other worktree's SQL tabs; **Given** a different project, **Then** it is not listed there.
6. **Given** a project with SQL data, **When** the project is removed from Orca, **Then** its connections, passwords, saved queries, and collections are deleted; removing only one of its worktrees deletes nothing but that worktree's open-tab drafts.

---

### User Story 6 - Agents run queries from the command line (Priority: P3)

An agent working in the worktree (or the developer in a terminal) lists the available connections and saved queries with `orca`, runs a query on a chosen connection, and reads the result as structured data. This is the hook the future smoke-test workflow needs.

**Why this priority**: The UI is fully useful without it, but the planned smoke-test workflow depends on it.

**Independent Test**: From a terminal in the worktree, list connections, run a saved query and an ad-hoc `SELECT`, and confirm the output contains columns and rows matching the UI, with no password in the output.

**Acceptance Scenarios**:

1. **Given** saved connections, **When** an agent lists them, **Then** it gets each connection's id, name, host, port, database, and user, never the password.
2. **Given** a connection id and a query (ad-hoc text or a saved query id), **When** an agent runs it, **Then** it gets columns with types, rows, row count or affected-row count, and elapsed time, or the database error.
3. **Given** a connection to a local database, **When** an agent runs any statement (including `INSERT`, `UPDATE`, `DELETE`, or DDL), **Then** it runs and the agent gets the affected-row count or result.
4. **Given** a connection to a non-local database, **When** an agent runs a statement that writes or changes the database, **Then** the database rejects it because the session is read-only, the agent gets an error saying agents only have read access to non-local connections, and nothing changes; read-only queries run normally.
5. **Given** any agent command, **When** it tries to create, edit, or delete connections or saved queries, **Then** no such command exists.
6. **Given** agents list connections, **When** the list is returned, **Then** each connection says whether agents have full or read-only access to it.
7. **Given** an agent query that runs longer than its time limit (30 seconds unless the command sets another), **When** the limit is reached, **Then** the database cancels it, the running statement and any open transaction are rolled back (anything already committed by explicit transaction control in that run stays, per FR-015a), and the agent gets a timed-out error.

---

### Edge Cases

- A query returns many rows or very wide rows (e.g. 1000 rows × 40 columns, or multi-MB JSON cells): the grid scrolls in both directions with sticky headers and stays responsive; very long cell values are truncated in the grid but copied in full. If the result passes 50 MB in total, no further rows are loaded and a notice says the size limit was reached (see FR-012a).
- The editor contains several statements separated by `;` (as in the reference screenshot) and nothing is selected: they run in order as one all-or-nothing batch: execution stops at the first error, every earlier statement in that run is rolled back, and the error names the failed statement and says nothing was applied; on success the result of the last statement is shown. Explicit `BEGIN`/`COMMIT` in the text is honored as written instead: anything committed before the error stays, and the error says which statements already ran (FR-015a). Selecting one statement runs only that one.
- A long-running query: the user can cancel it from the toolbar; the tab shows it is running and does not freeze; other SQL tabs keep working.
- The connection drops (database container restarted): if the drop is detected before any statement of the next run is sent, that run reconnects automatically once; if the reconnect fails, or the connection drops after statements were sent (so they may have run), there is no automatic retry and the error says the connection was lost.
- A connection is deleted while SQL tabs use it: those tabs fall back to "No connection" and keep their editor text; its saved queries and collections are deleted with it after a confirmation that says how many there are.
- Two SQL tabs use the same connection: both can run queries independently; saving a query in one updates the right side panel for both.
- A query is changed outside the open tab (renamed/deleted from the right side panel while loaded): the tab keeps its editor text and simply stops being linked to the deleted query.
- Values of PostgreSQL types that have no plain JSON form (bytea, intervals, arrays, geometric types, numeric with high precision, timestamps with time zone): shown and copied as PostgreSQL's own text form, without losing precision.
- SSL mode "require" against a server with a self-signed certificate (common for Docker/local): the connection succeeds; with "disable" against a server that requires SSL, the error says SSL is required.
- Stored passwords cannot be decrypted (e.g. data copied to another machine): the connection shows "re-enter password" and everything else loads.
- The operating system cannot encrypt secrets (e.g. Linux without a keyring): passwords are kept only while the app runs, and the connection form says why and how to fix it — the same rule as API Client secrets.
- A remote (SSH) worktree: the "New SQL" option is hidden or disabled with a note that it is only available for local worktrees (same as the API Client).
- A folder workspace (not a git worktree): the tab behaves the same; the folder workspace is its own project.
- A project is removed outside Orca (e.g. the repository folder is deleted manually): its SQL data stays until the project is removed from Orca, so nothing is lost by a temporary move.
- A connection's host is a name that resolves to the local machine but is not a loopback address or `localhost` (e.g. the machine's LAN IP or `host.docker.internal`): it is treated as non-local for agent access.
- A connection is edited from a local host to a remote one: agent access becomes read-only from the next agent query.

## Requirements _(mandatory)_

### Functional Requirements

**Tab and layout**

- **FR-001**: The '+' new-tab menu MUST offer a "New SQL" option in the same group as the existing tab types (next to "New API Client"), above the agent list.
- **FR-002**: The SQL tab MUST be available only for local worktrees and folder workspaces; for remote (SSH) worktrees the option MUST NOT open a SQL tab. Connections are always made from the local machine.
- **FR-003**: When the active tab is a SQL tab, the right side panel MUST show the SQL panel (Connections, Schema, Saved Queries) in place of its usual content, in the same right side panel the API Client uses; other tab types keep their right side panel.
- **FR-004**: The main area MUST show a toolbar, an editor on top, and the results below, separated by a draggable divider; the split position is kept per tab.
- **FR-005**: Users MUST be able to open several SQL tabs; each has its own editor text, selected connection, and last result.

**Connections**

- **FR-006**: Users MUST be able to create, edit, and delete PostgreSQL connections with: name, host, port (default 5432), user, password, database, and SSL mode (disable, prefer, require). Editing without retyping the password keeps the stored one.
- **FR-007**: Each connection MUST show a status (idle, connecting, connected, error) in the right side panel and in the toolbar selector, with connect/disconnect actions.
- **FR-008**: Connection passwords MUST be stored encrypted at rest, never as readable text, using the same transparent protection as API Client secrets (no password or permission prompt). If they cannot be decrypted, the connection asks for the password again.
- **FR-009**: Deleting a connection MUST ask for confirmation and delete its saved queries and collections with it.

**Editor and running**

- **FR-010**: The editor MUST provide PostgreSQL syntax highlighting and line numbers, and follow Orca's light/dark theme.
- **FR-011**: Cmd/Ctrl+Enter, F5, and the Run button MUST run the selected text, or the whole editor when nothing is selected. Run is disabled when no connection is selected, with a hint saying so.
- **FR-012**: A single `SELECT` or `WITH` query without its own `LIMIT` MUST be capped at 1000 rows, and the result MUST say the cap was applied. Writing an explicit `LIMIT` bypasses the cap. A `WITH` query whose outer statement is not a `SELECT` (e.g. `WITH … DELETE`, `WITH … UPDATE`) is not capped.
- **FR-012a**: A result MUST stop loading rows once its total size passes 50 MB; the rows already loaded are shown, each cell complete and copyable in full, with a notice that the size limit was reached. The same limit applies to agent queries, and their output MUST flag it. An explicit `LIMIT` does not bypass it.
- **FR-013**: Users MUST be able to cancel a running query; the database stops the work and the tab reports it was cancelled.
- **FR-014**: The "New" action MUST clear the editor and result and unlink any loaded saved query, keeping the selected connection.
- **FR-015**: Errors MUST show the database's message, plus its position, detail, and hint when provided.
- **FR-015a**: A run containing several statements and no explicit transaction control MUST execute as one all-or-nothing batch: if any statement fails, none of the run's changes are kept, and the error identifies the failed statement and states that nothing was applied. When the run contains explicit transaction control (`BEGIN`, `COMMIT`, `ROLLBACK`, `SAVEPOINT`, …), statements run exactly as written, execution stops at the first error, and the error identifies the failed statement and lists the statements that already ran. This applies to agent queries too.

**Results**

- **FR-016**: Results MUST show a grid with a sticky header row where each column shows its name and data type; rows scroll vertically and columns horizontally.
- **FR-017**: NULL MUST be displayed distinctly from a text value "NULL"; every other value, JSON included, MUST be shown in PostgreSQL's own text form (as `psql` prints it).
- **FR-018**: Clicking a cell, or pressing Enter/Space on a focused cell, MUST copy the cell's full value to the clipboard with brief visual feedback. Copying NULL yields an empty string.
- **FR-019**: Users MUST be able to select a range of cells, rows, or a column and copy it as tab-separated text including column names.
- **FR-020**: A footer MUST show the row count (or affected rows for statements without result rows) and the elapsed time.
- **FR-021**: The result area MUST show a clear empty state ("Run a query with Cmd/Ctrl+Enter or F5"), a running state, and an error state.

**Saved queries and collections**

- **FR-022**: Users MUST be able to save the editor text as a named query under the selected connection, optionally in a collection; Save updates a loaded query in place and Save As creates a new one.
- **FR-023**: The toolbar MUST show the name of the loaded saved query and an unsaved-changes marker when the editor differs from it.
- **FR-024**: The right side panel MUST list the selected connection's saved queries, grouped in expandable collections plus ungrouped queries, each showing its name and the start of its text.
- **FR-025**: Users MUST be able to rename, delete (with confirmation), and move queries between collections, and create, rename, and delete collections.
- **FR-026**: Selecting a saved query MUST load its text into the active SQL tab and select its connection; if the editor has unsaved changes to a different loaded query, the user is asked to save or discard first.

**Schema browser**

- **FR-027**: For a connected connection, the right side panel MUST show user schemas, their tables and views (marked by kind), and each table's columns with type, nullability, and primary-key marker, loaded on expand and refreshable.
- **FR-028**: Users MUST be able to copy a schema, table, or column name, quoted as PostgreSQL requires.

**Persistence**

- **FR-029**: Connections, saved queries, collections, and each open SQL tab's editor text and selected connection MUST be stored in Orca's own data, never inside the repository's working files, and MUST survive app restarts and branch changes. Drafts are saved automatically while typing.
- **FR-030**: Connections, saved queries, and collections MUST belong to one Orca project (a repository or folder workspace added to Orca): shared by all of that project's worktrees, not visible from other projects, and deleted when the project is removed from Orca. Deleting a worktree MUST NOT delete them.
- **FR-031**: Closing a SQL tab MUST discard its draft; saved queries are unaffected.

**Agent and command-line access**

- **FR-032**: Agents and the Orca command line MUST be able to list the current project's connections (without passwords) and saved queries, and run an ad-hoc query or a saved query on a connection, getting structured results (columns with types, rows, counts, elapsed time, or the error).
- **FR-032a**: A connection MUST count as local when its host is `localhost`, a loopback address (`127.0.0.0/8`, `::1`), or a local socket path. On local connections agents MAY run any statement; on every other connection, agent queries MUST run in a read-only session so the database itself rejects writes and schema changes, and an agent run whose text contains transaction control (`BEGIN`, `COMMIT`, `ROLLBACK`, `SAVEPOINT`, …) or a setting that could turn read-only off (`SET`/`RESET` of `transaction_read_only` or `default_transaction_read_only`, `RESET ALL`, `SET SESSION CHARACTERISTICS`) MUST be rejected before anything is sent, with the read-only access error; on these connections FR-015a's explicit-transaction behavior does not apply to agents. The 1000-row cap (FR-012) also applies to agent queries.
- **FR-032b**: Agent queries MUST time out after 30 seconds by default, changeable per command; the limit covers the whole run (all of its statements together), not each statement separately. On timeout the database cancels the running statement, the statement and any open transaction are rolled back (anything already committed by explicit transaction control in that run stays, per FR-015a), and the agent gets a clear timed-out error. Queries run from the UI have no time limit (the user cancels them per FR-013).
- **FR-033**: Agents and the Orca command line MUST NOT be able to create, edit, or delete connections, saved queries, or collections.
- **FR-034**: Every connection, saved query, and collection MUST have a stable identifier that does not change across restarts or edits, so an external caller can address it.

### Key Entities

- **Project SQL Data**: The container that ties connections, saved queries, and collections to one Orca project's lifetime.
- **Connection**: A named PostgreSQL target: host, port, user, database, SSL mode, encrypted password, live status (not persisted), and agent access level derived from the host (full when local, read-only otherwise). Belongs to one project; owns its saved queries and collections.
- **Saved Query**: Named SQL text belonging to one connection, optionally in one collection; created/updated times; stable identifier.
- **Query Collection**: A named group of saved queries within one connection.
- **SQL Tab Draft**: The unsaved editor text, selected connection, and linked saved query of one open SQL tab; lives as long as the tab.
- **Query Result**: Columns (name, type), rows, row or affected count, elapsed time, whether the row cap or the 50 MB size limit was applied, or an error. Kept in memory per tab; not persisted.
- **Schema Snapshot**: Cached schemas, tables/views, and columns of a connection, refreshed on demand.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: A user can go from opening the '+' menu to seeing the rows of their first query on a new connection in under 1 minute.
- **SC-002**: For a sample of text, numeric, JSON, timestamp-with-time-zone, array, and NULL values, 100% of copied cells paste exactly as `psql` prints them (NULL as empty).
- **SC-003**: A 1000-row × 40-column result appears and scrolls without visible lag, and the tab stays responsive while a long query runs.
- **SC-004**: After any amount of use, the worktree shows 0 new or changed files in source control due to this feature, and no database password appears as readable text in Orca's data.
- **SC-005**: 100% of connections, saved queries, collections, and open-tab drafts are restored after an app restart.
- **SC-006**: A user who uses Terax's SQL tab can perform every action listed in Product Context in Orca without instructions.
- **SC-007**: 100% of agent write attempts on non-local connections are rejected with no change to the database, and 100% of agent writes on local connections succeed.

## Assumptions

- Only PostgreSQL is in scope; MySQL, SQLite, SQL Server, and others are out of scope for this version.
- Connection parameters are entered field by field; pasting a connection URL (`postgres://…`), SSH tunnels, and client certificates are out of scope for v1.
- SSL mode "require" accepts the server's certificate without verifying it (as Terax does, to work with local Docker databases); "prefer" tries SSL without verifying the certificate and falls back to an unencrypted connection when the server does not support SSL (as libpq does). Certificate verification modes (`verify-ca`, `verify-full`) are out of scope for v1.
- Results are not persisted; reopening a tab after restart shows its draft but not its last result.
- Results are read-only: editing cells in the grid, exporting to CSV/JSON files, query history, autocomplete, and visual query plans are out of scope; copying (FR-018, FR-019) covers moving data out.
- Destructive statements (`DELETE`, `DROP`, `TRUNCATE`) run without an extra confirmation, as in Terax and `psql`; the user is responsible for the target connection.
- Remote (SSH) worktrees are out of scope, as for the API Client.
- The existing right side panel used by the API Client is reused for the SQL panel, rather than Terax's left panel.
- Importing Terax's existing connections and saved queries is out of scope; the user recreates them.
- The UI follows Orca's design system; the Terax screenshot describes layout and behavior, not the look.
