---
description: "Task list for Agent Change Explanations"
---

# Tasks: Agent Change Explanations

**Input**: Design documents from `specs/002-agent-change-explanations/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/ (cli-rpc, publish-payload, ipc-renderer-main, storage-format, skill), quickstart.md

**Tests**: Included. quickstart.md §1 requires unit coverage of labels (`Z`→`AA`), relocation states (fresh/outdated/detached), every publish issue code, and change-set union/rename handling, plus Playwright e2e scenarios under `tests/e2e/agent-explanations/`. Tests sit next to sources (`*.test.ts[x]`). E2E always runs with `ORCA_BACKGROUND_LAUNCH=1` and CDP screenshots; never show or focus windows.

**Organization**: Grouped by user story so each story can be built and tested on its own.

**Binding rules for every task** (AGENTS.md acts as the constitution): use `docs/STYLEGUIDE.md` tokens and `components/ui/` primitives (no raw palette, no computed `className`); no `max-lines` disables; no vague file names; no unchecked casts (parse with zod); brief WHY-only comments; all UI strings via `translate()` under `auto.components.right.sidebar.explanations.*`; consider SSH, WSL, folder workspaces and mixed client/host versions; git commands limited to the 2.25 baseline (`merge-base`, `diff --name-status`, `show <oid>:<path>`, `status`, plus `hash-object -t tree --stdin` for the empty tree in repos with no commits).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: US1…US5 from spec.md

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Capability flag and the shared type vocabulary every later task imports.

- [X] T001 Add `export const AGENT_EXPLANATIONS_RUNTIME_CAPABILITY = 'agent-explanations.v1'` to `src/shared/protocol-version.ts` and append it to `RUNTIME_CAPABILITIES` in the same file (advertised through `src/main/runtime/orca-runtime-get-status.ts`; no change needed there). Also add it to `remoteRuntimeClientCapabilities()` in `src/shared/remote-runtime-client-capabilities.ts` so new clients advertise it; without that the host treats every client as old (T022, T033) and the tab never appears on paired runtimes. Cover it in a new `src/shared/remote-runtime-client-capabilities.test.ts`
- [X] T002 [P] Create `src/shared/agent-explanations/explanation-types.ts` with the types from data-model.md: `ExplanationSet` (`id`, `workspaceId`, `revision`, `producer: { agentName: string; paneKey?: string; terminalHandle?: string }`, `generatedAt` epoch ms, `changeSetBase: { kind: 'branch-and-uncommitted' | 'uncommitted-only'; baseRef: string | null; mergeBase: string; headOid: string | null }`, `changes`, `questions`, `publishWarnings`), `Change` (`index`, `title`, `summary`, `files`), `FileEntry` (`path`, `oldPath?`, `status: 'added' | 'modified' | 'deleted' | 'renamed' | 'copied'`, `position`, `items`), `ExplanationItem` (`id`, `clientId?`, `position`, `anchor: LineAnchor | { fileLevel: true }`, `text`), `LineAnchor` (`side: 'new' | 'old'`, `startLine`, `endLine`, `fingerprint: { lines: string[]; before: string[]; after: string[]; diffIdentity?: string }`), `FollowUpQuestion` (`id`, `itemId`, `body`, `createdAt`, `updatedAt?`, `state: 'draft' | 'sent'`, `sentAt?`, `sentTo?: { paneKey?: string; label: string }`), `PublishIssue` (`code`, `message`, `changeIndex?`, `fileIndex?`, `itemIndex?`, `clientId?`, `path?`), `PublishIssueCode` union (all codes in contracts/publish-payload.md#issue-codes), `ChangeSetBase`, `ChangeSetFile = { path; oldPath?; status }`, `ResolvedAnchor = { state: 'fresh' | 'outdated' | 'detached'; line?: number; endLine?: number }`, and the `PublishResult` response shape from contracts/publish-payload.md

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The data plane — schemas, labels, fingerprints, change set, storage, publish validation, and the RPC/CLI/IPC/preload surfaces for publish/get/changeSet/fileDiff. Every user story reads data produced here.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

### Shared pure logic

- [X] T003 Create zod schemas in `src/shared/agent-explanations/explanation-schemas.ts`: `ExplanationPublishPayload` enforcing exactly the rules in contracts/publish-payload.md — `version` "Must be `1`" (other values → `unsupported_version`, checked before the full parse), `agent` "≤ 40 chars", `changes` "1..104 entries", `title` "1..120 chars", `summary` "0..4000 chars", `files` "1..200 entries", `items` "1..100 entries", `items[].id` "≤ 64 chars", `side` `"new"` (default) or `"old"`, `startLine/endLine` "1-based, inclusive. `endLine` defaults to `startLine`. Leave both out for a file-level item"; leave `text` length unchecked in zod so empty/oversize text becomes per-item `text_empty`/`text_too_long` rejections (1..8192 chars); also the stored-file schema (`{ schemaVersion: 1, workspaceId, explanation }`, see contracts/storage-format.md) and `FollowUpQuestion` with `body` "1..8192". Export a JSON Schema generator for `orca explain schema` using zod's built-in JSON Schema output (no new dependency)
- [X] T004 [P] Implement `src/shared/agent-explanations/explanation-labels.ts`: `toChangeLetter(index)` bijective base-26 (`0→A`, `25→Z`, `26→AA`), `fileLabel` = letter + 1-based position, `itemLabel` = fileLabel + `.` + 1-based position, `buildGlobalOrder(set)` returning `{ itemId, label, path, changeIndex }[]` in change → file → item order, and `labelsForPath(set, path)` sorted by global order (research R6)
- [X] T005 [P] Unit tests in `src/shared/agent-explanations/explanation-labels.test.ts`: `Z`→`AA`→`AB`, `A1`/`B3.2` labels, a file in two changes yields `['A1','B3']`, global order crosses files and changes
- [X] T006 [P] Implement `src/shared/agent-explanations/explanation-anchor-fingerprint.ts`: `captureFingerprint(sideLines, startLine, endLine)` (anchored lines plus up to 2 context lines above/below, trailing whitespace trimmed), `hashSideContent(text)` producing `diffIdentity` as defined in data-model.md (pure synchronous FNV-1a over `\n`-normalized text plus line count, usable in main and renderer), and pure `relocateAnchor(anchor, currentSideContent, diffIdentity?)` returning `ResolvedAnchor` using research R5 order: same diffIdentity or same lines → `fresh`; exact block match → nearest match with context tie-break → `outdated`; whitespace-normalized match → `outdated`; else `detached`
- [X] T007 [P] Table-driven tests in `src/shared/agent-explanations/explanation-anchor-fingerprint.test.ts` covering fresh, moved (outdated), whitespace-changed (outdated), multiple matches resolved by context, deleted (detached), and the diffIdentity fast path
- [X] T008 [P] Create RPC params in `src/shared/rpc-contract/explanation-params.ts` for `explanation.publish` (`{ worktree, payload: unknown, agent?, terminalHandle? }`), `explanation.get`, `explanation.clear` (`{ worktree, explanationId? }`), `explanation.fileDiff` (`{ worktree, path, oldPath?, mergeBase }`), `explanation.changeSet`, `explanation.questions.upsert` (`{ worktree, explanationId, question: { id?, itemId, body } }`), `explanation.questions.markSent` (`{ worktree, explanationId, questionIds, sentTo: { paneKey?, label } }`), `explanation.questions.delete` (`{ worktree, explanationId, questionId }`), then regenerate the catalog so `pnpm run verify:rpc-params-catalog` passes (`config/scripts/generate-rpc-params-catalog.mjs`)

### Git: change set and per-file diff

- [X] T009 Add optional `leftOid` to the diff read in `src/main/git/source-control/file-diff.ts`, generalizing `compareAgainstHead: true` (left = `HEAD`) to left = any commit; binary detection, `assertGitDiffWithinTransportBudget` and WSL path handling stay unchanged; add cases to the existing file-diff tests
- [X] T010 [P] Forward `leftOid` in the `git.diff` request from `src/main/providers/ssh-git-read-provider.ts` and add a case to `src/main/providers/ssh-git-provider-diff.test.ts`
- [X] T011 [P] Honour optional `leftOid` in the relay's `git.diff` handler registered in `src/relay/git-handler-registration.ts` (and the read operation it calls, e.g. `src/relay/git-handler-read-operations.ts`); add a case to `src/relay/git-handler-file-diff.test.ts` (safe: relay is bundle-hash locked, research R3)
- [X] T012 Implement `src/main/agent-explanations/explanation-change-set.ts`: resolve base ref as `WorktreeMeta.baseRef` → `Repo.worktreeBaseRef` → repo default (`src/main/git/repo-default-base-ref.ts`); call existing `getRuntimeGitBranchCompare(selector, baseRef)` for `mergeBase`/`headOid`/branch entries and `getStatus` for uncommitted entries; union keyed by current path, keep `oldPath` for renames, status kind wins when in both; on `invalid-base`/`no-merge-base`/no base ref, or when `mergeBase === headOid` (working directly on the base branch), fall back to `HEAD` with `kind: 'uncommitted-only'`; on `unborn-head` (no commits yet) use the empty-tree oid from `git hash-object -t tree --stdin` with empty stdin (no `/dev/null`, so it works on Windows; correct for SHA-1 and SHA-256 repos) as `mergeBase`, with `kind: 'uncommitted-only'`, `headOid: null`, and every file `added`; first confirm `getStatus` lists files in an unborn repo; non-git folder workspace → `not_git_workspace`. Route through existing provider routing so SSH/WSL work (research R2)
- [X] T013 [P] Tests in `src/main/agent-explanations/explanation-change-set.test.ts`: union of branch + uncommitted, file in both lists keeps status kind, rename keeps `oldPath`, each fallback reason → `uncommitted-only`, HEAD on the base branch (`mergeBase === headOid`) → `uncommitted-only`, repo with no commits → `uncommitted-only` with empty-tree `mergeBase`, `headOid: null` and all files `added`, non-git folder → `not_git_workspace`
- [X] T014 Implement `src/main/agent-explanations/explanation-file-diff.ts`: one file's diff merge-base (or `HEAD`) blob vs working tree via `getDiff` with `leftOid` (T009), for local and SSH paths; returns the existing `GitDiffResult`

### Storage and store

- [X] T015 [P] Implement `src/main/agent-explanations/explanation-storage-paths.ts`: `join(root, 'agent-explanations', hashWorktreeId(workspaceId) + '.json')` and `corrupt/<hash>-<ts>.json`, root passed as a parameter for tests (mirror `src/main/api-client/api-client-storage-paths.ts`)
- [X] T016 Implement `src/main/agent-explanations/explanation-store.ts`: lazy read + in-memory cache per workspace; writes via `writeFileDurable` (`src/main/durable-file-write.ts`) serialized per workspace with a promise chain; `revision` = previous + 1 (or 1) on every write; `replace(workspaceId, set)` returning `replacedPrevious`; `get`; emits `{ workspaceId, revision }` change events after every write; on parse/schema failure move the file to `corrupt/` and log once; an unknown `schemaVersion` > 1 is treated as unreadable and NOT moved (contracts/storage-format.md)
- [X] T017 [P] Tests in `src/main/agent-explanations/explanation-store.test.ts`: revision increments, concurrent writes serialize (later publish wins), corrupt file is quarantined, `schemaVersion: 2` is left in place and reads as null, change event emitted per write, two concurrent `replace` calls → the second returns `replacedPrevious: true` and its set is the one stored
- [X] T018 Implement `src/main/agent-explanations/explanation-data-deletion.ts` exporting `deleteWorkspaceExplanation(workspaceId)` (mirror `src/main/api-client/api-client-data-deletion.ts`), wire it into `src/main/runtime/orca-runtime-resolve-worktree-removal-target.ts` and `src/main/ipc/worktrees/removal/worktree-removal-ownership.ts` next to `deleteWorktreeApiClientData`, and extend the orphan GC in `src/main/api-client/api-client-data-gc.ts` to also sweep the `agent-explanations` root; cover folder workspaces; add tests next to each changed file

### Publish validation

- [X] T019 Implement `src/main/agent-explanations/explanation-publish.ts`: fatal checks (`invalid_payload` with zod path, `unsupported_version`, `payload_too_large` when the re-serialized payload exceeds 900 KB (backstop; the CLI checks first, T024), `too_many_items` "> 500 items", `no_changes` for an empty change set; a non-git folder is refused earlier with `not_git_workspace` by T021); normalize paths (leading `./`, backslashes) with `normalizeRuntimeGitRelativePath`; per item reject `file_not_in_change_set`, `side_unavailable` (`old` on added, `new` on deleted), `line_out_of_range` (`1 ≤ startLine ≤ endLine ≤ lineCount(side)`), `line_anchor_unsupported` (line anchor on binary/over-budget file), `text_empty`/`text_too_long` (> 8192); warn `outside_changed_hunk` and `duplicate_file_in_change` (merge into the first entry). Read each side once with a fixed concurrency limit; capture fingerprints (T006), including `diffIdentity = hashSideContent(sideText)` for each anchored side; after per-item rejection drop file entries with no valid items and changes with no remaining files, **then** assign uuids, positions and letters from what survives so labels stay gap-free (FR-010), with response `labels` mapping each surviving `clientId` to its final label; take `oldPath`/`status` from the change set; resolve producer (`--agent` > payload `agent` > pane agent status > `"agent"`; `terminalHandle` → `paneKey` via the runtime terminal registry); if every item is rejected return `published: false` and keep the previous set; otherwise store via T016 and return the full response from contracts/publish-payload.md (`counts`, `labels` with client ids, `rejected`, `warnings`, `replacedPrevious`, `changeSetBase`)
- [X] T020 [P] Tests in `src/main/agent-explanations/explanation-publish.test.ts` covering every issue code in contracts/publish-payload.md#issue-codes, partial publish, all-rejected keeps the previous set, path normalization, a renamed file anchored by its old path → `file_not_in_change_set` naming the new path, producer resolution order, and the quickstart §2 payload producing `A1.1`, `A2.1`, `B1.1` with `line_out_of_range` and `file_not_in_change_set` rejections; a file whose items are all rejected leaves no gap (`A1, A2`, not `A1, A3`) and a change whose files are all rejected doesn't consume a letter; in a repo with no commits, a `side: "old"` item is rejected with `side_unavailable`; a timed case where a 50-file, 500-item payload against a fixture repo validates in < 2 s (plan performance goal)

### Runtime RPC, CLI, IPC, preload, renderer client

- [X] T021 Create `src/main/runtime/rpc/methods/explanation.ts` with `explanation.publish`, `explanation.get`, `explanation.changeSet` and `explanation.fileDiff`, resolving `worktree` via `runtime.showTerminalWorkspaceLaunchScope` like `resolveTarget` in `src/main/runtime/rpc/methods/api-client.ts`; failures are `{ ok: false, code, message }` with codes `selector_not_found`, `not_git_workspace` (checked for every method, publish included, before the payload is parsed), `invalid_params`; register in `src/main/runtime/rpc/methods/index.ts`. Do NOT add to `src/main/runtime/runtime-rpc/runtime-rpc-mobile-method-allowlist.ts`
- [X] T022 Add `{ type: 'explanationsChanged'; workspaceId: string; revision: number }` to `RuntimeClientEvent` in `src/shared/runtime-client-events.ts` and forward store change events to paired clients through `src/main/runtime/runtime-client-event-bus.ts`, only to clients that advertised `agent-explanations.v1` (research R9)
- [X] T023 [P] Create CLI specs in `src/cli/specs/explanation.ts` for `orca explain publish --input-stdin [--agent] [--worktree] [--json]`, `show`, `changes`, and `schema` (modeled on `src/cli/specs/api-client.ts`), register in `src/cli/specs/index.ts`
- [X] T024 Create handlers in `src/cli/handlers/explanation.ts` (modeled on `src/cli/handlers/api-client.ts`): publish reads stdin only (confirm `src/relay/remote-cli-stdin.ts` forwards `--input-stdin`) and, before connecting to the runtime, fails with `payload_too_large` (exit 1, message telling the agent to shorten item text or drop items) when stdin exceeds 900 KB, since the RPC transports drop messages over 1 MB with a generic error; sends `terminalHandle` from `ORCA_TERMINAL_HANDLE`, `--worktree` defaults via `resolveCurrentWorktreeSelector`, exit 0 when `published: true` even with rejections, exit 1 on fatal or nothing published, human output = summary line then one line per issue (`A2 item 3: line_out_of_range — …`); `show` prints legend, labelled files, items and questions (`--json` = set + labels); `changes` calls `explanation.changeSet` and prints the base line then one `status path [← oldPath]` per file (`--json` = raw result); `schema` prints the JSON Schema without a runtime; map `method_not_found` → `This Orca version does not support agent explanations.` (exit 1). Register in `src/cli/handler-group-manifest.ts` and update `src/cli/registry-parity.test.ts` / `src/cli/handler-group-manifest.test.ts` as required
- [X] T025 [P] Tests in `src/cli/handlers/explanation.test.ts`: stdin required, stdin over 900 KB → `payload_too_large` without calling the runtime, exit codes, human output format, `method_not_found` message, `terminalHandle` forwarding, `changes` output and its `method_not_found` case, `schema` without runtime
- [X] T026 Create `src/main/ipc/agent-explanations/explanation-ipc.ts` with invoke channels `explanations:get`, `explanations:changeSet`, `explanations:fileDiff` (`changeSet` and `fileDiff` take optional `connectionId` to route SSH git reads, as `window.api.git.diff` does; zod-validated, calling the same store/change-set/file-diff functions as the RPC) and broadcast `explanations:changed` `{ workspaceId, revision }` to all windows on every store event; register it in `src/main/ipc/register-core-handlers/register-core-handlers.ts`. No publish over IPC
- [X] T027 [P] Create `src/preload/api/explanations-api.ts` (+ bridge file following `api-client-api.ts`/`api-client-bridge.ts`) exposing `window.api.explanations` `get`, `changeSet`, `fileDiff`, `onChanged` (returns unsubscribe) per contracts/ipc-renderer-main.md; wire into `src/preload/index.ts` and `src/preload/api-types.ts`
- [X] T028 Create `src/renderer/src/runtime/runtime-explanation-client.ts` choosing local IPC vs `callRuntimeRpc` exactly like `src/renderer/src/runtime/runtime-git-diff-client.ts`; for `runtime:` workspaces return "unsupported" when the host lacks `agent-explanations.v1` (`runtimeEnvironmentSupportsCapability`)

**Checkpoint**: `orca-dev explain publish/show/schema` works end to end from a terminal (quickstart §2), stored under `userData/agent-explanations/`, and the renderer can read it.

---

## Phase 3: User Story 1 - Ask an agent to explain its changes and read the explanation in the diff (Priority: P1) 🎯 MVP

**Goal**: An agent runs the `orca-explain` skill and publishes; an Explanations tab appears next to Source Control with the legend and labelled files; opening a file shows numbered circles that open the explanation inline.

**Independent Test**: In a workspace with branch + uncommitted changes, run the skill (or quickstart §2's CLI publish); the tab appears within 2 s with no reload, `src/a.ts` shows `A1 B1`, unexplained files sit under "Unexplained", and each circle opens the right explanation (quickstart rows US1-1…US1-6).

### Skill

- [X] T029 [US1] Write the full, self-contained skill at `~/.claude/skills/orca-explain/SKILL.md` on the local host (outside the repo; not bundled or installed by Orca) with the frontmatter and required behaviors 1–8 in contracts/skill.md (behavior 9, clear, is added with the command in T074): CLI resolution written out inline (same rules as `skills/orca-cli/SKILL.md`); change set via `orca explain changes --json`, line content via `git diff <mergeBase> -- <path>`; `not_git_workspace`/empty change set → tell the user there is nothing to explain; group into 1–5 changes; anchor `new`/`old` with ranges, explain why, ≤ ~120 words; publish via POSIX heredoc or `Get-Content -Raw <file> | orca explain publish --input-stdin --json`, temp files only in OS temp dir; fix `rejected[]` and re-publish once; SSH relay error → tell user and stop; follow-up questions answered in chat
- [X] T030 [US1] Create the shared link `~/.agents/skills/orca-explain` → `~/.claude/skills/orca-explain` on the local host (junction on Windows, copy as fallback) so Copilot CLI and Pi find the same folder; if the copy fallback was used, note in the skill folder that the copy must be refreshed by hand whenever `~/.claude/skills/orca-explain/SKILL.md` changes; the WSL/SSH placement steps live in quickstart.md §4
- [ ] T031 [US1] Smoke-test the skill from Claude Code against the quickstart §2 workspace: the agent resolves the CLI, publishes a 2-change explanation, and handles one deliberate rejection; adjust the skill wording until it passes

### Sidebar tab

- [X] T032 [P] [US1] Add `'explanations'` to `RightSidebarTab` in `src/shared/ui-chrome-types.ts`, to `STATIC_RIGHT_SIDEBAR_TABS` in `src/shared/rpc-contract/client-ui-params.ts`, and to the accepted list in `normalizeRightSidebarTab` (`src/main/persistence/applying-settings/ui-selection-normalization.ts`) so a persisted tab doesn't reset on restart; keep the `ui-state-schema-parity` checks green
- [X] T033 [US1] In the client-ui sync serializer that sends `rightSidebarTab` in `ui.update` (locate via `RightSidebarTabParam` usages, e.g. `src/renderer/src/app-shell/use-persisted-ui-writer.ts`), map `'explanations'` → `'source-control'` for hosts without `agent-explanations.v1`; on the host side, map it the same way in the `ui.get` response (`src/main/runtime/rpc/methods/client-ui.ts`) for clients that did not advertise the capability, so older clients never receive an id they reject; add tests for both directions
- [X] T034 [US1] Create store slice `src/renderer/src/store/slices/agent-explanations.ts`: per-workspace `{ explanation, revision, changeSet, focusedChangeIndex, activeItemId }`; `loadExplanation(workspaceId)` via T028; subscribe to `onChanged` and refetch only when `revision` is newer; refetch on workspace activation and when the tab opens; register the slice in the root store
- [X] T034a [US1] For `runtime:` workspaces whose host advertises `agent-explanations.v1`, handle `explanationsChanged` from `subscribeRuntimeClientEvents` (`src/renderer/src/runtime/runtime-client-events.ts`) in `src/renderer/src/store/slices/agent-explanations.ts` with the same rule as T034 (refetch `get` only when `revision` is newer), and refetch the active workspace on `onReplayedAfterReconnect`, since events emitted while the transport was down are lost; without this the tab never appears for paired runtimes (it is hidden, so "refetch when the tab opens" can't fire). Add tests next to the slice
- [X] T035 [US1] Add the Explanations activity item right after Source Control in `src/renderer/src/components/right-sidebar/use-right-sidebar-activity-items.ts` (lucide `MessageSquareText`, `requiresExplanation: true`, `gitOnly: true`) and add `ActivityBarItem.requiresExplanation` + a `hasExplanation` rule to `getVisibleRightSidebarActivityItems` in `src/renderer/src/components/right-sidebar/right-sidebar-activity-visibility.ts` (hidden when the active workspace has no explanation, FR-006); add tests to the visibility test file
- [X] T036 [US1] Route `effectiveTab === 'explanations'` to `ExplanationsPanel` in `src/renderer/src/components/right-sidebar/right-sidebar-panel-content.tsx`

### Panel

- [X] T037 [P] [US1] Implement `src/renderer/src/components/right-sidebar/explanations/explanation-panel-model.ts`: merge the set with the live change set into rows `{ path, oldPath?, status, labels: string[], explained: boolean }`; explained rows first sorted by first label, the rest under "Unexplained" sorted by path (FR-007); files in the set but no longer in the change set stay listed with a `noLongerChanged` flag; when the live change set is unavailable because the host is unreachable (SSH disconnected), mark it `unavailable` rather than empty: list the set's file entries with their labels, no `noLongerChanged` flags and no "Unexplained" group (spec edge case: the last explanation stays readable); `filterByChange(changeIndex)` returns that change's files in `B1, B2…` order (FR-009)
- [X] T038 [P] [US1] Tests in `src/renderer/src/components/right-sidebar/explanations/explanation-panel-model.test.ts`: ordering, multi-label rows (`A1 B3`), Unexplained group, focus filter, no-longer-changed rows, unavailable change set (no flags, no Unexplained group)
- [X] T039 [P] [US1] Create `src/renderer/src/components/right-sidebar/explanations/explanation-change-legend.tsx`: ghost `Button` rows (letter, title, markdown summary) with a selected state that sets `focusedChangeIndex`
- [X] T040 [P] [US1] Create `src/renderer/src/components/right-sidebar/explanations/explanation-file-list.tsx`: rows following Source Control row layout, status letter from `src/renderer/src/components/right-sidebar/status-display.ts`, token-styled label chips, "Unexplained" group; click opens the explanation diff (T043)
- [X] T041 [US1] Create `src/renderer/src/components/right-sidebar/explanations/ExplanationsPanel.tsx`: header (agent name, relative generated time, base ref from `changeSetBase.baseRef` or "uncommitted changes only"), legend (T039), file list (T040); a "Host disconnected — showing the last saved explanation" notice while the change set is `unavailable` (T037), refetching it on reconnect

### Explanation diff source

- [X] T042 [US1] Add `'explanation'` to `DiffSource` and optional `explanationRef: { explanationId: string; focusItemId?: string }` plus `mergeBase` to `OpenFile` in `src/renderer/src/store/slices/editor/types/open-file.ts`
- [X] T043 [US1] Create `src/renderer/src/store/slices/editor/actions/open-explanation-diff.ts` opening (or reusing) a diff tab for a path with `diffSource: 'explanation'`, `explanationRef`, `mergeBase`; unexplained files open with the same source and no markers
- [X] T044 [US1] Load content for the `explanation` source via `fileDiff` (T028) in `src/renderer/src/components/editor/editor-panel-diff-reload.ts`, and label it "Explanation" plus the base in `src/renderer/src/components/editor/editor-labels.ts` and `src/renderer/src/components/editor/editor-header.ts`

### Markers and card

- [X] T045 [P] [US1] Implement `src/renderer/src/components/editor/explanation-diff/explanation-marker-layout.ts`: group items by (side, resolved line) so several markers sit side by side (FR-012), compute tops from `getTopForLineNumber`, map `old`-side anchors to the original editor and, in inline mode, to the deleted-line view via the diff editor's line mapping
- [X] T046 [P] [US1] Tests in `src/renderer/src/components/editor/explanation-diff/explanation-marker-layout.test.ts`: grouping on one line, old/new side routing, inline-mode mapping, laying out 60 markers on a 5k-line model within one frame budget (~16 ms)
- [X] T047 [US1] Create `src/renderer/src/components/editor/explanation-diff/ExplanationMarkerLane.tsx`: absolutely positioned round buttons labelled `A1.1` in a lane widened via `lineDecorationsWidth`, repositioned on scroll (technique from `src/renderer/src/components/diff-comments/diff-comment-add-button-overlay.ts`); accent/muted token pair; click sets `activeItemId`
- [X] T048 [US1] Create `src/renderer/src/components/editor/explanation-diff/use-explanation-diff-decorations.ts`: view-zone lifecycle under the anchor's last line reusing `src/renderer/src/components/diff-comments/diff-comment-view-zone-entry.ts`, and a subtle token-based range highlight while the card is open
- [X] T049 [US1] Create `src/renderer/src/components/editor/explanation-diff/ExplanationCard.tsx`: label, explanation text via the existing `react-markdown` setup (no raw HTML) inside `ScrollArea` with a max height, close button; leave slots for position/nav (US2), questions (US3) and outdated badge (US5)
- [X] T050 [P] [US1] Create `src/renderer/src/components/editor/explanation-diff/explanation-detached-list.tsx` listing file-level items (binary / over-budget files) as cards without circles
- [X] T051 [US1] Mount the lane, card hook and detached list in `src/renderer/src/components/editor/DiffViewer.tsx` only when `diffSource === 'explanation'` (never for Source Control, FR-015); resolve anchors with `relocateAnchor` against loaded content and honour `explanationRef.focusItemId` on open; when `fileDiff` fails because the host is unreachable, show that file's items through `explanation-detached-list.tsx` (label, text, sent questions, no circles) with the disconnected notice instead of only an error
- [X] T052 [P] [US1] Add English strings for the tab, panel, legend, file list, "Unexplained", the host-disconnected notice, and card under `auto.components.right.sidebar.explanations.*` in `src/renderer/src/i18n/locales/en.json`
- [X] T053 [US1] Playwright e2e in `tests/e2e/agent-explanations/explanations-tab.spec.ts` covering quickstart rows US1-1…US1-6 and the binary file-level edge case, asserting the tab becomes visible within 2 s of the CLI publish returning (SC-002) (publish via the dev CLI, `ORCA_BACKGROUND_LAUNCH=1`, CDP screenshots)

**Checkpoint**: MVP — publishing shows the tab, labels, legend focus, markers and inline explanations.

---

## Phase 4: User Story 2 - Follow the guided reading order (Priority: P2)

**Goal**: Next/previous walks every explanation in label order across files and changes, showing "A2.1 · 4 of 11".

**Independent Test**: From `A1.1`, pressing Next visits every item once in label order, opening the next file automatically (quickstart row US2, SC-003).

- [X] T054 [US2] Add `goToNextItem` / `goToPreviousItem` to `src/renderer/src/store/slices/agent-explanations.ts` using `buildGlobalOrder` (T004): set `activeItemId` and, when the item is in another file, call `open-explanation-diff` (T043) with `focusItemId`; detached items stay in the order and open the detached list entry
- [X] T055 [P] [US2] Tests for cross-file and cross-change navigation and bounds in `src/renderer/src/store/slices/agent-explanations.test.ts`
- [X] T056 [US2] Add previous/next buttons and the position text ("A2.1 · 4 of 11") to `src/renderer/src/components/editor/explanation-diff/ExplanationCard.tsx`; add keyboard shortcuts using the platform modifier check (`metaKey` on Mac, `ctrlKey` elsewhere) with `⌘`/`Ctrl+` labels
- [X] T057 [US2] Scroll the target line into view and open its card after the next file loads in `src/renderer/src/components/editor/DiffViewer.tsx` (consume `focusItemId` once)
- [X] T058 [P] [US2] Add strings for navigation/position to `src/renderer/src/i18n/locales/en.json`
- [X] T059 [US2] Playwright e2e in `tests/e2e/agent-explanations/explanations-reading-order.spec.ts`: walk a 10-file, 3-change explanation with Next only, without opening any file manually (SC-003)

**Checkpoint**: US1 + US2 work independently.

---

## Phase 5: User Story 3 - Ask a follow-up question from an explanation (Priority: P2)

**Goal**: Write a question in a card, pick an agent with the existing send menu (publisher preselected), deliver a self-contained prompt, and see it marked "Sent to <agent>".

**Independent Test**: Ask a question on one explanation, choose a running agent; its pane opens with question, file, lines, anchored code and original explanation; the card shows the question as sent (quickstart row US3, SC-005).

- [X] T060 [US3] Add question ops to `src/main/agent-explanations/explanation-store.ts`: `upsertQuestion` (`body` "1..8192", `itemId` must reference an item in the same set, max 200 questions per set; editing a `sent` question creates a new draft and leaves the sent record), `markQuestionsSent` (sets `state: 'sent'`, `sentAt`, `sentTo`), `deleteQuestion` (either state); all return `stale_explanation` when `explanationId` is not current and bump `revision`
- [X] T061 [P] [US3] Tests for question ops in `src/main/agent-explanations/explanation-store.test.ts`: stale id, unknown itemId, 200 cap, edit-after-sent creates draft, revision bump
- [X] T062 [US3] Expose `explanation.questions.upsert|markSent|delete` in `src/main/runtime/rpc/methods/explanation.ts`, the `explanations:questions:upsert|markSent|delete` channels in `src/main/ipc/agent-explanations/explanation-ipc.ts`, `upsertQuestion`/`markQuestionsSent`/`deleteQuestion` in `src/preload/api/explanations-api.ts`, and the same in `src/renderer/src/runtime/runtime-explanation-client.ts`
- [X] T063 [P] [US3] Implement `src/shared/agent-explanations/explanation-question-prompt.ts` building a self-contained agent prompt: question, file path, side and line range, anchored code lines, change title, original explanation text (FR-017); test in `explanation-question-prompt.test.ts`
- [X] T064 [US3] Extend `src/renderer/src/components/editor/NotesSendMenu.tsx` with optional `preferredTargetPaneKey` and `onDelivered(notes, target?: { paneKey?: string; label: string })`, and sort/highlight that target first when live in `src/renderer/src/components/editor/ReviewNotesSendMenuContent.tsx`; existing callers unchanged; add tests next to those components
- [X] T065 [US3] Create `src/renderer/src/components/editor/explanation-diff/ExplanationQuestionComposer.tsx`: draft textarea kept in the slice and saved as `state: 'draft'` on blur (FR-019), `NotesSendMenu<ExplanationQuestion>` with one scope ("This question"), prompt from T063, `preferredTargetPaneKey = explanation.producer.paneKey`, `onDelivered` → `markQuestionsSent` with the delivered target; failure/no-agent paths use the menu's existing toast and launch options
- [X] T066 [US3] Render the item's questions under the explanation in `src/renderer/src/components/editor/explanation-diff/ExplanationCard.tsx` ("Sent to Claude · 2m ago" for sent, editable/deletable drafts) and mount the composer
- [X] T067 [P] [US3] Add question/composer strings to `src/renderer/src/i18n/locales/en.json`
- [X] T068 [US3] Playwright e2e in `tests/e2e/agent-explanations/explanations-questions.spec.ts`: preselected publisher, delivered prompt content, sent marking, no-agent path keeps the draft

**Checkpoint**: US1–US3 work independently.

---

## Phase 6: User Story 4 - Add action notes from the Explanations tab (Priority: P3)

**Goal**: Regular review notes can be added in the explanation diff and sent exactly as in Source Control, sharing the workspace's one notes collection.

**Independent Test**: Add a note in the explanation diff, send it; then open the same file from Source Control and see the note there with no explanation circles (quickstart row US4).

- [X] T069 [US4] Keep the diff-comment add/edit/delete path enabled for `diffSource === 'explanation'` in `src/renderer/src/components/editor/DiffViewer.tsx`, writing to `WorktreeMeta.diffComments` (`src/shared/diff-comment-types.ts`) with new-side notes `scope: 'unstaged'` when the working tree differs from the index, `'staged'` when it matches the index but the index differs from `HEAD` (all changes staged, so Source Control's unstaged diff is empty), and `'branch'` otherwise; old-side notes `scope: 'branch'` when `changeSetBase.kind === 'branch-and-uncommitted'`, and the old-side add-note button disabled in `uncommitted-only` mode; first verify Source Control's branch diff uses the same merge-base as its left side (research R13); if it doesn't, disable the old-side add-note button in both base modes (research R13 fallback); keep note cards' current look so they stay distinct from markers
- [X] T070 [US4] Show the existing `src/renderer/src/components/editor/DiffNotesSendMenu.tsx` unchanged for explanation diffs (header placement matching Source Control)
- [X] T071 [P] [US4] Tests in `src/renderer/src/components/editor/explanation-diff/explanation-review-notes.test.tsx`: note scope selection (new side: unstaged, staged-only → `'staged'`, committed-only → `'branch'`; old side; both base modes, old-side add button hidden when `uncommitted-only` or when the R13 merge-base check fails), markers never mounted for Source Control diff sources (FR-015)
- [X] T072 [US4] Playwright e2e in `tests/e2e/agent-explanations/explanations-review-notes.spec.ts`: note added in the explanation diff appears in Source Control on the same line

**Checkpoint**: US1–US4 work independently.

---

## Phase 7: User Story 5 - Refresh or clear an explanation (Priority: P3)

**Goal**: Re-publishing replaces the set; clearing removes it and hides the tab; changed code relocates markers as outdated or lists them as detached.

**Independent Test**: Publish, re-publish a different set (it replaces the first and shows the new agent/time), clear (tab disappears, `explain show --json` → `explanation: null`), edit lines above an anchor (marker moves, flagged outdated), delete anchored code (listed as Detached) (quickstart rows US5-1…US5-3).

- [X] T073 [US5] Add `clear(workspaceId, explanationId?)` to `src/main/agent-explanations/explanation-store.ts` (deletes the file; with `explanationId` only clears if still current; emits `changed` with `revision + 1` and null set) and tests in `explanation-store.test.ts`
- [X] T074 [US5] Expose clear as `explanation.clear` in `src/main/runtime/rpc/methods/explanation.ts`, `explanations:clear` in `src/main/ipc/agent-explanations/explanation-ipc.ts`, `clear` in `src/preload/api/explanations-api.ts` and `src/renderer/src/runtime/runtime-explanation-client.ts`, and `orca explain clear [--worktree] [--json]` in `src/cli/specs/explanation.ts` + `src/cli/handlers/explanation.ts` (with a test in `explanation.test.ts`); add behavior 9 from contracts/skill.md (`orca explain clear` only when the user asks) to `~/.claude/skills/orca-explain/SKILL.md`
- [X] T075 [US5] Add a Clear action with the existing confirm-dialog primitive to `src/renderer/src/components/right-sidebar/explanations/ExplanationsPanel.tsx` passing the current `explanationId`; the slice sets the explanation to null so the tab hides and `resolveRightSidebarEffectiveTab` falls back to the first visible tab
- [X] T076 [US5] Extend the panel header in `ExplanationsPanel.tsx` (the "uncommitted changes only" base label is already shown by T041): a `publishWarnings` count ("2 anchors were adjusted"), and a brief "replaced" notice when a newer `explanationId` arrives while open; show the "no longer changed" hint on rows flagged by T037 in `explanation-file-list.tsx`
- [X] T077 [US5] Show an "outdated" badge (existing warning token) on markers in `ExplanationMarkerLane.tsx` and in `ExplanationCard.tsx` for `state: 'outdated'`; list `state: 'detached'` items in `explanation-detached-list.tsx` under a "Detached" heading; recompute when the file's diff identity changes
- [X] T078 [P] [US5] Add clear/outdated/detached/replaced/uncommitted-only strings to `src/renderer/src/i18n/locales/en.json`
- [X] T079 [US5] Playwright e2e in `tests/e2e/agent-explanations/explanations-lifecycle.spec.ts`: re-publish replaces (old questions gone), clear hides the tab, outdated and detached markers, default-branch workspace → `uncommitted-only`, non-git folder → `not_git_workspace` and no tab

**Checkpoint**: All user stories are independently functional.

---

## Phase 8: Polish & Cross-Cutting Concerns

- [X] T080 [P] Add translations for every new key to `src/renderer/src/i18n/locales/{es,fr,ja,ko,zh}.json` and pass `verify:localization-catalog`, `verify:localization-runtime-catalog`, `verify:localization-extraction`, `verify:localization-coverage`
- [ ] T081 [P] Verify Copilot CLI and Pi discover `~/.agents/skills/orca-explain` on macOS, Linux, Windows and WSL (research R14 open item b) and record results in the quickstart.md §4 matrix
- [ ] T082 Run the mixed-version check (quickstart §5): new client + older runtime server → no tab, `ui.update` not rejected, CLI prints the unsupported message; new client + new runtime server → the tab appears within 2 s of a publish on the server with no workspace switch (SC-002, T034a), and again after a transport reconnect
- [ ] T083 Run SSH validation (quickstart §4): publish from a remote terminal, disconnect, confirm the last explanation stays readable and sending a question reports the connection problem
- [X] T084 Run `pnpm tc`, the unit test paths in quickstart §1, `pnpm run verify:rpc-params-catalog`, `pnpm run check:code-quality:changed`, `oxlint`, `pnpm format`; fix any design-system or `max-lines` findings by splitting components, never by disabling
- [ ] T085 Run WSL and Windows validation (FR-025): on a Windows host and on a WSL-distro workspace, publish from the CLI, open the tab and an explanation diff (markers on both sides), send a follow-up question, add a review note, and clear; confirm paths with backslashes are normalized and the WSL change set matches `git` inside the distro
- [ ] T086 Run the full quickstart.md (§2–§4) and the e2e suite `ORCA_BACKGROUND_LAUNCH=1 npx playwright test tests/e2e/agent-explanations --config tests/playwright.config.ts --project=electron-headless`; tick the agent/host matrix, where a cell passes only when a scripted 2-change publish from that agent succeeds (SC-001)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: none
- **Foundational (Phase 2)**: depends on Setup; blocks all stories
- **US1 (Phase 3)**: depends on Foundational
- **US2, US3 (Phases 4–5)**: depend on US1's slice, diff source and card (T034, T042–T051); independent of each other
- **US4 (Phase 6)**: depends on US1's explanation diff source (T042–T044, T051); independent of US2/US3
- **US5 (Phase 7)**: depends on US1; T077 extends US1's lane/card/detached list
- **Polish (Phase 8)**: after the desired stories

### Key task dependencies

- T002 → T003 → T019; T004, T006 → T019
- T009 → T010, T011, T014; T012, T014 → T019
- T015 → T016
- T016 → T018; T016 → T019
- T019 → T021
- T021 → T022, T024, T026
- T026 → T027 → T028
- T034 → T035, T041, T054; T042 → T043 → T044 → T051
- T022, T028, T034 → T034a
- T045 → T047; T048 + T049 → T051
- T060 → T062 → T065 → T066; T063, T064 → T065
- T073 → T074 → T075
- T001 → T022, T028, T033, T034a; T032 → T033, T035
- T024 → T029 (the skill documents the CLI); T029 → T030 → T031; T029 → T074 (T074 edits the skill)

### Within each story

Pure logic and its tests → main/store → RPC/IPC/preload → renderer slice → components → DiffViewer wiring → e2e.

---

## Parallel Examples

### Foundational

```text
T004 explanation-labels.ts        | T006 explanation-anchor-fingerprint.ts | T008 explanation-params.ts
T005 labels tests                 | T007 fingerprint tests                 | T015 storage paths
T010 SSH provider leftOid         | T011 relay leftOid                     | T013 change-set tests
```

### User Story 1

```text
T032 tab id | T037 panel model | T039 legend | T040 file list | T045 marker layout | T050 detached list | T052 strings
```

### User Story 3

```text
T061 question store tests | T063 question prompt | T067 strings
```

### Across stories (after US1)

US2 (T054–T059), US3 (T060–T068) and US4 (T069–T072) can proceed in parallel; they touch `ExplanationCard.tsx` / `DiffViewer.tsx` in different sections, so merge those edits sequentially.

---

## Implementation Strategy

### MVP first (US1)

1. Phase 1 + Phase 2 → `orca-dev explain publish/show` works (quickstart §2)
2. Phase 3 → tab, legend, labelled files, markers, inline cards
3. **Stop and validate** with quickstart rows US1-1…US1-6

### Incremental delivery

1. - US2 → guided reading order
2. - US3 → follow-up questions
3. - US4 → action notes from the explanation diff
4. - US5 → clear, replacement notice, outdated/detached
5. Polish → localization, agent/host matrix, mixed versions, SSH

---

## Notes

- [P] = different files, no dependency on an incomplete task
- Do not commit unless the user asks; never add Claude co-author or session trailers
- Avoid same-file conflicts: `explanation-store.ts`, `explanation.ts` (RPC), `explanation-ipc.ts`, `ExplanationCard.tsx` and `DiffViewer.tsx` are touched by several stories — sequence those edits

---

## Phase 9: Convergence

- [X] T087 Add a render test (e.g. `src/renderer/src/components/editor/EditorDiffFileSurface.explanation-gating.test.tsx`) asserting `ExplanationDiffFrame`, explanation markers and the card mount only when `diffSource === 'explanation'` and never for Source Control sources (`unstaged`, `staged`, `branch`, `combined-uncommitted`) per FR-015 / T071 (partial)

---

## Phase 10: Convergence

- [X] T088 Make `src/main/ipc/register-core-handlers/register-core-handlers.test.ts` pass by mocking `../api-client/api-client-ipc` (it calls `ipcMain.on`, which the electron mock lacks) so the `registerExplanationHandlersMock` assertion actually runs per T026 / T084 (partial)
