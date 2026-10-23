# Implementation Plan: E2E Test Orchestrator (automated smoke tests with evidence)

**Branch**: `franktique/feature-e2e-orchestrator` (spec dir `003-e2e-test-orchestrator`) | **Date**: 2026-10-19 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/003-e2e-test-orchestrator/spec.md`, planned with the app's current tech stack (user direction). Everything is built on features 001 (API Client) and 002 (SQL tab). No new runtime dependency is added.

## Summary

The API Client can now run a collection as a **test plan**. The collection, its environment, and a JSON **test map** that links each request to the before/after queries proving it together make a plan that runs preflight → setup → scenarios → cleanup on its own, after one input form. Each run writes evidence to `evidencias/<plan>/<timestamp>/` in the worktree: a Markdown report and screenshots, with every secret masked.

Everything executes in the main process. A new `TestRunOrchestrator` drives feature 001's `executeRequest()`. Two small optional parameters let it keep inputs and captured values in a run-scoped variable scope instead of writing them to the saved environment. Database steps run in one of three modes:

- **Automatic**: feature 002's query runner, generalized from `runAgentQuery`, on one dedicated session per run. A query that changes data runs only on local connections or after per-step approval.
- **Browser**: the existing `AgentBrowserBridge` (CDP) types and runs the query in a web console the user has open in an Orca browser tab, then screenshots that tab without revealing it.
- **Manual**: pauses that show the resolved queries for the user to run.

Screenshots of requests and query results come from a hidden **offscreen** `BrowserWindow`. It renders the API Client's and SQL tab's presentational components from already-masked data and is captured with `capturePage()`, so no window is shown or focused. The test map, plan settings (remembered inputs, with secrets sealed by `SecretStore`), the capture ledger, and the latest test run are stored in feature 001's per-worktree data folder and share its deletion and GC lifecycle. The UI lives in the API Client tab: test-map load and export and "Run as test" in the collection menu, a "Verification queries" section on requests, and a new `test-run` view. Details: [research.md](./research.md).

## Technical Context

**Language/Version**: TypeScript (strict), Node 24, Electron 43.7, React 19

**Primary Dependencies**: All existing. electron (`BrowserWindow` offscreen rendering + `webContents.capturePage`, `safeStorage` via `SecretStore`), zod 4 (schemas + `z.toJSONSchema` for the published test-map schema), zustand, radix-ui/shadcn primitives, Tailwind, lucide-react, `@monaco-editor/react` (`pgsql` for query editing), `@tanstack/react-virtual`, i18next. Feature 001 modules: `executeRequest`, `snapshotScope`, variable resolution, `secret-masking`, `local-echo-server`. Feature 002 modules: `pg`/`pg-cursor` through `connectPgClient`, `executeSqlBatch`, `sql-connection-test`, statement classification. `AgentBrowserBridge` for Browser mode. **New**: none.

**Storage**: Per-worktree JSON under `userData/api-client/<hashWorktreeId>/` (`test-maps/`, `test-plans/`, `test-captures/`, `test-runs/`), written with `writeFileDurable`, with secrets sealed via `sealSecretValue`. Evidence goes into the worktree at `evidencias/…` (the only files written to the repository, as requested) ([contracts/storage-format.md](./contracts/storage-format.md)).

**Testing**: Vitest (unit, and Testing Library/happy-dom for components). Vitest orchestrator tests against feature 001's `local-echo-server`. Vitest integration against a real `postgres:16` (`ORCA_TEST_PG_URL`, skipped when unset). Playwright Electron e2e with `ORCA_BACKGROUND_LAUNCH=1`, CDP screenshots, and a fixture web "database console" page.

**Target Platform**: Orca desktop on macOS, Linux, Windows (local execution host only; SSH worktrees excluded by spec)

**Project Type**: Desktop app (Electron main + preload + React renderer). No CLI or RPC surface in this feature (FR-028).

**Performance Goals**:

- The reference plan (preflight, 10 setup requests, about 15 scenarios, cleanup) adds less than 1 s of orchestrator overhead per step beyond the request and query time (SC-001).
- A screenshot takes under 500 ms per card.
- The progress view stays responsive. Events are throttled to about 10/s.

**Constraints**:

- Zero secret values in evidence text or images (SC-003).
- Never show, focus, or raise a window (SC-008).
- Nothing staged or committed (FR-027).
- Earlier evidence is never overwritten (FR-021).
- Body and result limits are 100 KB and 200 rows (FR-026). The 002 limits (50 MB, query timeout) apply unchanged.
- One active run per plan per worktree (FR-020).
- Must pass the design-system lint, localization verification, and `max-lines` (no disables), and follow the no-vague-file-names rule.

**Scale/Scope**: Plans with tens of steps and up to about 100 queries. Up to about 200 screenshots per run, each about 50–300 KB PNG. Several plans per worktree, one active run each.

No NEEDS CLARIFICATION items remain. The spec's clarification session resolved the product questions, and research.md R1–R19 settles the technical ones.

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

`.specify/memory/constitution.md` is still the unfilled template. As in features 001 and 002, the binding rules in `AGENTS.md` (plus `docs/STYLEGUIDE.md`) act as the constitution.

| Gate (AGENTS.md)                                                                           | Status | How the design satisfies it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------ | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Design system: tokens + `components/ui` primitives, no raw palette, no computed classNames | PASS   | R17: existing primitives. Pass/fail colors use the semantic tokens the 001 runner already uses. Snapshot cards reuse the tab components. The snapshot page loads the same `main.css` tokens (light theme)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Reuse before reimplementing                                                                | PASS   | Request execution, variable resolution, and masking come from 001 (`executeRequest`, `prepareRequest`, `maskSecrets`/`maskHeaders`). Query execution comes from 002 (`executeSqlBatch`, `connectPgClient`, connection test, statement classification), with `runAgentQuery` generalized instead of copied. The console is driven by `AgentBrowserBridge`. Also reused: `checkIgnoredPaths`, `writeJsonFile`/`readJsonFile`, `sealSecretValue`, `assertLocalWorkspace`, the 001 runner's `snapshotScope`/`capDetailBodies`/`enforceRunSizeCap`, `RunResultDetail`, `ApiClientCodeEditor`, the editor slice's `openFile`, and the `popout.html` secondary-entry pattern. The local-host check is extracted from `getSqlAgentAccess` into a shared `isLocalHost` instead of written a second time |
| SSH use case considered                                                                    | PASS   | Local-only per spec. Every IPC handler goes through `assertLocal`, and the menu items are gated by the existing API Client availability (R18). Browser mode uses Orca's local browser tabs only                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Folder workspaces as well as git worktrees                                                 | PASS   | Evidence root comes from `splitWorktreeIdForFilesystem`. The git-ignore check is skipped for folder workspaces. Data is keyed by worktree id like 001 (R10, R18)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Remote wire compatibility                                                                  | PASS   | No RPC methods, stream opcodes, or published tab content are added. The new persisted view kind falls back to `empty` in the existing tolerant parse                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Cross-platform (paths, shortcuts, child processes, native modules)                         | PASS   | `path.join`. Folder slugs are Windows-safe and Markdown links always use `/`. Browser-mode Run uses the platform modifier. No new child processes: the only git call is the existing `checkIgnoredPaths` runner, and `git check-ignore --stdin` is far older than the 2.25 baseline. No native modules. Offscreen rendering works on all three OSes                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Electron UI validation in the background                                                   | PASS   | The snapshot window is `show: false` + `offscreen`, and is never focused or activated. The e2e tests use `ORCA_BACKGROUND_LAUNCH=1` and CDP screenshots                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Git safety / compatibility / provider compatibility                                        | PASS   | One bounded `git check-ignore` on a single path. No ref scans. No provider-specific behavior                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Agent status store                                                                         | N/A    | No agent-status producers or readers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Agent terminal screens                                                                     | N/A    | No PTY parsing                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| File naming, `.ts` over `.d.ts`, checked types, no `max-lines` disables                    | PASS   | Domain names (`plan-phases.ts`, `step-verdict.ts`, `run-sensitive-values.ts`, `evidence-writer.ts`, `browser-console-driver.ts`, …). zod parsing instead of casts, including CDP `evaluate` results. The orchestrator is split by responsibility (below)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Brief comments only                                                                        | PASS   | Implementation guidance                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

**Post-design re-check (after Phase 1)**: PASS.

- The contracts add no agent or remote surface, no native modules, and no wire changes.
- The only files written to the repository are the evidence bundle, which the spec requires.
- Secrets reach the renderer only as user input and are masked in every output.
- Two items need justification and are recorded under Complexity Tracking.

## Project Structure

### Documentation (this feature)

```text
specs/003-e2e-test-orchestrator/
├── spec.md
├── plan.md              # This file
├── research.md          # Phase 0
├── data-model.md        # Phase 1
├── quickstart.md        # Phase 1
├── contracts/
│   ├── test-map-format.md        # the JSON users/agents write
│   ├── evidence-bundle-format.md # what lands in evidencias/
│   ├── ipc-renderer-main.md      # window.api.testRun + snapshot window channels
│   └── storage-format.md         # Orca data files
├── checklists/requirements.md
└── tasks.md             # Phase 2 (/speckit-tasks — not created here)
```

### Source Code (repository root)

```text
src/shared/
├── host-locality.ts                               # isLocalHost (extracted from sql-connection-locality)
├── sql-client/sql-connection-locality.ts          # now calls isLocalHost (+ socket-path rule)
├── api-client/api-client-types.ts                 # + ApiClientPersistedView { kind: 'test-run'; collectionId }
└── test-orchestrator/
    ├── test-orchestrator-types.ts                 # data-model.md entities
    ├── test-orchestrator-schemas.ts               # zod: storage + IPC payloads + PauseAnswer
    ├── test-map-schema.ts                         # zod for the file format (+ JSON Schema generation)
    ├── test-map-linking.ts                        # ref → requestId (id, exact, insensitive, ambiguous, broken)
    ├── test-map-export.ts                         # TestMap → file (path refs)
    ├── plan-phases.ts                             # folder name → phase (EN/ES)
    ├── plan-steps.ts                              # collection + map → ordered TestPlanStep[] (+ groups, forEach)
    ├── plan-inputs.ts                             # empty env vars → inputs; referenced-variable scan
    ├── plan-target-hosts.ts                       # resolve URLs → hosts; allowedHosts matching
    ├── step-verdict.ts                            # scripts + expect + 2xx; error-code lookup; expectAll matcher
    ├── response-capture.ts                        # JSON path / header captures
    ├── run-sensitive-values.ts                    # secrets + auth-header values + sensitive capture names
    ├── evidence-truncation.ts                     # 100 KB / 200 rows with size notes
    ├── evidence-markdown.ts                       # TestRun → report.md (pure; golden-tested)
    └── __fixtures__/smoke-plan.*                  # collection, environment, test map

src/main/
├── api-client/request-execution.ts                # + variableOverlay / variableSink (R2)
├── api-client/collection-runner.ts                # export snapshotScope
├── api-client/api-client-storage-paths.ts         # + testMapFile/testPlanFile/testCapturesFile/testRunFile
├── sql-client/sql-agent-runner.ts                 # runAgentQuery → runIsolatedQuery (generalized)
└── test-orchestrator/
    ├── test-orchestrator-service.ts               # init/get, wiring to ApiClientService, SQL, browser bridge
    ├── test-map-store.ts                          # load/save/export/re-match; plan settings; ledger; latest run
    ├── test-run-orchestrator.ts                   # run lifecycle + state machine, busy guard, events
    ├── test-run-step-executor.ts                  # one step: blocked check → before → request(s) → captures → after → verdict
    ├── test-run-cleanup.ts                        # forEach expansion, cleaned marking, cleanup-only runs
    ├── test-run-pauses.ts                         # Deferred pauses, pause-time accounting
    ├── run-variable-scope.ts                      # overlay + sink + ledger append + sensitive set
    ├── database-modes/
    │   ├── database-query-runner.ts               # interface used by the step executor
    │   ├── automatic-query-runner.ts              # one pg session per run; read-only per approval
    │   ├── browser-console-driver.ts              # AgentBrowserBridge: locate/enter/run/wait/capture
    │   ├── browser-console-redaction.ts           # in-page blur of sensitive values, verify, restore (FR-025b)
    │   ├── browser-query-runner.ts                # Browser DatabaseQueryRunner: approvals, recovery pauses
    │   └── manual-query-runner.ts                 # raises manual-queries pauses
    ├── evidence-snapshot-window.ts                # hidden offscreen BrowserWindow, render → capturePage
    ├── evidence-writer.ts                         # folder naming, images, report.md rewrites, git-ignore note
    └── test-support/ (plan-echo-routes.ts, seed.sql)
src/main/ipc/test-orchestrator/test-run-ipc.ts     # contracts/ipc-renderer-main.md
src/main/startup/…                                 # init service after ApiClientService and AgentBrowserBridge

src/preload/api/test-run-api.ts (+ bridge)          # window.api.testRun
src/preload/evidence-snapshot-preload.ts           # render/painted channels only

src/renderer/
├── evidence-snapshot.html                         # new entry (electron.vite input, like popout.html)
└── src/
    ├── evidence-snapshot/
    │   ├── evidence-snapshot-main.tsx             # mounts the card, signals painted
    │   ├── RequestEvidenceCard.tsx                # reuses response-viewer components
    │   └── QueryEvidenceCard.tsx                  # reuses the SQL results grid (non-virtualized mode)
    ├── store/slices/api-client-test-run.ts        # runs, pauses, test maps per collection
    └── components/api-client/
        ├── sidebar/collection-tree-menu.ts        # + Load/Export test map, Run as test, Run cleanup only
        ├── sidebar/CollectionTreeRow.tsx          # + queries marker / broken-link state
        ├── verification-queries/
        │   ├── VerificationQueriesSection.tsx     # in the request view (US2)
        │   └── VerificationQueryEditor.tsx        # pgsql editor + unresolved-variable highlight
        └── test-run/
            ├── TestRunView.tsx                    # setup | progress | summary switch
            ├── TestRunSetup.tsx                   # env, db mode, inputs, host confirm, approvals, steps
            ├── DatabaseModePicker.tsx
            ├── TestRunInputsForm.tsx
            ├── TestRunProgress.tsx                # phases, step rows, elapsed, Stop
            ├── TestRunPauseCard.tsx               # all pause kinds + stopping prompt
            └── TestRunSummary.tsx                 # totals, cleanup, Open evidence, Run cleanup only

docs/reference/orca-test-map.schema.json           # generated; verified in CI like other generated files
tests/e2e/test-orchestrator/                       # Playwright scenarios + fake-db-console.html
```

**Structure Decision**: Follow Orca's existing split, as features 001 and 002 did:

- `src/shared` for pure logic and formats, all unit-testable without Electron.
- `src/main` for execution, storage, screenshots, and evidence.
- `src/preload` for the bridges.
- `src/renderer/src` for UI.

No `src/cli` changes (FR-028). Tests sit next to their sources. e2e tests go under `tests/e2e`. Three small refactors make existing code shareable instead of copied: `isLocalHost`, `runIsolatedQuery`, and the `executeRequest` overlay/sink.

## Implementation Phasing (input to /speckit-tasks)

1. **Foundation**: shared types and schemas, test-map file schema and linking, storage paths and store, `isLocalHost` extraction, `executeRequest` overlay/sink with no behavior change for 001 (existing tests stay green). Covers FR-001..004.
2. **Test map in the API Client (P1, US2)**: load/replace/export/remove IPC, side-panel marker, Verification queries section with editing and variable highlighting, re-match on re-import.
3. **Run without database (P1, US1)**: plan steps and phases, inputs, target-host guard, orchestrator lifecycle, step executor, verdicts, captures and blocked steps, sensitive-value masking, snapshot window + request card, evidence writer + Markdown, test-run view (setup/progress/summary), Open evidence.
4. **Automatic mode (P1, US3)**: `runIsolatedQuery`, automatic query runner, data-change approval, query card, result tables and truncation.
5. **Control & cleanup (P2, US6/US7)**: pauses infrastructure, Stop → cleanup/keep data, unexpected-401 credentials pause, `forEach` cleanup, ledger, Run cleanup only.
6. **Manual mode (P2, US5)**: manual-queries pause, copy/paste, evidence marking.
7. **Browser mode (P2, US4)**: console tab picker, browser console driver, recovery pause, partial-result detection, sensitive-value blurring before each console screenshot (withheld when it cannot be verified).
8. **Concurrent groups (P3, US8)**: grouped send and `expectAll` matcher.
9. **Hardening**: e2e suite, cross-platform checks (Windows paths, Linux offscreen), published JSON Schema, localization strings, docs reference page for authors/agents writing test maps.

## Complexity Tracking

| Addition                                                                       | Why Needed                                                                                                                                                                                      | Simpler Alternative Rejected Because                                                                                                                                                                                                          |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hidden offscreen `BrowserWindow` + new `evidence-snapshot.html` renderer entry | Screenshots must show the API Client/SQL views even when the user is on another tab or worktree, without taking focus (FR-024, SC-008). Rendering masked data makes FR-025 hold by construction | Capturing the live tab needs it visible and selected, which steals the user's view and fails when they are elsewhere. html-to-image in the main renderer blocks the UI and breaks on Monaco and canvas. Markdown-only evidence fails the spec |
| `executeRequest` gains optional `variableOverlay`/`variableSink`               | Run inputs (tokens) must not be written into the saved environment, and every captured value must be recorded (FR-008, FR-017)                                                                  | Writing inputs into the environment and restoring it later leaks secrets on a crash and shows changing values in other tabs. A parallel request executor would duplicate 001's script, auth, and masking pipeline                             |
