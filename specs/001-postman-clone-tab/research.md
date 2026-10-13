# Phase 0 Research: API Client Tab (Postman-compatible)

**Feature**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md) | **Date**: 2026-10-02

Constraint from the user: build with the project's current stack (Electron + React 19 + TypeScript + zustand + zod + Tailwind/shadcn, Vitest, Playwright). Every decision below reuses an existing Orca mechanism unless none fits; new dependencies are called out explicitly.

---

## R1. New tab type and '+' menu entry

- **Decision**: Add `'api-client'` to `TabContentType` / `WorkspaceVisibleTabType` (`src/shared/tab-types.ts`) and to the persisted zod enums (`src/shared/workspace-session-tab-type-schema.ts`). Add a `new-api-client` kind to `src/renderer/src/components/tab-bar/tab-create-menu-options.ts`, inserted with the other tab types (after Markdown/Simulator entries, before the agent list). Tab `entityId` = an opaque per-tab id; the request it shows is UI state on the tab (see R9). Model the open/ensure flow on `src/renderer/src/lib/ensure-simulator-tab.ts`.
- **Rationale**: The `simulator` tab is the newest non-terminal, non-editor tab type and touches exactly the set of files a new type needs (tab-bar projection, icons, close/bulk-close, tab cycling, drag data, palette search, `toVisibleTabType`). Following its footprint (`rg -l "'simulator'" src -g '!*.test.*'`, ~45 files) avoids missed switch branches.
- **Alternatives considered**: Reusing the `editor` family with a virtual file path (rejected: editor tabs assume a file-backed buffer, dirty-file prompts, and diff semantics); rendering inside a `browser` tab as a local web page (rejected: no access to main-process HTTP/encryption without a new privileged bridge, and breaks theming).

## R2. Hiding the option for SSH worktrees (FR-001a)

- **Decision**: The menu context gets a `hasApiClient` flag computed from the active worktree's execution host (`LOCAL_EXECUTION_HOST_ID` only). For remote hosts the option is rendered disabled with a "local worktrees only" hint. Main-process IPC/RPC handlers reject non-local worktree ids with a typed error.
- **Rationale**: Spec scopes SSH out; AGENTS.md requires that remote cases be considered — gating at both UI and main keeps the boundary explicit rather than assumed.
- **Alternatives considered**: Sending requests from the remote host via the relay (out of scope by spec).

## R3. Remote-wire / mixed-version safety for the new tab type

- **Decision**: Treat `api-client` tabs as host-local UI: exclude them from tab snapshots published to paired mobile/web clients (the same projection that already maps tab types for `mobile-session-*`), and make session hydration tolerate an unknown `contentType` by dropping that tab rather than failing the whole session parse.
- **Rationale**: `docs/reference/remote-wire-compatibility.md` — clients and hosts update independently; a strict `z.enum` on an older client would reject a session containing `api-client`. Not publishing it removes the risk entirely; the tolerant parse protects downgrade (a newer session file opened by an older build).
- **Alternatives considered**: Capability-negotiating a new tab type for remote clients (unnecessary — remote clients cannot use the feature).

## R4. Side panel (FR-002)

- **Decision**: Render-time override in the right sidebar: when the focused group's active tab is `api-client`, the sidebar body renders `ApiClientSidebarPanel` (collections tree + environments list) instead of the routed `rightSidebarTab` content. The persisted `RightSidebarRoute` is not changed, so switching to another tab restores the user's previous panel.
- **Rationale**: Matches the spec ("in place of its usual content; other tab types keep their current side panel") without adding a new persisted route value that older builds would normalize away (`normalizeRightSidebarRoute`).
- **Alternatives considered**: New `RightSidebarTab` value `'api-client'` in the activity bar (rejected: it would be visible for non-API tabs and needs persistence/migration); a left inner panel inside the tab (rejected: spec explicitly reuses the right side panel).

## R5. Where requests are sent from; proxy; SSL switch (FR-017a/b)

- **Decision**: Send from the **main process** with Electron `ses.fetch()` (not `net.fetch`, which always uses the default session) on two dedicated, non-persistent sessions: `session.fromPartition('orca-api-client')` (default verification) and `session.fromPartition('orca-api-client-insecure')` with `setCertificateVerifyProc(() => callback(0))`. The effective SSL setting (per-request override → app-wide Orca setting) chooses the session. `redirect: 'manual'` plus our own follow loop (max 10) so the console can show each hop and Postman's "follow redirects" setting is honored. Body is streamed and capped (R12). Cancellation via `AbortController`.
- **Rationale**: `ses.fetch()` uses Chromium's network stack (same as `net.fetch`), which applies the OS proxy configuration (incl. PAC) automatically — FR-017b with zero config. Orca already uses `net.fetch` in `src/main/host/electron-http-client.ts` and the rate-limit fetchers. Separate partitions isolate API Client cookies from the app's own sessions. Certificate errors surface as `net::ERR_CERT_*`, which we map to a "certificate rejected — turn off SSL verification" message.
- **Alternatives considered**: Node `fetch`/undici (rejected: no OS proxy support without manually resolving `session.resolveProxy` per request and wiring `ProxyAgent`; PAC not supported); sending from the renderer (rejected: CORS, forbidden headers, and secrets would have to reach the renderer).
- **Known limits to document in UI**: Chromium forbids overriding a few headers (e.g. `Host`, `Content-Length`, `Connection`); such headers are dropped with a console warning. Detailed phase timings (DNS/TLS) are not available — we report total time and time-to-first-byte.

## R6. Script execution sandbox (FR-015, "isolated from the app and the machine")

- **Decision**: Run pre-request and test scripts in **QuickJS (WebAssembly) via `quickjs-emscripten`**, hosted in a worker thread managed by the existing `LazyWorkerThreadHost` (`src/main/lazy-worker-thread-host.ts`). Each script execution gets a fresh QuickJS context with: memory limit (32 MB), interrupt-based timeout (5 s per script), no host I/O. A `pm` API shim (see [contracts/script-sandbox-api.md](./contracts/script-sandbox-api.md)) is injected along with a pre-bundled copy of `chai` (for `pm.expect`) produced at build time by `esbuild` (already a dev dependency) into a string module.
- **Rationale**: Postman collections are third-party code; Node's `vm` is explicitly not a security boundary and a `utilityProcess` with `vm` would still share Node APIs reachable through prototype tricks. QuickJS has no host bindings unless we add them, works identically on macOS/Linux/Windows (pure WASM — no native module, no glibc floor concerns per `docs/reference/linux-glibc-compatibility.md`), and runs off the main thread. Bundling the real `chai` makes `pm.expect(...).to.have.property/eql/be.an` behave like Postman (needed for SC-003).
- **Alternatives considered**: `node:vm` in a worker (rejected: not isolation); `isolated-vm` (rejected: native module, rebuilds per Electron ABI, Windows/Linux packaging burden); a hidden sandboxed `BrowserWindow`/iframe (rejected: heavier, needs a renderer per run, harder to time-limit synchronously).
- **New dependencies**: `quickjs-emscripten` (runtime dep, MIT), `chai` (bundled into the worker at build time, MIT). These are the only new packages.
- **Unsupported APIs**: `pm.sendRequest`, `pm.visualizer`, `pm.cookies`/cookie jar, `pm.require`, `require(...)` of npm modules except a no-op-compatible `require('chai')`. Calling them throws `NotSupportedError: pm.sendRequest is not supported in Orca`, which fails the test and appears in the console (spec Edge Cases). Import scans scripts with a regex for these names to populate the import warning list.

## R7. Variable resolution (FR-012, FR-013)

- **Decision**: Pure function in `src/shared/api-client/variable-resolution.ts`: scopes, narrowest first — run-local/script `pm.variables` → active environment → folder chain (innermost first) → collection variables. `{{name}}` with optional whitespace; dynamic variables (`{{$guid}}`, `{{$timestamp}}`, `{{$randomInt}}`, `{{$isoTimestamp}}`) supported; unknown `$` variables left literal. Same function drives the renderer's unresolved-variable highlighting and the main process sender.
- **Rationale**: One implementation for highlighting and sending avoids drift; living in `src/shared` keeps it unit-testable without Electron.
- **Alternatives considered**: Resolving only in main and asking for a preview over IPC on each keystroke (rejected: latency, chatty IPC).

## R8. Persistence location, format, and lifecycle (FR-027 – FR-030, SC-004/005)

- **Decision**: Store under `app.getPath('userData')/api-client/<hashWorktreeId(worktreeId)>/` (reusing `src/main/terminal-history-id.ts`), with a `meta.json` holding the raw `worktreeId`. Files are JSON, written with `writeFileDurable` (`src/main/durable-file-write.ts`), one file per collection/environment so a large collection edit does not rewrite everything. Layout in [contracts/storage-format.md](./contracts/storage-format.md).
  - **Deletion**: add `deleteWorktreeApiClientData(worktreeId)` next to both `deleteWorktreeHistoryDir(worktreeId)` call sites: `removeWorktreeMetadataAndTransientState` in `src/main/ipc/worktrees/removal/worktree-removal-ownership.ts` (also reached by folder-workspace removal via `remove-folder-workspace.ts`) and `src/main/runtime/orca-runtime-resolve-worktree-removal-target.ts` (CLI/runtime removal). Use the same tombstone-then-async-remove pattern as `terminal-history-deletion.ts` because worktree ids are path-derived and a recreated worktree may reuse the hash.
  - **Orphans** (worktree removed outside Orca): extend the startup GC pattern of `terminal-history-gc.ts` — after the live-worktree snapshot, tombstone `api-client/*` dirs whose `meta.worktreeId` is not live and that are older than the same 5-minute age guard.
- **Rationale**: Never inside the repo (SC-004 trivially holds — no `.gitignore` reliance). Branch switches don't affect `userData`. Reusing the history-dir lifecycle gets proven removal semantics for both git worktrees and folder workspaces.
- **Alternatives considered**: `.git/orca/…` inside the worktree's git dir (rejected: not available for folder workspaces, and `git worktree remove` would not clean it consistently); the main Orca store/SQLite (rejected: collections can be MBs, and per-worktree file trees make deletion atomic and cheap).

## R9. Concurrency and multi-tab consistency (FR-003, edge case "several tabs")

- **Decision**: Main process owns the data (`ApiClientStore` service, one in-memory cache per worktree, write-through). Renderer gets snapshots via IPC and subscribes to `apiClient:changed` events carrying `{ worktreeId, kind, id, revision }`. Writes carry the `revision` they were based on; a stale write returns `conflict` and the editor reloads. Each API Client tab stores `{ selectedRequestId, unsaved draft }` in renderer tab state; drafts are per tab, saved data is shared.
- **Rationale**: Mirrors Orca's main-owned stores (agent-status store guidance in AGENTS.md: one owner, readers subscribe). Required anyway because CLI/agent runs originate in main.
- **Alternatives considered**: Renderer-owned zustand state persisted via IPC (rejected: CLI runs would bypass it; two renderers/windows would race).

## R10. Secret variables at rest (FR-009, FR-009a, FR-009b)

- **Decision**: Encrypt each secret value with the existing `SecretStore` abstraction (`src/shared/secret-store.ts`, desktop impl `src/main/host/electron-secret-store.ts` → `safeStorage`). Stored as `{ "type": "secret", "cipher": "<base64>" }`; plaintext is never written. Decryption failure → value `null` + `needsReentry: true` (FR-009b). If `isEncryptionAvailable()` is false, secret values are not persisted (kept in memory for the session) and the editor shows the `describeProtectionGap()` message.
- **Rationale**: `safeStorage` uses the app's existing keychain entry, already created by Orca's other secret stores, so users see no new prompt (transparent, as clarified). Data copied to another machine cannot be decrypted, which is the FR-009b scenario.
- **Alternatives considered**: App-derived static key (rejected: obfuscation, not encryption); OS keychain item per secret (rejected: prompts on some platforms, and per-item keychain churn).
- **Agent/CLI access**: list/run results always mask secret values (`"••••"`) in resolved requests, headers and console entries; secrets are only decrypted in main at send time.

## R11. Postman import/export fidelity (FR-004, FR-007, FR-031, SC-001, SC-007)

- **Decision**: zod schemas for Collection v2.0/v2.1 and environment exports in `src/shared/api-client/postman-schema.ts`, using `.passthrough()` on every object. The internal model keeps a `postmanExtra` bag per node with unknown fields, and export re-emits them, so an unmodified collection round-trips. v2.0 is normalized to v2.1 on import (URL string ↔ object, `auth` array/object forms). Stable ids: reuse Postman's `_postman_id` / item `id` when present, else generate a UUID once at import time and persist it (FR-034).
- **Rationale**: zod is already the project's validation library; passthrough is the simplest way to avoid silent data loss for fields we don't model (e.g. `protocolProfileBehavior`, `event[].script.packages`).
- **Alternatives considered**: `postman-collection` npm SDK (rejected: large, pulls lodash/faker-like deps, models more than needed, harder to keep strict TS); storing the raw Postman JSON and editing it in place (rejected: makes the tree UI and stable ids awkward).
- **Validation errors** (acceptance 1.4): parse failure reports the zod issue path and message ("item[3].request.url: expected string or object"); nothing is written until parsing fully succeeds.

## R12. Large responses and responsiveness (SC-006)

- **Decision**: Main streams the body; keeps up to 10 MB in memory per response, beyond that marks `truncated` and stops reading. Binary (non-text content types or invalid UTF-8) is shown as a size/type notice with "Save to file…". JSON pretty-printing for display happens in the renderer only for bodies ≤ 2 MB; larger bodies open in the raw Monaco view (Monaco handles multi-MB text). Console and runner lists use `@tanstack/react-virtual` (already a dependency). Console keeps a ring buffer of the last 500 entries per worktree in main (not persisted).
- **Rationale**: Uses existing renderer deps (`@monaco-editor/react`, `@tanstack/react-virtual`); keeps IPC payloads bounded.
- **Alternatives considered**: Persisting the console (not required by spec; would bloat userData).

## R13. Runner (FR-021 – FR-026)

- **Decision**: `ApiClientRunner` in main executes a snapshot of the selected requests (copied at start — edge case "edited during run"), sequentially, with iterations/delay/stop-on-failure. Variable mutations by scripts apply to an in-run working copy of environment + collection variables, then are written back to the stored environment/collection at the end of each request (Postman behavior), so later requests and later runs see them. Progress streams over `apiClient:runProgress` events. Latest run per scope persisted at `runs/<scopeId>.json`.
- **Rationale**: Main-owned so CLI/agent runs and UI runs share one code path (FR-033/036).

## R14. Agent and CLI access (FR-032 – FR-037)

- **Decision**: New runtime RPC methods in `src/main/runtime/rpc/methods/api-client.ts` registered in `methods/index.ts`, with zod param schemas in `src/shared/rpc-contract/api-client-params.ts`; CLI specs in `src/cli/specs/api-client.ts` and handlers in `src/cli/handlers/api-client.ts`, mirroring the `emulator` group. Commands: `orca api list`, `orca api envs`, `orca api run`, `orca api result`, `orca api show`. There are no write commands (FR-035). `api.show` reaches the renderer through the content-creation IPC bridge pattern (`hooks/ipc-events/content-creation-ipc-bridge.ts`, as `emulator.onPaneFocus` does) to ensure/activate an API Client tab and select the request. Contract in [contracts/cli-rpc.md](./contracts/cli-rpc.md).
- **Rationale**: Existing CLI → runtime RPC → main → renderer path; agents in Orca terminals already use the `orca` CLI. Bundled skill guide updates are required by `verify:bundled-skill-guides`.
- **Alternatives considered**: An MCP server (rejected: Orca's agent surface is the CLI).

## R15. UI components and design system

- **Decision**: shadcn primitives from `src/renderer/src/components/ui/` (Tabs for Params/Headers/Body/Scripts, Select for environment, DropdownMenu/ContextMenu for "…"/Run, Dialog for import conflicts and unsaved-changes, Checkbox, Input, Switch, Badge for method/status, ScrollArea, Collapsible for console entries). There is no Table or Resizable primitive: variable/param tables are semantic `<table>` markup styled with tokens, and the request/response/console splitters reuse the existing resize-handle pattern (`components/activity/activity-thread-list-resize-handle.tsx`, `TabGroupSplitLayout.tsx`) instead of adding a new library, tokens from `src/renderer/src/assets/main.css`, `lucide-react` icons, Monaco for body/script/response. All strings through `translate()` with catalog entries (localization verify scripts). Layout follows Postman screenshots only structurally (spec assumption).
- **Rationale**: AGENTS.md / `docs/STYLEGUIDE.md` mandate; changed-lines design-system lint gates CI.

## R16. Testing strategy

- **Decision**:
  - Vitest unit tests (co-located `*.test.ts`) for: Postman parse/normalize/export round-trip (synthetic fixture mirroring the user's sample shape: 2 top-level folders, nested groups, 37 requests with test scripts, 27-variable env incl. secrets), variable resolution, storage read/write/tombstone/GC, secret encryption with a fake `SecretStore`, sandbox `pm` API against canned responses, runner sequencing/stop/variable propagation using a local `http.createServer` in tests.
  - Renderer component tests with Testing Library + happy-dom for tree, environment table (scroll container, masking, unsaved prompt) and console expand/collapse.
  - Playwright Electron e2e (background launch, `ORCA_BACKGROUND_LAUNCH=1`, CDP screenshots, per AGENTS.md) for the P1 flows in [quickstart.md](./quickstart.md).
- **Rationale**: Existing test stack; no new test tooling.

All Technical Context unknowns are resolved; no NEEDS CLARIFICATION remains.
