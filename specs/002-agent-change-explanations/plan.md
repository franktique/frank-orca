# Implementation Plan: Agent Change Explanations

**Branch**: `franktique/feature-diff-agent-explanation` (spec dir `002-agent-change-explanations`) | **Date**: 2026-10-14 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/002-agent-change-explanations/spec.md`, planned with the project's current tech stack.

## Summary

An agent explains its own work. It invokes the `orca-explain` skill, groups its changes into lettered changes (A, B, …), and pipes one JSON document into a new `orca explain publish --input-stdin` command. The command goes through a new `explanation.*` runtime RPC. The runtime that owns the workspace builds the workspace's change set: the merge-base with the base branch compared with the working tree, so branch commits and uncommitted changes count together. It checks every anchor against the right side of that diff, rejects bad anchors precisely, saves a line fingerprint for each kept anchor, and stores the result as one JSON file per workspace under `userData/agent-explanations/`. This is outside the repository, and the file is removed when the workspace is removed.

The renderer shows an **Explanations** right-sidebar tab, next to Source Control, only while the active workspace has an explanation. The tab lists the change legend and every modified file with Orca-assigned labels (`A1`, `A2 B3`), plus an "Unexplained" group. Opening a file opens a diff tab of the new `explanation` source (merge-base → working tree). The tab draws numbered circular markers (`A1.1`) in a lane beside the code on both sides of the diff. Clicking a marker opens an inline view-zone card with the explanation, previous/next with its position ("A2.1 · 4 of 11"), the questions already sent, and a question composer. Questions are sent with the existing generic `NotesSendMenu`, and the publishing agent's pane is preselected. Regular review notes keep working through the existing diff-comment path and stay in the one shared notes collection. Details: [research.md](./research.md).

## Technical Context

**Language/Version**: TypeScript (strict), Node 24, Electron (current repo version), React 19

**Primary Dependencies**: Existing only: electron IPC, zustand, zod, Monaco (`@monaco-editor/react` diff editor, decorations, view zones), radix-ui/shadcn primitives, Tailwind, lucide-react, `react-markdown` (already a dependency) for explanation text, i18next. **No new dependencies.**

**Storage**: One JSON file per workspace, `app.getPath('userData')/agent-explanations/<hashWorktreeId>.json`, written with `writeFileDurable`. It is owned by whichever Orca runtime owns the workspace (desktop, or the paired runtime server). It is deleted by the same worktree-removal hooks that delete API Client data.

**Testing**: Vitest (pure logic, main store, CLI handler, renderer components with Testing Library/happy-dom). Playwright Electron e2e with `ORCA_BACKGROUND_LAUNCH=1` and CDP screenshots.

**Target Platform**: Orca desktop on macOS, Linux and Windows. Local, WSL and SSH-hosted workspaces. Git worktrees and git-backed folder workspaces. Paired remote runtimes are gated by a runtime capability.

**Project Type**: Desktop app (Electron main + preload + React renderer + `orca` CLI) plus a user-global agent skill in `~/.claude/skills` (not part of the app bundle)

**Performance Goals**: The tab appears within 2 s of the publish returning (SC-002); push events are used, not polling. Publish validation takes under 2 s for a 50-file explanation; file contents are read once per side and run concurrently with a fixed limit. Markers re-layout without visible lag while scrolling a 5k-line diff.

**Constraints**: Nothing is written to the repository (FR-021). Payloads are capped at 900 KB, measured on stdin by the CLI, so they fit under the 1 MB per-message limit of every RPC transport, with at most 26×4 changes and 500 items. An explanation never appears in Source Control (FR-015). Mixed client and host versions must keep working (remote wire rules). The design-system lint, the localization check, `max-lines` (no disables), the no-vague-file-names rule, and the git 2.25 baseline all apply.

**Scale/Scope**: Typical explanations have 1–5 changes, 2–30 files and 5–60 items. Hard caps are above. One explanation per workspace, and many workspaces.

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

`.specify/memory/constitution.md` is still the unfilled template, so the binding rules in `AGENTS.md` (plus `docs/STYLEGUIDE.md`) act as the constitution.

| Gate (AGENTS.md)                                                                                  | Status | How the design satisfies it                                                                                                                                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Design system: tokens + `components/ui` primitives, no raw palette, no computed classNames        | PASS   | R11: markers and the card use existing primitives (`Badge`-like token classes, `Button`, `Tooltip`, `ScrollArea`). Circle colors come from existing semantic tokens. Review-note cards keep their current look, so they stay distinct                                                                        |
| Reuse before reimplementing                                                                       | PASS   | Reuses `NotesSendMenu`/`ReviewNotesSendMenuContent`, the diff-comment view-zone and overlay techniques, `getBranchCompare`/`getStatus`/`getDiff`, `writeFileDurable` + `hashWorktreeId`, the API Client deletion lifecycle, the `orca api` CLI/RPC pattern, the CLI resolution of `skills/orca-cli/SKILL.md` |
| SSH use case considered                                                                           | PASS   | R3/R7: git reads go through the existing provider routing. The CLI payload uses `--input-stdin`, which deployed relays already forward. Storage stays with the control plane, as `ssh-execution-boundary.md` describes for `orca` inside remote terminals                                                    |
| Folder workspaces as well as git worktrees                                                        | PASS   | Keyed by worktree/workspace id. Non-git folders are refused with `not_git_workspace` (spec edge case). The deletion hook covers folder workspaces (R1)                                                                                                                                                              |
| Remote wire compatibility                                                                         | PASS   | New RPC methods only, plus the `agent-explanations` runtime capability. The tab and push events are gated on it. The `explanations` sidebar tab id is never sent to hosts that don't support it (R10)                                                                                                        |
| Git binary compatibility (2.25 baseline)                                                          | PASS   | Commands Orca already runs (`merge-base`, `diff --name-status`, `show <oid>:<path>`, `status`), plus `hash-object -t tree --stdin` (long predates 2.25) for the empty tree in repos with no commits                                                                                                                                                                                          |
| Git scan safety                                                                                   | PASS   | One merge-base, one compare and one status per publish or render. No per-ref fan-out                                                                                                                                                                                                                         |
| Git provider compatibility                                                                        | PASS   | Uses local git only. Naming is generic ("change set", "base branch"), with nothing GitHub-specific                                                                                                                                                                                                           |
| Agent status store                                                                                | PASS   | Read-only. The publisher's pane key is resolved from the terminal handle, and the send menu's existing agent rows are reused for preselection. No new status producer                                                                                                                                        |
| Cross-platform (paths, shortcuts, child processes)                                                | PASS   | `path.join`. Repo-relative POSIX paths in the payload are normalized with the existing `normalizeRuntimeGitRelativePath`. No new child processes. Next/previous shortcuts use the platform modifier check                                                                                                    |
| Electron UI validation in the background                                                          | PASS   | The quickstart e2e uses `ORCA_BACKGROUND_LAUNCH=1` and CDP screenshots, and never focuses windows                                                                                                                                                                                                            |
| File naming (no `helpers/utils`), `.ts` over `.d.ts`, no unchecked casts, no `max-lines` disables | PASS   | Domain-specific module names (below). zod parsing replaces casts. The marker lane, card and sidebar are split into focused components                                                                                                                                                                        |
| Brief comments only                                                                               | PASS   | Implementation guidance                                                                                                                                                                                                                                                                                      |

**Post-design re-check (after Phase 1)**: PASS. The contracts add no repo writes, no new dependencies, no stream opcodes, and one baseline-safe git command (`hash-object -t tree --stdin`, for repos with no commits). The only shared-surface changes are additive: a new `DiffSource` value, a new static sidebar tab id gated by capability, an optional `leftOid` on the existing diff read, and an optional delivered-target argument on `NotesSendMenu.onDelivered`. Nothing to record under Complexity Tracking.

## Project Structure

### Documentation (this feature)

```text
specs/002-agent-change-explanations/
├── spec.md
├── plan.md              # This file
├── research.md          # Phase 0
├── data-model.md        # Phase 1
├── quickstart.md        # Phase 1
├── contracts/
│   ├── cli-rpc.md               # orca explain … + explanation.* RPC
│   ├── publish-payload.md       # JSON the agent sends; validation + rejection codes
│   ├── ipc-renderer-main.md     # window.api.explanations + push event
│   ├── storage-format.md        # userData/agent-explanations/<hash>.json
│   └── skill.md                 # orca-explain SKILL.md contract and placement
├── checklists/
└── tasks.md             # Phase 2 (/speckit-tasks)
```

### Source Code (repository root)

```text
src/shared/
├── agent-explanations/
│   ├── explanation-types.ts                  # entities from data-model.md
│   ├── explanation-schemas.ts                # zod: publish payload, stored file, IPC/RPC params
│   ├── explanation-labels.ts                 # change letters (A…Z, AA…), file/item labels, global order
│   ├── explanation-anchor-fingerprint.ts     # capture + relocate (fresh | outdated | detached)
│   └── explanation-question-prompt.ts        # agent prompt for a follow-up question
├── rpc-contract/explanation-params.ts        # RPC zod params
├── runtime-client-events.ts                  # + 'explanationsChanged' event
├── protocol-version.ts                       # + AGENT_EXPLANATIONS_RUNTIME_CAPABILITY
├── ui-chrome-types.ts                        # + 'explanations' RightSidebarTab
└── rpc-contract/client-ui-params.ts          # + 'explanations' in STATIC_RIGHT_SIDEBAR_TABS

src/main/agent-explanations/
├── explanation-store.ts                      # per-workspace cache, revision, write-through, change events
├── explanation-storage-paths.ts              # userData/agent-explanations/<hash>.json
├── explanation-data-deletion.ts              # removal hook (mirrors api-client-data-deletion)
├── explanation-change-set.ts                 # base ref → merge-base → branch entries ∪ status entries
├── explanation-file-diff.ts                  # one file: merge-base (or HEAD) blob vs working tree
└── explanation-publish.ts                    # validate payload → items + rejections → store
src/main/git/source-control/file-diff.ts      # getDiff: optional leftOid (generalizes compareAgainstHead)
src/main/providers/ssh-git-read-provider.ts   # getDiff: pass leftOid in 'git.diff' (relay is bundle-hash locked)
src/relay/git-handler*.ts                     # 'git.diff': honour optional leftOid
src/main/runtime/rpc/methods/explanation.ts   # explanation.publish|get|clear|questions.* (+ index.ts)
src/main/ipc/agent-explanations/explanation-ipc.ts   # contracts/ipc-renderer-main.md
src/main/runtime/orca-runtime-resolve-worktree-removal-target.ts  # + deleteWorkspaceExplanation
src/main/ipc/worktrees/removal/worktree-removal-ownership.ts      # + deleteWorkspaceExplanation
src/main/api-client/api-client-data-gc.ts                         # orphan sweep also covers agent-explanations/
src/main/runtime/runtime-client-event-bus.ts                      # forward explanationsChanged to capable clients
src/main/runtime/rpc/methods/client-ui.ts                         # ui.get maps 'explanations' for old clients
src/main/persistence/applying-settings/ui-selection-normalization.ts  # accept 'explanations'

src/preload/api/explanations-api.ts (+ bridge)   # window.api.explanations

src/renderer/src/
├── runtime/runtime-explanation-client.ts     # local IPC vs callRuntimeRpc (pattern: runtime-git-diff-client.ts)
├── runtime/runtime-client-events.ts          # consumed for explanationsChanged on runtime: workspaces
├── app-shell/use-persisted-ui-writer.ts      # map 'explanations' for hosts without the capability
├── store/slices/agent-explanations.ts        # per-workspace explanation, focused change, active item, drafts
├── store/slices/editor/types/open-file.ts    # + 'explanation' DiffSource
├── store/slices/editor/actions/open-explanation-diff.ts
├── components/right-sidebar/
│   ├── use-right-sidebar-activity-items.ts   # + Explanations item after Source Control (requiresExplanation)
│   ├── right-sidebar-activity-visibility.ts  # + hasExplanation rule
│   ├── right-sidebar-panel-content.tsx       # + effectiveTab === 'explanations'
│   └── explanations/
│       ├── ExplanationsPanel.tsx             # header (agent, time, base, clear), legend, file list
│       ├── explanation-change-legend.tsx     # select/focus a change (FR-009)
│       ├── explanation-file-list.tsx         # labelled files + "Unexplained" group
│       └── explanation-panel-model.ts        # merge explanation with live change set
├── components/editor/explanation-diff/
│   ├── ExplanationMarkerLane.tsx             # circles beside lines, both editors, side by side
│   ├── explanation-marker-layout.ts          # line → top, grouping, scroll sync
│   ├── ExplanationCard.tsx                   # view-zone card: markdown, position, prev/next, questions
│   ├── ExplanationQuestionComposer.tsx       # draft + NotesSendMenu<ExplanationQuestion>
│   ├── explanation-detached-list.tsx         # detached / no-line items (binary, too large)
│   └── use-explanation-diff-decorations.ts   # range highlight, view-zone lifecycle
├── components/editor/DiffViewer.tsx          # mount lane/card when diffSource === 'explanation'
├── components/editor/editor-panel-diff-reload.ts  # load 'explanation' source via fileDiff
├── components/editor/editor-labels.ts, editor-header.ts  # "Explanation" + base label
├── components/editor/ReviewNotesSendMenuContent.tsx  # sort/highlight preferred target
└── components/editor/NotesSendMenu.tsx       # + preferredTargetPaneKey, onDelivered(notes, target)

src/cli/specs/explanation.ts, src/cli/handlers/explanation.ts  # orca explain publish|show|clear|schema
tests/e2e/agent-explanations/                                  # Playwright scenarios from quickstart.md

# Outside the repository (execution host's home)
~/.claude/skills/orca-explain/SKILL.md                         # full self-contained skill (contracts/skill.md)
~/.agents/skills/orca-explain -> ~/.claude/skills/orca-explain # link for Copilot CLI / Pi (junction on Windows)
```

**Structure Decision**: Follow Orca's existing split: `src/shared` for pure logic and contracts, `src/main` for data and git, `src/preload` for the bridge, `src/renderer/src` for UI, and `src/cli` for agent access. The agent skill is not part of the repo or the app bundle: it lives only in `~/.claude/skills/orca-explain/` (spec clarification). Tests sit next to their sources (`*.test.ts[x]`), and e2e tests go under `tests/e2e`.

## Implementation Phasing (input to /speckit-tasks)

1. **Foundation (P1 core)**: shared types, schemas, labels and fingerprints. Change set + `explanation` file diff. Publish validation. Store, storage and deletion. RPC + CLI + capability. Skill in `~/.claude/skills`. Covers FR-001–FR-005, FR-010, FR-021–FR-022, FR-025.
2. **Tab and markers (P1 UI)**: sidebar item and visibility, panel (legend, file list, Unexplained), `explanation` diff source, marker lane, card, range highlight, focus a change. Covers US1, FR-006–FR-013, FR-015.
3. **Guided order (P2)**: global order, previous/next across files, position indicator. Covers US2, FR-014.
4. **Follow-up questions (P2)**: question store ops, prompt, `NotesSendMenu` preselection + delivered target, sent marking, no-agent path. Covers US3, FR-016–FR-019.
5. **Action notes + lifecycle (P3)**: review notes in the explanation diff (shared collection), clear, relocation/outdated/detached UI, replacement notice. Covers US4, US5, FR-020, FR-023, FR-024.

## Complexity Tracking

No constitution violations to justify.
