# Quickstart: Validating the E2E Test Orchestrator

This guide runs the feature end to end and checks the spec's acceptance scenarios. It does not describe the implementation. The formats it relies on are in [contracts/test-map-format.md](./contracts/test-map-format.md) and [contracts/evidence-bundle-format.md](./contracts/evidence-bundle-format.md).

## Prerequisites

- `pnpm install`. No new native modules, so no extra install step.
- A local worktree opened in Orca (not SSH).
- Fixtures, created by the tasks under `src/shared/test-orchestrator/__fixtures__/`:
  - `smoke-plan.postman_collection.json`: Preflight, Setup, Scenarios, and Cleanup folders. Requests target `{{host}}` with `Authorization: Bearer {{userToken}}`. Test scripts check status codes and call `pm.environment.set("caseId", …)`.
  - `smoke-plan.postman_environment.json`: `host`, `tenantId` (empty, so they become inputs), and `userToken` (secret, empty).
  - `smoke-plan.test-map.json`: SC-1 with one before query and two after queries; SC-4 expecting `422 · AM00109`; a concurrent group; a cleanup step with `forEach: "caseId"`.
- The fixture HTTP server: feature 001's `local-echo-server` with the plan routes (create returns an id, duplicate returns 422 with `AM00109`, and a `/expire-token` switch makes later calls return 401).
- For Automatic mode, PostgreSQL 16 and `ORCA_TEST_PG_URL=postgres://…` (the same setup as feature 002), seeded with `src/main/test-orchestrator/test-support/seed.sql`.
- For Browser mode: `tests/e2e/test-orchestrator/fixtures/fake-db-console.html`. It is a page with a `textarea`, a "Run" button, and a results `table`, and it answers queries from an in-page table.

## Automated checks

```bash
pnpm tc
pnpm test src/shared/test-orchestrator src/main/test-orchestrator
ORCA_TEST_PG_URL=postgres://postgres:postgres@localhost:5432/orca_test pnpm test src/main/test-orchestrator/*.integration.test.ts
pnpm run check:code-quality:changed
ORCA_BACKGROUND_LAUNCH=1 pnpm test:e2e tests/e2e/test-orchestrator
```

The e2e run must never show or focus a window. It checks the UI through CDP screenshots of the hidden renderer (AGENTS.md "Electron UI Validation").

## Manual scenarios

Unless a scenario says otherwise, start each one by importing the fixture collection and environment in an API Client tab (feature 001).

| #   | Steps                                                                                      | Expected outcome                                                                                                                                                                                                                                              | Covers                    |
| --- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| 1   | Collection menu → **Load test map…** → `smoke-plan.test-map.json`                          | SC-1 is marked in the side panel. Its request view shows "Verification queries" with 1 before and 2 after queries, in order. Requests not in the map show none.                                                                                               | US2-AS1                   |
| 2   | Load a map whose entry references `["Scenarios","Nope"]`                                   | The load succeeds. A warning lists `Scenarios / Nope`.                                                                                                                                                                                                        | US2-AS2                   |
| 3   | Load a file with `"orcaTestMap": 2` or `expect.status: "abc"`                              | Rejected, with the issue path shown. Links are unchanged.                                                                                                                                                                                                     | US2-AS3                   |
| 4   | Edit SC-1's after query, then **Export test map…**, **Remove**, and load the exported file | The same links and the edited query come back.                                                                                                                                                                                                                | US2-AS5                   |
| 5   | **Run as test** with no database queries in the map (use `--no-db` variant)                | The setup screen shows the environment, the inputs (`host`, `tenantId`, `userToken` masked), and the steps by phase. There is no database-mode choice. Start is disabled until the inputs are filled.                                                         | FR-005a, edge case        |
| 6   | Fill the inputs with `host=localhost:<port>` → Start                                       | Every phase runs without further input. `caseId` from setup reaches the scenarios. SC-4 passes on `422 · AM00109`. When it finishes, **Open evidence** shows `report.md` in Orca.                                                                             | US1-AS2..5, SC-001        |
| 7   | Inspect `evidencias/<slug>/<timestamp>/`                                                   | `report.md` has a summary table with every step, each step's request and response, and screenshots as relative `images/…png` links. Searching the folder for the token text finds nothing (`grep -r "<token>" evidencias/` is empty).                         | US1-AS5/6, SC-002, SC-003 |
| 8   | Set `host` to `qa.example.com`                                                             | Start stays disabled until "I confirm this run targets **qa.example.com**" is checked. With `allowedHosts: ["localhost"]` in the map, the run is refused, naming both.                                                                                        | FR-005f                   |
| 9   | Full map, **Automatic** mode with the PG connection → Start                                | For SC-1 the evidence shows the before query with its screenshot and table, then the request screenshot, then both after queries, in that order.                                                                                                              | US3-AS1, SC-005           |
| 10  | Make SC-1's after query return 1,000 rows                                                  | The screenshot shows the visible rows. The Markdown table has 200 rows and `Truncated: showing 200 of 1,000 rows`.                                                                                                                                            | US3-AS2, FR-026           |
| 11  | A `changesData` query against a connection whose host is a LAN IP, not approved            | It is skipped and marked "data change not approved". With the step checked on the setup screen, it runs.                                                                                                                                                      | US3-AS3, FR-009           |
| 12  | **Browser** mode: open `fake-db-console.html` in an Orca browser tab, pick it              | The run checks that the editor and Run button exist, then types and runs each query. The evidence shows a browser screenshot and the result text. The Orca window is not focused or raised.                                                                   | US4-AS1/2, SC-008         |
| 13  | Browser mode: make the fake console show a sign-in screen                                  | The run pauses on that query with a screenshot and offers Retry, Do manually, and Skip.                                                                                                                                                                       | US4-AS3                   |
| 14  | **Manual** mode                                                                            | The run pauses before SC-1 with the resolved query and a copy button. Paste a result, then Continue. It pauses again after the request. The evidence marks the queries "run manually by the user" and includes the pasted text, with no database screenshots. | US5, SC-005a              |
| 15  | During the run, hit `/expire-token` on the fixture server                                  | The next step gets 401, and the run pauses asking for `userToken`. Enter a new value: the run resends that step only and finishes.                                                                                                                            | US6-AS3, SC-007           |
| 16  | Stop the run right after setup → **Run cleanup**                                           | No further scenario is sent. Cleanup runs once for each recorded `caseId`. The evidence says "Stopped by user" and lists what was cleaned.                                                                                                                    | US6-AS2, US7-AS1          |
| 17  | Make the cleanup endpoint return 500, run, then fix it and use **Run cleanup only**        | The first evidence lists the values that were not cleaned. Cleanup-only cleans them using the stored ledger.                                                                                                                                                  | US7-AS2/3                 |
| 18  | Run the concurrent group                                                                   | Both requests show `sent +0 ms` and `sent +≤10 ms`. The `expectAll` verdict is evaluated in any order.                                                                                                                                                        | US8                       |
| 19  | Start a run, switch to another worktree, come back                                         | The run kept going, and the test-run view shows its current state.                                                                                                                                                                                            | FR-005c                   |
| 20  | Start a second run of the same plan while one is running                                   | Refused with "A run of this plan is already in progress".                                                                                                                                                                                                     | FR-020                    |
| 21  | Open an SSH worktree                                                                       | No "Run as test" or test-map menu items; the API Client says why.                                                                                                                                                                                             | Edge case                 |
| 22  | A folder workspace                                                                         | Works the same. Evidence goes to the folder root, and there is no git-ignore note.                                                                                                                                                                            | Edge case                 |
| 23  | Add `evidencias/` to `.gitignore`, run                                                     | The evidence is still written, with the "ignored by source control" note. Nothing is staged.                                                                                                                                                                  | Edge case, FR-027         |

## Done when

- [ ] Every automated check above passes. The PG integration tests may be skipped in CI when `ORCA_TEST_PG_URL` is unset.
- [ ] Every manual scenario gives its expected outcome on macOS. Scenarios 6, 7, 12, and 22 have also been run on Windows and Linux (folder names, paths, and the Ctrl+Enter fallback).
