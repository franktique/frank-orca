# Feature Specification: E2E Test Orchestrator (automated smoke tests with evidence)

**Feature Branch**: `franktique/feature-e2e-orchestrator`

**Created**: 2026-10-19

**Status**: Draft

**Input**: User description: "I recently added two tab types (SQL and API Client). As earlier specs said, they were meant as the base for a feature that runs service tests on its own, against local or deployed environments, taking the data it needs as shown in an example HTML (`manual-testing-nuc-84270-generator.html`) that walks through a feature's tests step by step. The Postman collection has data that must be filled in once at the start for every request; then setup requests run, and then each test case's requests. Some cases also need a database query before the request (with a screenshot), then the request (with a screenshot of the payload sent and the result, proving it works), then queries after the request showing the database state (with a screenshot). After the user provides the one-time information (headers, tokens, etc.), everything runs automatically and the evidence — screenshots and queries — is saved in a `.md` file inside an `evidencias` folder in the repository where Orca is running it. Connecting to the database and taking its screenshots must be optional, because local access to it is not always available; the user must be asked at the start."

## Clarifications

### Session 2026-10-19

- Q: Is database access a yes/no choice at the start of a run? → A: No. There are three modes: (1) Automatic through the SQL tab; (2) Browser: Orca drives a web database console the user has open in an Orca browser tab, using Orca's computer-use / browser automation, and takes the screenshots there; (3) Manual: no database screenshots, but the run pauses before and after each step and shows the before/after queries so the user can run them by hand.
- Q: Where does the test plan come from? → A: For each feature, the user (or an agent) already produces a guide HTML like the reference example, plus the Postman collection and environment. On top of that they provide a JSON file that says, for each request, which queries prove it before and after it runs. The API Client tab is extended to load that JSON and link each request to its queries. Orca runs from the collection, environment, and JSON; the HTML stays the human-readable guide.
- Q: Where is a run started and followed? → A: Inside the API Client: a "Run as test" action on the collection opens a test-run view in the API Client tab (reusing the feature 001 runner), not a new tab type.
- Q: Which created records does cleanup cover? → A: Every value captured into a variable during the run (setup and scenarios) is kept, not only the latest; a cleanup step marked "for each value of X" in the test map runs once per recorded value, and unmarked cleanup steps run once.
- Q: What guards a run against a non-local host such as production? → A: The start screen requires a confirmation naming the non-local host before Start is enabled; the test map can optionally list allowed hosts, and a run against a host not on that list is refused.
- Q: Should agents or the Orca command line be able to run a plan? → A: No. Runs are started and followed only from the API Client UI; command-line/agent runs (and their missing-input, non-interactive, and 401 rules) are out of scope for this feature.
- Q: How much of a response body or query result goes into the evidence Markdown? → A: Up to 100 KB per body and 200 rows per query result, then truncated with a note stating the full size.
- Q: Are tokens captured by scripts into non-secret variables masked in the evidence? → A: Yes. Besides secret variables, any value sent in an authentication header and any captured value whose variable name contains token/secret/password/key is masked everywhere in the evidence.
- Q: Browser-mode screenshots show a third-party page that Orca does not render; how are sensitive values kept out of them (in the query typed or in its result)? → A: Blur them. Before each screenshot the run covers every visible sensitive value on the page with an opaque blur, checks that none is still readable, and removes the covers afterwards; if it cannot verify the page, the screenshot is withheld and only the masked result text is kept. Queries with sensitive values are not refused.

## Product Context

Features 001 (API Client tab) and 002 (SQL tab) were built as the first two steps of this workflow and explicitly left it out of scope. They already provide: Postman collections and environments per worktree, running a request, folder, or collection and reading structured results from outside the UI, opening a request in its tab on demand, PostgreSQL connections per project, and running queries from outside the UI (any statement on local databases, read-only elsewhere).

Today this work is done by hand, following a generated guide page like the reference example (`smoke-test-NUC-84270-bulk-assessment-requests/manual-testing-nuc-84270-generator.html`). That page shows the shape every run has:

1. **Inputs filled once**: host, tenant, record IDs (a case, several users), and credentials (a service token and a user's two tokens), each step stating which credential set it uses.
2. **Preflight** (read-only): confirms the endpoint is deployed, the tokens work, and the input data is valid.
3. **Setup**: requests that create the test data; IDs returned by each response must be kept and fed into later requests.
4. **Scenarios**: one or more requests per test case, run in a set order (some depend on earlier ones), each with an expected status and, for errors, an expected error code. One scenario needs two requests sent at nearly the same time.
5. **Cleanup**: requests that delete or retire what setup created, with a database fallback.
6. **Optional database steps**: queries before and after a request to show the database state, and in rare cases a statement that changes the schema, allowed only with explicit authorization.

Each manual run produces a pass/fail per scenario but no durable, shareable evidence. This feature runs the whole sequence automatically with the existing API Client and SQL tabs and writes the evidence to the repository.

A **test plan** for a feature is made of four files that are produced together, by the user or by an agent:

1. **Guide (HTML)**: the human-readable walkthrough, like the reference example. Orca does not execute it; it is linked from the evidence.
2. **Postman collection**: the requests, grouped in folders by phase, with headers that reference `{{variables}}` and test scripts that check the expected status and error code and store created IDs in variables.
3. **Postman environment**: the variables; the ones with no value are the one-time inputs the user fills before a run.
4. **Test map (JSON)**: new in this feature. For each request it lists the queries that prove it, run before and after the request, plus optional per-step settings. It is loaded into the API Client and linked to the collection's requests.

Database access varies by environment, so database steps run in one of three modes chosen at the start of each run:

1. **Automatic (SQL tab)**: queries run through a SQL tab connection; result screenshots are taken from the SQL tab.
2. **Browser (web database console)**: the user has a web database console (e.g. a cloud provider's query editor) open and signed in, in an Orca browser tab; the run drives that page with Orca's existing browser-automation / computer-use capabilities to type and run each query and screenshots the result there.
3. **Manual**: no database connection and no database screenshots; the run pauses before and after each step that has queries, shows the query for the user to run themselves, and continues when the user says so.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Run a test plan against an environment and get an evidence file (Priority: P1)

A developer has a test plan for a feature: its collection and environment imported in the API Client (setup, scenario, and cleanup requests, with test scripts holding the expected results) and its test map loaded. They start a run, choose the target (local or a deployed environment), and pick the database mode (for this story, a plan with no database queries, so the mode does not matter). They fill in the one-time inputs (host, tenant, IDs, tokens) in a single form. The run then executes preflight, setup, every scenario, and cleanup in order with no further input, carrying the IDs created during setup into later steps. When it ends, an evidence Markdown file exists in the repository's `evidencias` folder with, for each step: what was sent, what came back, a screenshot of the request and its response, the expected versus actual result, and pass/fail, plus a summary table at the top.

**Why this priority**: This is the core value — replacing a long manual, copy-paste session with one automatic run that leaves proof behind. It works even without database access, which is the most common situation for deployed environments.

**Independent Test**: Using the reference NUC-84270 collection against a reachable environment, without database steps, start a run, fill the inputs once, and confirm every step runs in order without further input, IDs from setup reach the scenarios, and the evidence file lists every step with its screenshot, expected vs. actual result, and pass/fail.

**Acceptance Scenarios**:

1. **Given** a test plan with database queries, **When** the user starts a run, **Then** they are first asked to choose the database mode (Automatic, Browser, or Manual) before anything is sent.
2. **Given** a plan whose steps use inputs such as `host`, `tenantId`, and tokens, **When** the run starts, **Then** the user is asked for every missing input once, in one form, with secret inputs masked, before any request is sent.
3. **Given** a setup request that returns a newly created ID, **When** later steps reference that ID, **Then** they are sent with the value captured from the response.
4. **Given** a scenario expecting status 422 with error code `AM00109`, **When** the response has status 422 and that code, **Then** the step passes; **When** either differs, **Then** it fails and the evidence shows expected and actual side by side.
5. **Given** a completed run, **When** the user opens the repository, **Then** an evidence Markdown file and its screenshots exist under `evidencias/`, readable in any Markdown viewer, with images referenced by relative paths.
6. **Given** any step, **When** its evidence is written, **Then** token and secret values never appear in the Markdown text or in the screenshots, including tokens a script captured into a non-secret variable (FR-025a); they are shown masked.

---

### User Story 2 - Load a test map into the API Client and see each request's queries (Priority: P1)

The developer has imported the feature's collection and environment into the API Client. From the collection's actions they load the feature's test map (JSON). Each request it mentions is now linked to its queries: the side panel marks the requests that have them, and selecting one shows a "Verification queries" section with the before and after queries and their descriptions. The developer can adjust a query in the app and export the test map back to a JSON file.

**Why this priority**: The test map is how a run knows which queries prove each request; without it, no database evidence is possible. It is also useful on its own, as a reference while testing by hand.

**Independent Test**: Import the NUC-84270 collection and environment, load a test map that gives SC-1 one before query and two after queries, and confirm SC-1 is marked in the side panel, its request view lists the three queries in order with their descriptions, and requests not in the map show no queries.

**Acceptance Scenarios**:

1. **Given** a collection in the API Client, **When** the user loads a test map for it, **Then** every request the map references is linked to its before and after queries, in the map's order.
2. **Given** a test map that references a request not in the collection, **When** it is loaded, **Then** the load succeeds for the rest and a warning lists each unmatched reference; nothing is linked silently to the wrong request.
3. **Given** a file that is not a valid test map, **When** the user loads it, **Then** it is rejected with a message saying what is wrong, and the current links do not change.
4. **Given** a collection that already has a test map, **When** the user loads another, **Then** they are asked to replace it, and on confirm the old links are fully replaced.
5. **Given** a request with linked queries, **When** the user edits a query or adds/removes one and saves, **Then** the change is kept and used by the next run; exporting the test map produces a JSON file that, loaded again, gives the same links.
6. **Given** a query that uses `{{variables}}` (inputs or captured IDs), **When** it is shown, **Then** unresolved variables are highlighted the same way the API Client highlights them in requests.

---

### User Story 3 - Capture database state automatically through the SQL tab (Priority: P1)

For a scenario that changes data, the plan says which queries prove the change (for example, "rows for this request ID" before and after the bulk create). The developer chooses the **Automatic** database mode at the start and picks one of the project's SQL connections. For those scenarios the run executes the "before" queries, sends the request, then runs the "after" queries, and the evidence shows each query's text, a screenshot of its result grid rendered with the SQL tab's view, and the request/response screenshot in between.

**Why this priority**: The before/after database state is the strongest proof a change works, and the user named it explicitly; it is P1 together with Story 1 but separable from it.

**Independent Test**: Against a local environment with a local database, run a plan whose SC-1 step has a before and an after query, and confirm the evidence shows the before query and its result screenshot, then the request/response screenshot, then the after query and its result screenshot, in that order.

**Acceptance Scenarios**:

1. **Given** Automatic mode and a connection selected, **When** a step with before/after queries runs, **Then** the order is: before queries, request, after queries, and each query's text and result screenshot appear in the evidence in that order.
2. **Given** a query's result has more rows than fit in one screenshot, **When** evidence is captured, **Then** the evidence also contains the result as a Markdown table (first 200 rows, with a note giving the total row count when truncated) so rows beyond the screenshot are not lost.
3. **Given** a step that changes the database (insert, update, delete, schema change), **When** the run reaches it, **Then** it only runs if the connection is local or the user confirmed that specific step at the start; otherwise it is skipped and marked as such.
4. **Given** a database query fails, **When** the step is recorded, **Then** the query error appears in the evidence and the request is still sent unless the plan marks the query as a precondition.

---

### User Story 4 - Run queries in a web database console open in Orca's browser (Priority: P2)

The developer cannot connect to the database from their machine, but can reach it through a web query console (for example, a cloud provider's query editor). Before starting, they open that console in an Orca browser tab and sign in. They choose the **Browser** database mode and pick that tab. For each query, the run types the query into the console's editor, runs it, waits for the result, and takes a screenshot of the browser tab showing the query and its result; the request in between is sent and captured as usual.

**Why this priority**: Deployed environments are often reachable only through a web console; this keeps before/after evidence possible there. It depends on driving a third-party page, so it is less predictable than Automatic mode.

**Independent Test**: With a web database console open and signed in in an Orca browser tab, run a plan with a before and an after query in Browser mode and confirm both queries were typed and run in that page, and the evidence shows a screenshot of each result from the browser tab, in order around the request.

**Acceptance Scenarios**:

1. **Given** Browser mode, **When** the run starts, **Then** the user picks one of the worktree's open browser tabs, and the run checks it can find the console's query editor and run control before sending anything; if it cannot, it says so and the user can fix the page, choose another mode, or cancel.
2. **Given** Browser mode, **When** a step's queries run, **Then** each query's text, a screenshot of the browser tab with its result, and (when the page exposes it) the result as text appear in the evidence.
3. **Given** the console page shows an error, a sign-in screen, or no result within the query timeout, **When** this happens, **Then** the run pauses that query, shows the user what it saw, and lets them retry, run that query by hand (Manual behavior for that query only), or skip it.
4. **Given** a query that changes the database, **When** Browser mode reaches it, **Then** it runs only if the user approved that step at the start of the run.
5. **Given** a query whose text or result shows a token or other sensitive value (FR-025a), **When** its screenshot is taken, **Then** every place the value is visible on the page is blurred beyond recovery, and the page looks unchanged to the user afterwards; if the run cannot confirm the value is hidden, the screenshot is left out and the evidence says why (FR-025b).

---

### User Story 5 - Pause for manual queries without database screenshots (Priority: P2)

The developer has their own way to query the database (another tool, a colleague, a shared console) but does not want Orca to touch it. They choose the **Manual** database mode. Before each step that has "before" queries, the run pauses and shows those queries (with inputs and captured IDs already filled in, ready to copy); the user runs them on their own and presses Continue. The request is sent, and the run pauses again with the "after" queries. No database screenshots are taken; the evidence includes the query text, marked as "run manually by the user".

**Why this priority**: It covers the most restricted case while keeping the checkpoints where database state must be checked; it needs no database access from Orca.

**Independent Test**: Run a plan with before/after queries in Manual mode and confirm the run pauses before and after the request showing the resolved queries, waits for Continue, and the evidence lists the queries as run manually with no database screenshots.

**Acceptance Scenarios**:

1. **Given** Manual mode and a step with before queries, **When** the run reaches it, **Then** it pauses before sending, shows each query fully resolved with a copy action, and waits until the user presses Continue.
2. **Given** the request was sent, **When** the step has after queries, **Then** the run pauses again showing them and waits for Continue.
3. **Given** a manual pause, **When** the user optionally pastes the result text before continuing, **Then** the pasted text appears in the evidence under that query; otherwise only the query text appears.
4. **Given** a manual pause, **When** the user presses Skip, **Then** that query is marked "skipped by user" and the run continues.

---

### User Story 6 - Follow and control a run while it executes (Priority: P2)

The developer starts the run with "Run as test" on the collection in the API Client, which opens the test-run view in that tab. While the run executes, the view shows its progress: the current phase and step, each finished step with pass/fail/skipped, and elapsed time. They can stop the run at any point. If a token expires mid-run (responses start returning 401), the run pauses, asks for the new token, and resumes from the failed step.

**Why this priority**: Runs against deployed environments take minutes and use short-lived tokens; without visibility and recovery, a single expired token wastes the whole run.

**Independent Test**: Start a run, watch steps complete with live status, invalidate the user token partway through, provide a new token when asked, and confirm the run resumes from the step that got 401 and finishes.

**Acceptance Scenarios**:

1. **Given** a run in progress, **When** the user looks at it, **Then** they see phase, current step, per-step result so far, and elapsed time.
2. **Given** a run in progress, **When** the user stops it, **Then** no further requests or queries are sent, the evidence file is written with what ran so far and marked "stopped by user", and the user is offered to run cleanup.
3. **Given** a step returns 401 when the plan did not expect it, **When** this happens, **Then** the run pauses, asks for the credential used by that step, and on resume re-sends that step; already-passed steps are not re-run.

---

### User Story 7 - Always clean up what setup created (Priority: P2)

Setup creates records in a shared environment. Whether the run passes, fails, or is stopped, cleanup runs for everything setup created, and the evidence lists what was cleaned and anything that could not be.

**Why this priority**: Leaving test data in a shared deployed environment affects other people; the reference guide treats cleanup as mandatory.

**Independent Test**: Start a run, stop it after setup, and confirm cleanup runs for every captured ID and the evidence lists each cleanup request and its result.

**Acceptance Scenarios**:

1. **Given** a run that ends in any state after it captured any value (in setup or scenarios), **When** it ends, **Then** cleanup steps run for every captured ID, including IDs created by scenarios and earlier values of a variable that was later overwritten (cleanup steps marked "for each value of X" repeat per value), unless the user chose "keep data" when stopping.
2. **Given** a cleanup request fails, **When** the run ends, **Then** the evidence lists the IDs that were not cleaned and the IDs remain available so cleanup can be re-run later on its own.
3. **Given** captured IDs from an earlier run of the same plan in this worktree, **When** the user asks to run only cleanup, **Then** cleanup runs with those IDs.

---

### User Story 8 - Concurrent request scenarios (Priority: P3)

Some scenarios (like the reference SC-14 race condition) need two or more requests sent at nearly the same time and an expectation on the combined outcome (for example, "one 201 and one 409 with `AM00107`"). The plan can mark a step as a concurrent group, and the run sends them together and checks the combined expectation.

**Why this priority**: Rare, and done "best effort" by hand today; the main flow does not depend on it.

**Independent Test**: Run a plan with a concurrent group of two requests and confirm both are sent within a short window of each other, the combined expectation is evaluated, and the evidence shows both requests and responses.

**Acceptance Scenarios**:

1. **Given** a concurrent group, **When** it runs, **Then** all its requests are sent together and the expectation is checked against the set of responses regardless of arrival order.

---

### Edge Cases

- The target environment is unreachable (VPN off, wrong host): preflight fails, no setup request is sent, and the evidence states preflight failed and why.
- A setup step fails: scenarios that depend on its captured value are marked "blocked by setup step X" instead of being sent with an empty value; cleanup still runs for what was created.
- A scenario declares it depends on an earlier scenario (e.g., SC-7 after SC-1) and that one failed: the dependent scenario still runs and is flagged in the evidence as "dependency failed" so the reader can interpret it.
- A response is not JSON or lacks the field the plan captures: the step fails with "could not capture X from response", showing the response.
- Very large responses or query results: screenshots show what fits; the Markdown includes the body up to 100 KB and the result up to 200 rows, with a truncation note stating the full size.
- The `evidencias` folder does not exist: it is created. A previous run's evidence is never overwritten; each run gets its own timestamped subfolder.
- The repository ignores `evidencias/` in its ignore rules: the run still writes there and the run summary notes the folder is ignored by source control.
- A folder workspace (not a git worktree): works the same; evidence goes into the workspace's root folder.
- A remote (SSH) worktree: not available, consistent with the API Client and SQL tabs being local-only; the option says why.
- The user closes the API Client or SQL tab, or switches tabs, during a run: the run continues and screenshots are still captured, without stealing focus or bringing windows to the front.
- Two runs of the same plan in the same worktree at once: not allowed; the second is refused while the first is running.
- The selected database connection drops mid-run (Automatic mode): remaining database steps are marked failed with the connection error; requests continue.
- Browser mode: the user closes or navigates away from the console tab mid-run, or the console's session expires: the run pauses and offers to pick the tab again, sign in and retry, switch the rest of the run to Manual, or skip the remaining queries.
- Browser mode: the console limits or paginates results so not all rows are visible: the screenshot shows what the page shows, and the evidence notes the result may be partial.
- Browser mode: the console draws its results on a canvas or inside a frame Orca cannot read, so visible sensitive values cannot be found or blurred: the screenshot is withheld for that query, the masked result text is kept when available, and the evidence says the screenshot was withheld.
- Manual mode: the user leaves a pause open for a long time: the run waits indefinitely, and the progress view and the evidence note the wait; tokens may expire meanwhile and are handled by FR-015 on the next request.
- A plan with no database queries: the database-mode question is not asked.
- The host input points outside the test map's allowed hosts (e.g. production by mistake): the run is refused before anything is sent and names the host; with no allowed list, a non-local host needs an explicit confirmation naming it.
- A request linked in the test map is renamed, moved, or deleted in the collection afterwards: links made by stable identifier follow the request; a link to a deleted request is shown as broken in the side panel and reported before a run starts, and the run skips it, listing it in the evidence as "skipped — broken test-map link".
- The collection is re-imported (replaced): links are re-matched by folder path and name, and unmatched ones are listed the same way as on load.
- A collection has no test map: it can still be run as a plan, with no verification queries.

## Requirements _(mandatory)_

### Functional Requirements

**Test plan**

- **FR-001**: A test plan MUST be an API Client collection, an API Client environment, and a test map loaded for that collection, optionally with the path of the feature's guide (HTML). Orca MUST NOT need to read the guide to run the plan.
- **FR-002**: The test map MUST be a JSON file whose required content is, for each referenced request: the request (identified by its folder path and name in the collection, or by its stable identifier from feature 001), and its before queries and after queries (each with the query text and an optional description).
- **FR-002a**: Each test-map entry MAY also set: a step ID and title for the evidence, its phase (preflight, setup, scenario, cleanup), expected outcome (status, error code, and where in the response the error code is found) when the collection's test scripts do not already check it, values to capture from the response into variables, dependencies on earlier requests, a concurrent-group name, for a cleanup step a "for each value of" variable (FR-017), whether a query is a precondition, and whether a query changes data. The test map MAY also declare its guide's path, a list of allowed hosts (FR-005f), and Browser-mode hints (CSS selectors for the console's query editor, run control, and result area) that take precedence over automatic detection.
- **FR-002b**: Without a phase in the test map, the phase MUST come from the collection's top-level folder names (preflight, setup, scenarios/tests, cleanup, in any common spelling, in English or Spanish); requests outside such folders run as scenarios. Steps run in collection order within a phase.
- **FR-002c**: A step's result MUST be decided by the collection's test scripts when they exist, and by the test map's expected outcome otherwise or in addition; a request with neither passes on any 2xx status.
- **FR-002d**: Values that the collection's scripts store in variables (e.g. created IDs) MUST be treated as captured values, the same as captures declared in the test map.
- **FR-003**: The API Client MUST let the user load a test map for a collection, show in the side panel which requests have linked queries, show a "Verification queries" section in the request view, edit/add/remove those queries, export the test map to a JSON file, and remove it from the collection. Loading follows FR-003a/b.
- **FR-003a**: Loading a test map MUST validate its structure, link every reference it can match, list unmatched references in a warning, and reject an invalid file without changing current links. Loading over an existing test map MUST ask before replacing it.
- **FR-003b**: The test map MUST be stored with the collection in the worktree's Orca data (same lifecycle as feature 001 data), never in the repository's working files unless the user exports it there.
- **FR-004**: Environment variables with no value MUST be the run's one-time inputs, and secret environment variables are secret inputs. Inputs and captured values MUST be usable as `{{name}}` in requests and in queries.

**Starting a run**

- **FR-005**: The API Client MUST offer a "Run as test" action on a collection (next to the existing Run action from feature 001) that opens a test-run view inside the API Client tab. A run is started and followed there; no new tab type is added.
- **FR-005a**: Before starting, the test-run view MUST show, in one screen: the environment to use, the database mode choice (FR-006), the one-time inputs form (FR-007), the steps by phase with their linked queries, and any broken test-map links; Start stays disabled until required inputs are filled.
- **FR-005b**: While running, the view MUST show the current phase and step, each finished step's result, elapsed time, Stop, and any pause (Manual-mode queries, Browser-mode recovery, expired credentials) inline in the view, with its actions.
- **FR-005c**: The run MUST keep going if the user switches to another request, tab, or worktree; returning to the API Client shows the run's view in its current state. Selecting a step opens that request's full details, as in the feature 001 runner.
- **FR-005d**: When the run ends, the view MUST show the summary and an action that opens the evidence Markdown in Orca. The latest test-run result of each collection MUST be kept until the next test run, like feature 001 run results.
- **FR-005e**: The view MUST offer "Run cleanup only" for a collection with captured IDs from an earlier run (User Story 7). A cleanup-only run skips preflight but keeps the host guard (FR-005f), the inputs form (FR-007), and unexpected-401 handling (FR-015).
- **FR-005f**: The target host MUST be resolved from the inputs before Start. When it is not local (not `localhost`, a loopback address, or an equivalent), Start MUST stay disabled until the user confirms a check that names that host. When the test map lists allowed hosts, a run against any other host MUST be refused with a message naming the host and the allowed list; this also applies to "Run cleanup only".
- **FR-006**: When the plan has database queries, the run MUST ask, before anything is sent, which database mode to use for this run:
  - **Automatic**: the user picks one of the project's SQL connections; the run tests the connection before continuing.
  - **Browser**: the user picks one of the worktree's open Orca browser tabs, where a web database console is already open and signed in; the run checks it can find the query editor and run control before continuing.
  - **Manual**: no database access from Orca.
    The last mode chosen is remembered per worktree and plan and offered as the default.
- **FR-006a**: In Automatic mode, queries MUST run through the SQL tab capabilities (feature 002) and result screenshots MUST show the query and its result rendered with the SQL tab's result view (not necessarily the live tab the user has open; see FR-024).
- **FR-006b**: In Browser mode, the run MUST drive the chosen browser tab with Orca's existing browser-automation / computer-use capabilities: put the resolved query in the console's editor, run it, wait for the result (bounded by the query timeout), and screenshot the tab; it MUST also record the result as text when the page exposes it. If the page shows an error, a sign-in screen, or no result in time, the run MUST pause that query and offer Retry, Do manually (Manual behavior for that query), or Skip.
- **FR-006c**: In Manual mode, the run MUST pause before a step's before queries and after its request when it has after queries, showing every query fully resolved (inputs and captured values filled in) with a copy action, and wait for Continue or Skip. The user MAY paste result text, which is added to the evidence. No database screenshots are taken; queries are marked "run manually by the user" (or "skipped by user").
- **FR-006d**: Pauses MUST NOT count toward step timings or the run's elapsed time, the run's progress view MUST show clearly that it is waiting for the user, and an unexpected 401 on the first request after a pause is handled by FR-015 like any other.
- **FR-007**: Before anything is sent, the run MUST collect every input (FR-004) that has no value yet, in one form; secret inputs are masked while typing and in all later display.
- **FR-008**: Non-secret inputs MUST be remembered per worktree and plan and pre-filled next time; secret inputs MUST be remembered only with the same at-rest protection the API Client uses for secret variables, and the user can clear them.
- **FR-009**: Steps that change a database MUST run only when, in Automatic mode, the connection is local, or when the user explicitly approved each such step at the start of the run (always required in Browser mode); otherwise they are skipped and marked so. In Manual mode the user decides by running it or pressing Skip.

**Execution**

- **FR-010**: The run MUST execute phases in order (preflight → setup → scenarios → cleanup) and steps in plan order, without user input once started, except for Manual-mode pauses (FR-006c), Browser-mode recovery (FR-006b), and expired credentials (FR-015).
- **FR-011**: If preflight fails, the run MUST NOT send setup or scenario requests.
- **FR-012**: Values captured from a response MUST be available to every later step; a step whose required captured value is missing MUST be marked "blocked" and not sent.
- **FR-013**: For each step the run MUST evaluate the expected outcome against the actual response and record pass, fail, skipped, or blocked, with a short reason for anything but pass.
- **FR-014**: For a step with database queries, the run MUST execute before queries, then the request, then after queries; a failed query is recorded and does not stop the request unless the plan marks it as a precondition.
- **FR-015**: When a step gets an unexpected 401, the run MUST pause, ask for the credential(s) that step uses, and resume by re-sending that step (for a concurrent group, the whole group, so its requests are again sent together); the user may instead stop the run.
- **FR-016**: Users MUST be able to stop a run; stopping sends nothing further except cleanup, which runs unless the user chooses to keep the data.
- **FR-017**: Cleanup MUST run whenever the run captured any value (in setup or scenarios), regardless of how the scenarios ended, unless the user chose "keep data" when stopping (FR-016); kept values are listed in the evidence as not cleaned. Every value captured into a variable during the run (in setup or scenarios) MUST be recorded, not only the latest, and kept per worktree and plan so cleanup can be run on its own later. The user MAY forget the recorded values after a confirmation, which removes them without running cleanup.
- **FR-017a**: A cleanup step marked "for each value of X" in the test map MUST run once per recorded value of X, with X set to that value; unmarked cleanup steps run once with current variable values. Each recorded value not covered by a passing cleanup step MUST be listed in the evidence as not cleaned.
- **FR-017b**: When secure storage is unavailable, sensitive captured values (FR-025a) MUST be kept in memory only, never written unprotected. A value lost this way (e.g. after a restart) MUST be listed in "Run cleanup only" and in the evidence as "value unavailable (not stored: secure storage unavailable)", and the run summary MUST warn when any captured value will not survive a restart.
- **FR-018**: Steps marked as a concurrent group MUST be sent together, and the expectation evaluated against the set of responses in any arrival order.
- **FR-019**: Requests and queries MUST run through the existing API Client and SQL tab capabilities (same variable resolution, certificate, proxy, timeout, and read-only rules), so a step behaves the same as running it by hand in those tabs.
- **FR-020**: Only one run of a given plan per worktree MUST be active at a time; a cleanup-only run counts as a run, so it is refused while another run of that plan is active and vice versa.

**Evidence**

- **FR-021**: Each run MUST write a new folder `evidencias/<plan name>/<date-time>/` at the root of the worktree (or folder workspace), containing one Markdown file and its images; earlier runs are never overwritten.
- **FR-022**: The Markdown file MUST start with: plan name, a link to the guide when the test map declares one, target environment (host only), date and duration, the database mode used (Automatic with connection name, Browser with the console's site, or Manual), and a summary table with every step's ID, title, expected, actual, and result.
- **FR-023**: For each step the Markdown MUST include, in execution order: before queries (text, plus result screenshot and result as a table when the mode captured them, or the user's pasted result in Manual mode), the request (method, resolved URL, headers, body), a screenshot of the request and its response rendered with the API Client tab's views, the response (status, time, body), after queries (same as before queries), expected vs. actual, and the result.
- **FR-024**: Screenshots MUST be taken from the API Client tab, SQL tab, or browser tab views showing the step's request/response or query/result, without bringing Orca windows to the front or taking focus from what the user is doing.
- **FR-025**: Secret inputs and auth header values MUST be masked in the Markdown and in the screenshots.
- **FR-025a**: Besides secret variables, the run MUST mask (as `••••`, with feature 001's masking rules for embedded, URL-encoded, and JSON-escaped forms) every value sent in an authentication header (`Authorization`, `Cookie`, `X-API-Key`, and similar `*-Token`/`*-Key` headers) and every captured value whose variable name contains `token`, `secret`, `password`, or `key` (case-insensitive), wherever it appears in the evidence, including response bodies and screenshots.
- **FR-025b**: Browser-mode screenshots MUST NOT show any sensitive value (FR-025a), whether in the typed query or the result. Before each screenshot the run MUST cover every visible occurrence on the page with an opaque blur the value cannot be recovered from, re-check that no occurrence is still readable, and remove the covers once the screenshot is taken (also when capture fails). If any occurrence remains readable, or part of the visible page cannot be inspected, the screenshot MUST be withheld and the evidence MUST say so; the masked result text is still recorded. Queries are not refused because they contain sensitive values.
- **FR-026**: Response and request bodies MUST be included up to 100 KB (100 × 1024 bytes) each, and query results up to 200 rows each; beyond that they are cut with a note stating the full size (bytes or row count); images MUST be referenced by relative paths so the folder can be moved or committed as is.
- **FR-027**: The evidence MUST be written even when the run fails or is stopped, stating how it ended; the run MUST NOT commit or stage the evidence in source control.

**Scope of execution**

- **FR-028**: Runs MUST be started and followed only from the API Client's test-run view (FR-005). Starting, stopping, or answering a run from the Orca command line or by agents is out of scope for this feature; every pause (Manual-mode queries, Browser-mode recovery, expired credentials, non-local host confirmation) is answered in the UI.

### Key Entities

- **Test Plan**: A feature's smoke test: one API Client collection, one environment, the collection's test map, and optionally the guide (HTML) path. Its name (used in the evidence and its folder) is the collection's name.
- **Test Map**: The JSON loaded for a collection that links requests to their before/after verification queries and optional per-step settings; stored with the collection and exportable.
- **Verification Query**: A query linked to a request, run before or after it; has text, an optional description, and optional precondition and changes-data flags.
- **Input**: An environment variable with no value, given once per run (secret flag from the environment, remembered value).
- **Step**: One unit of the plan: a request (or concurrent group of requests), its phase, expected outcome, captures, before/after queries, and dependencies.
- **Captured Value**: A value taken from a response (typically a created ID), kept per worktree and plan for later steps and for cleanup; every value a variable receives during a run is recorded in order, and later steps use the latest.
- **Database Mode**: How a run handles database queries: Automatic (a SQL connection), Browser (an Orca browser tab with a web database console), or Manual (user runs queries during pauses).
- **Run**: One execution of a plan: target, database mode and its connection or browser tab, start/end time, how it ended, per-step results.
- **Evidence Bundle**: The run's folder under `evidencias/`: one Markdown report plus its screenshots.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: Running the reference NUC-84270 plan (preflight, 10 setup requests, ~15 scenarios, cleanup) requires the user to enter inputs once and takes no further action until it finishes; the manual equivalent takes 30+ minutes of copy-paste.
- **SC-002**: 100% of steps in a run appear in the evidence file with a result; none is silently missing.
- **SC-003**: In a review of evidence from 10 runs, zero token or secret values are readable in the Markdown text or screenshots.
- **SC-004**: A reviewer who never saw the run can tell, for each scenario, what was sent, what came back, and whether it matched the expectation, from the evidence file alone.
- **SC-005**: In each of the three database modes, a plan with before/after queries completes, and the evidence shows every query at its place around its request: with result screenshots in Automatic and Browser modes, and as "run manually" in Manual mode, with no errors caused by the mode itself.
- **SC-005a**: In Manual mode, the user never has to type or edit a query by hand: every shown query is fully resolved and copyable in one action.
- **SC-006**: After any run that got past setup (passed, failed, or stopped), every record the run captured an ID for (in setup or scenarios) is either cleaned up or listed in the evidence as not cleaned.
- **SC-007**: A run with an expired token mid-way can be completed by providing a new token, without re-running steps that already passed.
- **SC-008**: Runs never steal focus or bring Orca windows to the front while capturing screenshots.

## Assumptions

- Requests come from API Client collections and environments (feature 001), and database queries go through SQL tab connections (feature 002); this feature does not add its own HTTP or database client.
- The one-time inputs map naturally onto API Client environment variables; plan inputs may be pre-filled from the active environment.
- Deployed environments are reached from the local machine (VPN or network access is the user's responsibility); the orchestrator, like the two tabs, is local-only and not offered for SSH worktrees.
- Database access from Orca is optional; for deployed environments it is often unavailable or only possible through a web console, which is why Browser and Manual modes exist. The first time, Manual is offered as the default mode.
- Browser mode reuses Orca's existing browser tabs and their browser-automation / computer-use capabilities; it does not add support for any specific console product; the optional Browser-mode hints in the test map (FR-002a) are generic CSS selectors, not product integrations. The user opens and signs in to the console before the run; Orca never stores console credentials. Because console pages differ, Browser mode is best effort, with the per-query recovery in FR-006b.
- Evidence goes to `evidencias/` (Spanish folder name, as requested) at the root of the worktree where the run happens; whether to commit it is the user's decision.
- Evidence labels follow Orca's UI language (English); text written by the user in the plan (titles, descriptions, notes) is copied as is.
- Screenshot images are standard image files readable by common Markdown viewers.
- The 50 MB result limit and the SQL tab's query timeout from feature 002 apply unchanged to plan queries.
- Producing the guide, collection, environment, and test map for a feature (by hand or by an agent from a ticket) is not part of this feature, but the test map format must be simple and documented enough for an agent to write next to the guide. Orca does not parse the guide HTML.
- Credential choice per request (e.g. service token vs. user tokens) is already expressed by each request's headers in the collection, so the test map does not repeat it.
