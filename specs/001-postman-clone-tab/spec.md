# Feature Specification: API Client Tab (Postman-compatible)

**Feature Branch**: `franktique/feat-postman-clone-tab`

**Created**: 2026-10-02

**Status**: Draft

**Input**: User description: "Add a new tab type, offered by the '+' new-tab menu next to the existing tab types and before the agent list, that works like a Postman clone: a side panel listing collections and environments; import and use Postman collections and environments; a main view to compose a request, pick the active environment, see the response, and a collapsible console below with each request's details; an environment editor with vertical scrolling; a Run action on a collection folder that opens a runner view to execute every request/test in it. Collections and environments belong to the worktree's Orca metadata, are never committed to the repository, persist while the worktree exists, and are deleted together with the worktree."

## Clarifications

### Session 2026-10-02

- Q: Should agents running in the worktree be able to read and run the API Client's collections and environments? → A: Yes, read and run only: agents can list collections/environments, run a request or a folder and get the results, but cannot edit data or see secret values.
- Q: Should this feature include a command that captures a screenshot of a request's view? → A: No. It includes only a command that makes the API Client tab open and display a given request and its latest result; image capture belongs to the future smoke-test feature.
- Q: Should an API Client tab hold several open requests in inner sub-tabs, or show one request at a time? → A: One request per tab, replaced when another is selected in the side panel; each request keeps its latest result, shown again whenever the request is reselected, until it is run again.
- Q: How should secret variable values be stored on disk? → A: Encrypted at rest, transparently: the user is never asked for a password, key, or system permission prompt (same experience as Postman's secret values).
- Q: What certificate and proxy handling is needed for outgoing requests? → A: An SSL certificate verification switch (global, on by default, overridable per request) and automatic use of the operating system's proxy; custom CA files, client certificates, and manual proxy settings are out of scope for v1.

## Product Context

This tab is the first step toward an end-to-end smoke-test workflow that is **not** part of this feature:

1. A later tab will connect to a database (typically PostgreSQL started from Docker) to run queries.
2. A later feature, likely driven by an agent skill through the Orca command line, will run a full collection as a smoke test: for each request, query the database before, send the request, query the database after, and save evidence (screenshots of queries and results from the database tab and of the request/response from this tab) to a Markdown file.

This feature must not build that workflow, but it must not block it: individual requests must be runnable one at a time by an external caller, results must be readable outside the UI, and any request's result must be displayable in the tab on demand so it can be captured. Background evidence capture (off-screen rendering, or evidence generated from result data) is the smoke-test feature's responsibility; this feature only guarantees results are readable outside the UI.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Import a Postman collection and environment into a worktree (Priority: P1)

A developer working on a worktree has a Postman collection and environment exported to files (for example a smoke-test collection with nested folders, request headers that reference `{{variables}}`, raw JSON bodies, and test scripts). From the new API Client tab they import both files. The collection appears in the side panel as a folder tree identical to Postman's, and the environment appears in the environment list.

**Why this priority**: Nothing else in the feature is usable without data in it, and the user's main need is to reuse existing Postman files rather than rebuild them.

**Independent Test**: Open an API Client tab, import the sample collection and environment files, and confirm every folder, request name, and environment variable shown in Postman is present with the same names, order, and nesting.

**Acceptance Scenarios**:

1. **Given** a worktree with no API data, **When** the user opens the '+' menu, **Then** an "API Client" option is listed together with the other tab types, before the agent list.
2. **Given** an open API Client tab, **When** the user imports a Postman v2.1 collection file, **Then** the side panel shows the collection with all folders and requests in the original order and nesting.
3. **Given** an open API Client tab, **When** the user imports a Postman environment file, **Then** the environment appears in the environments list with all of its variables, and variables marked secret are masked by default.
4. **Given** a file that is not a valid Postman collection or environment, **When** the user tries to import it, **Then** the import is rejected with a message that says what is wrong, and no existing data changes.

---

### User Story 2 - Send a request with an environment and inspect the result (Priority: P1)

The developer selects a request in the side panel. The main area shows the method, URL, params, headers, body, and scripts. The developer picks the active environment from a selector, sends the request, and sees the response status, time, size, headers, and body (formatted for JSON). Below, a collapsible console lists each request sent, with the resolved URL, request headers and body, response headers and body, and any script log output. Each console entry can be expanded or collapsed.

**Why this priority**: Sending requests and reading responses is the core value of an API client.

**Independent Test**: With the sample data imported and an environment selected, send one request and confirm that `{{variables}}` were replaced with the environment's values, that the response is shown, and that the console has an entry with the full request/response details.

**Acceptance Scenarios**:

1. **Given** a request whose URL and headers use `{{baseUrl}}` and `{{tenantId}}`, **When** the user sends it with an environment that defines both, **Then** the request goes to the resolved URL with resolved headers.
2. **Given** a request that uses a variable the active environment does not define, **When** the user looks at the request, **Then** the unresolved variable is visibly highlighted; **When** they send it, **Then** the console shows the literal unresolved text.
3. **Given** a request has test scripts, **When** the response arrives, **Then** a Tests result area shows each test with pass/fail, and any `console.log` output from the scripts appears in the console.
4. **Given** the console holds several entries, **When** the user collapses an entry or the whole console, **Then** the details are hidden and the request/response area gets the freed space.
5. **Given** the target server is unreachable or times out, **When** the user sends the request, **Then** a readable error appears in the response area and in the console, and the tab remains usable.
6. **Given** the user edited a request (URL, headers, body, or scripts), **When** they save, **Then** the change is kept and still there after the app restarts.

---

### User Story 3 - Edit environments (Priority: P2)

The developer opens an environment from the side panel and sees an editable table of variables (enabled checkbox, name, value, type default/secret) that scrolls vertically when there are many rows. They can add, edit, disable, and delete variables, and create, rename, duplicate, and delete environments.

**Why this priority**: Environments change often (new tokens, new IDs after a reseed), and editing them in the app avoids re-importing.

**Independent Test**: Open the sample environment (27 variables), scroll to the last variable, change a value, save, send a request that uses it, and confirm the new value was used.

**Acceptance Scenarios**:

1. **Given** an environment with more variables than fit on screen, **When** the user opens it, **Then** the variable table scrolls vertically while its header row and save action stay visible.
2. **Given** a secret variable, **When** the user views the table, **Then** the value is masked until the user reveals it.
3. **Given** unsaved changes in an environment, **When** the user tries to close it, **Then** they are asked to save or discard.

---

### User Story 4 - Run a folder or a whole collection (Priority: P2)

The developer right-clicks (or uses the "…" menu on) a collection or folder and chooses Run. A runner view opens listing every request in that scope in execution order, each with a checkbox to include or exclude it, plus the environment to use and run options (iterations, delay between requests, stop on first failure). Pressing Run executes the requests in order and shows live progress: each request's status code, time, and test results, with totals of passed and failed tests. The developer can filter results to passed or failed and open any result to see its full request/response.

**Why this priority**: The user's collections are structured test suites (e.g. groups G1–G10 for two services); running a whole folder and seeing pass/fail is how they verify a change.

**Independent Test**: Run the "MAIN" folder of the sample collection against an environment and confirm every included request runs once in order, each test's pass/fail result is shown, and totals match the per-request results.

**Acceptance Scenarios**:

1. **Given** a folder with nested subfolders, **When** the user chooses Run on it, **Then** the runner lists all requests inside it, depth-first in the collection's order, all selected by default.
2. **Given** the runner is configured, **When** the user starts the run, **Then** requests run one at a time in the listed order and results appear as each one finishes.
3. **Given** a run in progress, **When** the user stops it, **Then** no further requests start and the requests already finished keep their results.
4. **Given** a run that finished, **When** the user views the summary, **Then** it shows total requests, passed tests, failed tests, and total time, and failed tests are listed with their failure messages.
5. **Given** a test script sets an environment variable (for example a token or ID from the response), **When** a later request in the same run uses that variable, **Then** it receives the value set by the earlier request.

---

### User Story 5 - Data lives with the worktree, not the repository (Priority: P1)

Collections, environments, and run history for a worktree are kept in Orca's own per-worktree data, outside the repository's working files. They never show up as changes in source control, survive app restarts and branch switches, and are deleted when the worktree is deleted from Orca.

**Why this priority**: This is an explicit user requirement; leaking test tokens into a commit, or losing data on restart, would make the feature unsafe or useless.

**Independent Test**: Import data into a worktree, confirm the source control panel shows no new or changed files, restart the app and confirm the data is still there, then delete the worktree and confirm the data is gone.

**Acceptance Scenarios**:

1. **Given** imported collections and environments, **When** the user looks at the source control changes, **Then** no file related to them appears.
2. **Given** saved API data, **When** the app is restarted or the worktree switches branch, **Then** the same collections, environments, and active environment selection are restored.
3. **Given** a worktree with API data, **When** the worktree is deleted through Orca, **Then** its API data is deleted too.
4. **Given** two worktrees of the same repository, **When** the user imports data in one, **Then** the other worktree's API Client does not show it.

---

### User Story 6 - Export back to Postman (Priority: P3)

The developer exports a collection or environment from the side panel to a Postman-format file so the edits made in Orca can be shared or reopened in Postman.

**Why this priority**: Keeps the data portable, but the core workflow does not need it.

**Independent Test**: Import the sample collection, change one request, export it, and import the exported file into Postman (or back into Orca) without errors and with the change present.

**Acceptance Scenarios**:

1. **Given** an imported collection, **When** the user exports it without changes, **Then** the exported file has the same folders, requests, headers, bodies, scripts, and variables as the original.

---

### User Story 7 - Agents read and run API data from the command line (Priority: P2)

An agent working in the worktree (or the developer in a terminal) lists the worktree's collections and environments with `orca`, runs a request, folder, or collection with a chosen environment, reads the structured results, and asks the API Client tab to display a request and its latest result. The agent can never change the data or see secret values.

**Why this priority**: This is the hook for the future smoke-test workflow (see Product Context); the UI works without it.

**Independent Test**: From a terminal in the worktree, list collections, run the "MAIN" folder, and confirm the results contain every request's status and tests with secrets shown as `••••`, the console shows the requests marked as agent-initiated, and asking to show one request opens the tab on it.

**Acceptance Scenarios**:

1. **Given** imported data, **When** an agent lists collections, **Then** it gets the folder/request tree with stable ids and no secret values.
2. **Given** a folder id, **When** an agent runs it, **Then** it gets per-request status, time, headers, body, and per-test results, with secrets masked, and the command reports failure if any test failed.
3. **Given** an agent-started run, **When** the user opens the API Client tab, **Then** the console entries are marked agent-initiated and each request shows the agent's result as its latest result.
4. **Given** any agent command, **When** it tries to create, edit, or delete data, **Then** no such command exists.
5. **Given** a request id, **When** an agent asks to show it, **Then** the API Client tab of that worktree displays that request with its latest result, without switching the window away from the worktree the user is viewing.

---

### Edge Cases

- Importing a collection with the same name as an existing one: the user chooses to replace it or keep both (the new one gets a suffix).
- Postman features the app does not support (e.g. specific auth helpers or script APIs): the import still succeeds, unsupported items are listed in an import warning, and running such a script reports a clear "not supported" error instead of failing silently.
- Very large responses (several MB) or binary responses: shown truncated or as a download/size notice without freezing the tab.
- A test script throws an error: that request's tests are marked failed with the error message; the run continues unless "stop on first failure" is set.
- A request is edited while a run that includes it is in progress: the run uses the version that was in place when the run started.
- The same worktree has several API Client tabs open: edits saved in one are reflected in the others. A tab with no unsaved edits for the changed item refreshes right away. A tab with unsaved edits keeps them and shows a "changed in another tab" notice; saving there gets a conflict, and the user picks Reload (discard their edits) or Cancel. The active environment and latest results show the same in every tab.
- A folder workspace (not a git worktree): the feature behaves the same, and the data is deleted when the workspace is removed from Orca.
- A worktree on a remote (SSH) host: the API Client is not offered (the '+' menu option is hidden or disabled with a note that it is only available for local worktrees).
- The worktree is deleted outside Orca (e.g. folder removed manually): orphaned API data is cleaned up the next time Orca notices the worktree is gone.
- The operating system cannot encrypt secrets (e.g. a Linux desktop with no keyring): secret values are kept only while the app is open, never written to disk, and the environment editor shows a notice explaining why and how to fix it. After a restart those variables show the "re-enter value" notice (FR-009b). If the OS offers only weak protection (Linux `basic_text`), values are saved but the same notice explains they are not truly protected.

## Requirements _(mandatory)_

### Functional Requirements

**Tab and layout**

- **FR-001**: The '+' new-tab menu MUST offer an "API Client" option in the same group as the existing tab types, above the list of agents.
- **FR-001a**: The API Client MUST only be available for worktrees and folder workspaces on the local machine; for remote (SSH) worktrees the option MUST NOT open an API Client tab. Requests are always sent from the local machine.
- **FR-002**: When the active tab is an API Client tab, the right side panel MUST show the worktree's collections and environments in place of its usual content; other tab types MUST keep their current side panel.
- **FR-003**: Users MUST be able to open more than one API Client tab per worktree; all of them share the same worktree data.
- **FR-003a**: Each API Client tab MUST show one request at a time (no inner sub-tabs). Selecting another request in the side panel replaces the current one in the active API Client tab; if the current request has unsaved edits, the user is asked to save or discard first. To see two requests side by side, the user opens another API Client tab.
- **FR-003b**: Each request MUST keep its latest result (response, test results, time, and whether it came from a manual send, a run, or an agent). The result is shown whenever the request is displayed again, in any API Client tab, and is replaced only when the request runs again. Latest results persist across app restarts with the rest of the worktree's API data.

**Collections**

- **FR-004**: Users MUST be able to import Postman Collection v2.0 and v2.1 files, keeping folder nesting, order, names, descriptions, and request methods, URLs, query params, headers, bodies (raw, form-data, x-www-form-urlencoded), auth settings, collection/folder variables, and pre-request and test scripts at collection, folder, and request level.
- **FR-005**: Users MUST be able to create, rename, duplicate, move, and delete collections, folders, and requests.
- **FR-006**: The collection tree MUST show each request's HTTP method next to its name, support expanding and collapsing folders, and support searching requests by name.

**Environments**

- **FR-007**: Users MUST be able to import Postman environment files, keeping each variable's name, value, enabled state, and type (default or secret).
- **FR-008**: Users MUST be able to create, rename, duplicate, edit, and delete environments, and add, edit, enable/disable, and delete variables in a table that scrolls vertically.
- **FR-009**: Secret variable values MUST be masked in the environment editor and the request view unless the user explicitly reveals them. Console entries, latest results, and run results always show them masked (FR-009c).
- **FR-009a**: Secret variable values MUST be stored encrypted on disk, never as readable text in the worktree's API data. Encryption MUST be transparent: the user is never asked for a password, key, or operating-system permission to save or use secrets.
- **FR-009b**: If stored secrets cannot be decrypted (e.g. the API data was copied to another machine), the affected variables MUST show as empty with a "re-enter value" notice; the rest of the data loads normally.
- **FR-009c**: Wherever a secret variable's value appears in console entries, saved latest results, saved runs, or agent/CLI output, it MUST be replaced with `••••`, including when the value is part of a longer text: resolved URL, request headers and body, response headers and body, and script log output. Masking MUST also cover the URL-encoded and JSON-escaped forms of the value, and a Basic auth header built from a secret password MUST be masked as a whole (`Basic ••••`). Values shorter than 4 characters are masked only when they fill a whole field.
- **FR-010**: Users MUST be able to select one active environment (or none) for the worktree; the selection is shared by all API Client tabs of that worktree and persisted.

**Sending requests**

- **FR-011**: Users MUST be able to edit a request's method, URL, query params, headers, body, auth, pre-request script, and test script, and save the changes.
- **FR-012**: Before sending, the system MUST replace `{{name}}` references in URL, params, headers, body, and auth with values from (narrowest first) request-time script variables, the active environment, folder variables, and collection variables.
- **FR-013**: The request view MUST visibly mark variable references that do not resolve with the current environment.
- **FR-014**: After a response, the system MUST show status code and text, response time, response size, response headers, and the body, formatting JSON for reading, with a Pretty/Raw toggle always available (very large bodies may open in Raw by default).
- **FR-015**: The system MUST run pre-request scripts before sending and test scripts after receiving, supporting at least the commonly used Postman script features: defining tests, assertions on status/body/headers, reading the response as JSON or text, reading and setting environment and collection variables, and logging to the console.
- **FR-016**: Test results MUST be shown per request as a list of named tests with pass/fail and the failure message.
- **FR-017**: Users MUST be able to cancel a request that is in flight.
- **FR-017a**: SSL certificate verification MUST be on by default, with an app-wide switch in Orca settings to turn it off and a per-request setting that overrides the app-wide one. When a request fails because of a certificate, the error MUST say so and point to the switch.
- **FR-017b**: Requests MUST go through the operating system's configured proxy when one is set, without extra configuration in the API Client.

**Console**

- **FR-018**: The tab MUST include a console below the request/response area that records every request sent from that worktree's API Client (manual sends and runs), newest at the bottom, each showing method, resolved URL, status, and time.
- **FR-019**: Each console entry MUST be expandable to show request headers and body, response headers and body, and script log output, and collapsible to hide them.
- **FR-020**: The console as a whole MUST be collapsible/resizable and clearable.

**Runner**

- **FR-021**: Users MUST be able to choose Run on a collection or any folder, which opens a runner view listing every request in that scope, depth-first in collection order.
- **FR-022**: The runner MUST let users include/exclude individual requests, choose the environment, and set the number of iterations, the delay between requests, and whether to stop at the first failure.
- **FR-023**: The runner MUST execute requests one at a time in order, applying variable changes made by earlier scripts to later requests, and show live per-request status, time, and test results.
- **FR-024**: Users MUST be able to stop a run in progress; finished results are kept.
- **FR-025**: The runner MUST show a summary with totals (requests, tests passed, tests failed, total duration), allow filtering to passed or failed, and open a request's full details from its result.
- **FR-026**: The most recent run result per collection/folder MUST be kept and viewable until the next run of that scope or until it is cleared.

**Persistence and lifecycle**

- **FR-027**: Collections, environments, active environment selection, per-request latest results, and saved run results MUST be stored per worktree in Orca's own data, never inside the repository's working files, so they never appear as source-control changes.
- **FR-028**: Saved API data MUST survive app restarts and branch changes for as long as the worktree exists in Orca.
- **FR-029**: When a worktree (or folder workspace) is removed through Orca, its API data MUST be deleted with it; data for worktrees that no longer exist MUST be cleaned up when Orca detects they are gone.
- **FR-030**: API data MUST NOT be visible from other worktrees, including other worktrees of the same repository.
- **FR-031**: Users MUST be able to export a collection or environment to a Postman-compatible file.

**Agent and command-line access**

- **FR-032**: Agents and the Orca command line MUST be able to list a worktree's collections (with their folder/request tree) and environments, with secret values never returned.
- **FR-033**: Agents and the Orca command line MUST be able to run a single request, a folder, or a collection with a chosen environment, and get structured results: resolved request (secrets masked), response status, headers, body, time, and per-test pass/fail with messages.
- **FR-034**: Every collection, folder, and request MUST have a stable identifier that does not change across app restarts or edits other than deletion, so an external caller can address it.
- **FR-035**: Agents and the Orca command line MUST NOT be able to create, edit, or delete collections, folders, requests, or environments. Variable changes made by scripts during an agent-started run follow the same rules as a run started in the UI.
- **FR-036**: Requests sent by agents or the command line MUST appear in the worktree's API Client console, marked as agent-initiated.
- **FR-037**: Agents and the Orca command line MUST be able to make the worktree's API Client tab show a given request (opening or activating the tab, selecting the request in the tree) together with its latest result (response and test results), including results of runs the agent started. If that worktree is not the one currently shown, the tab is opened or updated inside that worktree without switching the window to it; the user sees it the next time they open that worktree. Producing an image of that view is out of scope.

### Key Entities

- **Collection**: A named tree of folders and requests imported from or exportable to Postman, with optional variables, auth, and scripts at collection level. Belongs to one worktree.
- **Folder**: A named node inside a collection that groups requests and subfolders, with optional description, auth, and scripts; runnable as a unit.
- **Request**: A named HTTP call: method, URL, params, headers, body, auth, pre-request script, test script, description, and a stable identifier.
- **Latest Result**: The most recent outcome of running one request (response or error, test results, timing, origin: manual/run/agent). One per request; replaced on the next run.
- **Environment**: A named set of variables (name, value, enabled, default/secret). Belongs to one worktree; at most one is active per worktree.
- **Console Entry**: The record of one sent request: resolved request, response or error, timing, script logs, and test results.
- **Run**: One execution of a collection or folder: scope, chosen environment, options, ordered per-request results, totals, start/end time.
- **Worktree API Data**: The container that ties all of the above to one worktree's lifetime.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: The sample smoke collection (2 top-level folders, 37 requests, each with a test script) and its 27-variable environment import with 100% of folders, requests, headers, bodies, scripts, and variables preserved.
- **SC-002**: A user can go from opening the '+' menu to seeing the response of a request from an imported collection in under 1 minute.
- **SC-003**: Running the sample "MAIN" folder produces a pass/fail result for every test, matching what Postman reports for the same environment and server state.
- **SC-004**: After any number of imports, edits, and runs, the worktree shows 0 new or changed files in source control due to this feature.
- **SC-005**: 100% of API data for a worktree is gone after the worktree is deleted through Orca, and 100% of it is still present after an app restart while the worktree exists.
- **SC-006**: The tab remains responsive (scrolling and typing without visible lag) while showing a 5 MB response or a run of 100+ requests.
- **SC-007**: An exported, unmodified collection re-imports into Postman with no errors and no lost requests, scripts, or variables.

## Assumptions

- Only Postman Collection v2.0/v2.1 and Postman environment export formats are in scope; Postman v1, OpenAPI, cURL, and other import formats are out of scope for this version.
- The database-connection tab, the end-to-end smoke-test skill, and automatic evidence capture to Markdown are separate future features (see Product Context).
- Remote (SSH) worktrees are out of scope: the user only works with local worktrees, so requests are always sent from the local machine and API data is stored locally.
- Only HTTP/HTTPS requests are in scope; GraphQL-specific UI, WebSocket, gRPC, mock servers, monitors, cloud sync, team sharing, and Postman account integration are out of scope.
- Script support targets the commonly used subset of Postman's scripting (tests, assertions, response reading, variable get/set, console logging); less common APIs (e.g. `pm.sendRequest`, `pm.visualizer`, cookie jar APIs) may be reported as unsupported in the first version.
- Imported scripts run isolated from the rest of the app and the user's machine; they can only use the script features listed above.
- Secret variables are stored encrypted in the worktree's local Orca data (FR-009a), masked in the UI, and never written to the repository. Exporting an environment writes secret values as plain values in the exported file, as Postman does; the user is warned before exporting.
- A value a script saves into a variable of type _default_ (e.g. a token read from a login response) is not treated as secret; to mask it, the user marks that variable as secret in the environment.
- Custom CA certificate files, client certificates (mTLS), and manual proxy configuration are out of scope for v1; they can be added later if a service requires them.
- Global variables (Postman "Globals") are out of scope; collection and environment variables cover the user's workflow.
- The existing right side panel is reused for the collections/environments list when an API Client tab is active.
- The runner executes requests sequentially (as Postman's runner does); parallel execution is out of scope.
- Run history keeps only the latest result per collection/folder; full historical run logs are out of scope.
- Runner result details keep a body preview (up to 256 KB per response); very large runs may keep only summaries for their oldest results.
- The UI follows Orca's existing design system rather than copying Postman's visual style; the Postman screenshots describe the layout and behavior, not the look.
