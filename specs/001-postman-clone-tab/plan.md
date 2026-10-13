# Implementation Plan: API Client Tab (Postman-compatible)

**Branch**: `franktique/feat-postman-clone-tab` (spec dir `001-postman-clone-tab`) | **Date**: 2026-10-02 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/001-postman-clone-tab/spec.md`, planned with the project's current tech stack.

## Summary

Add an `api-client` tab type to Orca, offered in the '+' menu for local worktrees and folder workspaces. The tab edits and sends one Postman-style HTTP request at a time, shows the response, test results and a collapsible console, and opens a runner for folders/collections. The right side panel shows the worktree's collections and environments while such a tab is active.

The main process owns all data and execution. Data is stored as JSON under `userData/api-client/<worktree hash>/`, outside the repository, with secret values encrypted through the existing `SecretStore`/`safeStorage`. It is deleted on the same hooks that delete terminal history today. Requests go through Electron `session.fetch()` on one of two in-memory session partitions (SSL verification on/off), which uses Chromium's network stack and picks up the OS proxy automatically. (`net.fetch` always uses the default session, so it can't be used here.) Postman scripts run in a QuickJS (WebAssembly) sandbox inside a worker thread, with a `pm` API shim and a bundled copy of `chai`. Agents get read/run-only access through new `orca api …` CLI commands backed by runtime RPC methods. Details: [research.md](./research.md).

## Technical Context

**Language/Version**: TypeScript (strict), Node 24, Electron (current repo version), React 19

**Primary Dependencies**: Existing: electron (`session.fetch`, `safeStorage`), zustand, zod, radix-ui/shadcn primitives, Tailwind, lucide-react, @monaco-editor/react, @tanstack/react-virtual, i18next. **New**: `quickjs-emscripten` (script sandbox), `chai` (bundled once with existing esbuild into a checked-in generated source file, verified by `verify:api-client-chai`), `ajv` (dev only, validates exports against the Postman v2.1 JSON schema)

**Storage**: Per-worktree JSON files in `app.getPath('userData')/api-client/<hashWorktreeId>/` written with `writeFileDurable`; secrets encrypted via `SecretStore`; console kept in memory (500-entry ring buffer)

**Testing**: Vitest (unit + Testing Library/happy-dom), Playwright Electron e2e with `ORCA_BACKGROUND_LAUNCH=1` and CDP screenshots

**Target Platform**: Orca desktop on macOS, Linux, Windows (local execution host only; SSH worktrees excluded by spec)

**Project Type**: Desktop app (Electron main + preload + React renderer + `orca` CLI)

**Performance Goals**: Smooth scrolling/typing with a 5 MB response or 100+ runner results (SC-006). From '+' to the first response in under 1 minute (SC-002). Script timeout 5 s per script

**Constraints**: No files in the repo working tree (SC-004). Secrets never on disk in plain text (FR-009a). Agents cannot write data (FR-035). Response bodies capped at 10 MB. The main thread never runs user scripts. Must respect the design-system lint, localization verification, `max-lines` (no disables), and the no-vague-file-names rule

**Scale/Scope**: Collections of hundreds of requests (sample: 37 requests, 27 env variables), multiple API Client tabs per worktree, many worktrees

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

`.specify/memory/constitution.md` is still the unfilled template, so the project's binding rules in `AGENTS.md` (plus `docs/STYLEGUIDE.md`) act as the constitution.

| Gate (AGENTS.md)                                                                                  | Status | How the design satisfies it                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Design system: tokens + `components/ui` primitives, no raw palette, no computed classNames        | PASS   | R15: only existing primitives; semantic tables and the existing resize-handle pattern where no primitive exists                                                                                                                                                                        |
| Reuse before reimplementing                                                                       | PASS   | Reuses `SecretStore`, `writeFileDurable`, `hashWorktreeId`, the terminal-history tombstone/GC lifecycle, `LazyWorkerThreadHost`, Chromium networking via `session.fetch()`, the simulator-tab integration footprint, the emulator CLI/RPC pattern, and the content-creation IPC bridge |
| SSH use case considered                                                                           | PASS   | Explicitly local-only (spec). Gated in the UI and in main (R2)                                                                                                                                                                                                                         |
| Folder workspaces as well as git worktrees                                                        | PASS   | Keyed by worktree id; deletion hook `removeWorktreeMetadataAndTransientState` covers folder workspaces (R8)                                                                                                                                                                            |
| Remote wire compatibility                                                                         | PASS   | New RPC methods only. `api-client` tabs are not published to paired clients, and session parsing tolerates the unknown tab type (R3)                                                                                                                                                   |
| Cross-platform (paths, shortcuts, child processes)                                                | PASS   | `path.join`; WASM sandbox (no native module, no glibc risk); no child processes spawned; shortcuts use the platform modifier check                                                                                                                                                     |
| Electron UI validation in the background                                                          | PASS   | quickstart e2e uses `ORCA_BACKGROUND_LAUNCH=1`, CDP screenshots, no window focus                                                                                                                                                                                                       |
| Git safety / provider compatibility                                                               | N/A    | No git commands added                                                                                                                                                                                                                                                                  |
| Agent status store                                                                                | N/A    | No agent-status producers                                                                                                                                                                                                                                                              |
| File naming (no `helpers/utils`), `.ts` over `.d.ts`, no unchecked casts, no `max-lines` disables | PASS   | Module names below are domain-specific. zod parsing replaces casts. Large UI split into focused components                                                                                                                                                                             |
| Brief comments only                                                                               | PASS   | Implementation guidance                                                                                                                                                                                                                                                                |

**Post-design re-check (after Phase 1)**: PASS. The contracts add no write paths for agents, no repo files, and no new native modules. One justified addition, the new dependencies, is recorded under Complexity Tracking.

## Project Structure

### Documentation (this feature)

```text
specs/001-postman-clone-tab/
├── spec.md
├── plan.md              # This file
├── research.md          # Phase 0
├── data-model.md        # Phase 1
├── quickstart.md        # Phase 1
├── contracts/
│   ├── ipc-renderer-main.md
│   ├── cli-rpc.md
│   ├── storage-format.md
│   └── script-sandbox-api.md
├── checklists/requirements.md
└── tasks.md             # Phase 2 (/speckit-tasks — not created here)
```

### Source Code (repository root)

```text
src/shared/
├── tab-types.ts                                  # + 'api-client' (TabContentType, WorkspaceVisibleTabType)
├── workspace-session-tab-type-schema.ts          # + 'api-client'; tolerant parse of unknown types
├── api-client/
│   ├── api-client-types.ts                       # entities from data-model.md
│   ├── api-client-schemas.ts                     # zod for storage + IPC payloads
│   ├── postman-schema.ts                         # Postman v2.0/v2.1 + environment zod (passthrough)
│   ├── postman-import.ts / postman-export.ts     # normalize ↔ internal model, round-trip
│   ├── variable-resolution.ts                    # {{var}} scopes + dynamic vars, unresolved spans
│   ├── collection-tree.ts                        # find/move/flatten (depth-first run order)
│   └── __fixtures__/smoke.postman_*.json
└── rpc-contract/api-client-params.ts             # RPC zod params

src/main/api-client/
├── api-client-store.ts                           # per-worktree cache, revisions, write-through, events
├── api-client-storage-paths.ts                   # userData/api-client/<hash>, meta.json
├── api-client-data-deletion.ts                   # tombstone + async removal (mirrors terminal-history-deletion)
├── api-client-data-gc.ts                         # startup orphan GC
├── api-client-secret-codec.ts                    # SecretStore encrypt/decrypt, FR-009b
├── http-request-sender.ts                        # session.fetch, partitions, redirects, caps, cancel, error mapping
├── request-execution.ts                          # scripts → resolve → send → tests → LatestResult + console
├── collection-runner.ts                          # sequential runs, iterations, delay, stop, progress
├── api-client-console-buffer.ts                  # 500-entry ring buffer per worktree
└── script-sandbox/
    ├── script-sandbox-client.ts                  # LazyWorkerThreadHost client
    ├── script-sandbox-worker-entry.ts            # QuickJS host
    └── pm-api-shim.ts                            # pm/postman/tests globals (contracts/script-sandbox-api.md)
src/main/ipc/api-client/api-client-ipc.ts         # contracts/ipc-renderer-main.md handlers
src/main/runtime/rpc/methods/api-client.ts        # + register in methods/index.ts
src/main/ipc/worktrees/removal/worktree-removal-ownership.ts      # + deleteWorktreeApiClientData
src/main/runtime/orca-runtime-resolve-worktree-removal-target.ts  # + deleteWorktreeApiClientData
src/main/startup/…                                # drain tombstones + schedule GC (next to history GC)

src/preload/api/api-client-api.ts (+ bridge)       # window.api.apiClient

src/renderer/src/
├── lib/ensure-api-client-tab.ts                  # modeled on ensure-simulator-tab.ts
├── store/slices/api-client.ts                    # snapshots, per-tab view/draft, subscriptions
├── hooks/ipc-events/content-creation-ipc-bridge.ts  # + apiClient:show → ensure tab + select
├── components/tab-bar/tab-create-menu-options.ts    # + 'new-api-client' (+ the ~45-file simulator footprint)
├── components/right-sidebar/…                    # render-time override → ApiClientSidebarPanel
└── components/api-client/
    ├── ApiClientPane.tsx                         # tab root: request | environment | runner view + console
    ├── request-editor/ (UrlBar, ParamsTable, HeadersTable, BodyEditor, AuthEditor, ScriptsEditor, RequestSettings)
    ├── response-viewer/ (ResponseSummary, ResponseBody, ResponseHeaders, TestResultsList)
    ├── console/ (ApiConsolePanel, ConsoleEntryRow)  # virtualized, collapsible, resizable, clearable
    ├── environment-editor/ (EnvironmentEditor, VariablesTable)  # sticky header + save, masking
    ├── runner/ (RunnerSetup, RunnerResults, RunSummary)
    └── sidebar/ (ApiClientSidebarPanel, CollectionTree, EnvironmentList, ImportDialog)

src/cli/specs/api-client.ts, src/cli/handlers/api-client.ts   # orca api list|envs|run|result|show
skill-guides/ (bundled CLI guide update)                       # verify:bundled-skill-guides
tests/e2e/api-client/                                          # Playwright scenarios from quickstart.md
```

**Structure Decision**: Follow Orca's existing split: `src/shared` for pure logic and contracts, `src/main` for data and execution, `src/preload` for the bridge, `src/renderer/src` for UI, and `src/cli` for agent access. Tests sit next to their sources (`*.test.ts[x]`), and e2e tests go under `tests/e2e`.

## Implementation Phasing (input to /speckit-tasks)

1. **Foundation (P1)**: shared model, Postman import/export, storage, deletion and GC hooks, secrets, the `api-client` tab type with its '+' entry, and the side panel tree. Covers US1 and US5.
2. **Send and inspect (P1)**: variable resolution, HTTP sender, script sandbox, request editor, response viewer, console. Covers US2.
3. **Environments (P2)**: environment editor and operations. Covers US3.
4. **Runner (P2)**: collection runner and runner UI. Covers US4.
5. **Agent access**: RPC, CLI, `api.show`, and the skill guide. Covers FR-032 to FR-037.
6. **Export (P3)**: Covers US6.

## Complexity Tracking

| Addition                                       | Why Needed                                                                                                               | Simpler Alternative Rejected Because                                                                                                                                        |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| New deps `quickjs-emscripten` + bundled `chai` | Imported Postman scripts are untrusted code. The spec requires isolation, and SC-003 needs Postman-equivalent assertions | `node:vm` is not a security boundary. `isolated-vm` is a native module with per-platform rebuild and glibc risk. A hand-written `expect` would diverge from Postman results |
| Two `session.fetch()` partitions               | Per-request SSL verification override with automatic OS proxy                                                            | Node/undici would need manual proxy/PAC resolution                                                                                                                          |
