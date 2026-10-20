# Research: Agent Change Explanations

Phase 0 output for [plan.md](./plan.md). Each entry has the decision, why it was chosen, and the alternatives that were rejected. There are no open NEEDS CLARIFICATION items.

## R1 — Where the explanation is stored

**Decision**: One JSON file per workspace, `userData/agent-explanations/<hashWorktreeId(workspaceId)>.json`, written with `writeFileDurable` (`src/main/durable-file-write.ts`) and cached in memory by `explanation-store.ts`. The store sits in the Orca runtime that owns the workspace: the desktop for local, WSL and SSH workspaces, and the paired runtime server for `runtime:` workspaces. It is deleted from `removeWorktreeMetadataAndHistory` / `worktree-removal-ownership.ts`, next to `deleteWorktreeApiClientData`.

**Rationale**: FR-021 asks for Orca-owned metadata outside the repo that survives restarts. An explanation can reach hundreds of KB. `WorktreeMeta` is serialized into `orca-data.json` on every metadata write, and it is published to paired and mobile clients, so adding it there would raise write cost and wire payloads for every workspace. A separate file keeps that cost local to the feature, and the API Client already proved the deletion lifecycle. For SSH, `ssh-execution-boundary.md` puts the control plane (including `orca` inside remote terminals) on the client runtime. Explanation metadata is control-plane state, not execution state.

**Alternatives**: `WorktreeMeta.agentExplanation`, as `diffComments` does (rejected for size, write churn and wire exposure). A file under `.git/orca/` (rejected: it lives in the repository's git dir, does not exist for every folder workspace, and would sit on the SSH host while the UI lives on the client). SQLite (no precedent for this kind of data).

## R2 — Change set and base branch

**Decision**: `explanation-change-set.ts` works out the base ref in main with the same order the renderer's `resolveSourceControlBaseRef` uses, minus hosted-review overrides: `WorktreeMeta.baseRef` → `Repo.worktreeBaseRef` → the repo default base ref (`repo-default-base-ref.ts`). It calls the existing `getRuntimeGitBranchCompare(selector, baseRef)` for `mergeBase`/`headOid` and branch entries, and `getStatus` for uncommitted entries. The change set is the union keyed by current path. Renames keep `oldPath`. When the entry is in both lists, the status kind wins (e.g. a file added on the branch and edited afterwards is still "added" relative to the merge-base, so the diff kind comes from comparing the merge-base blob with the working tree). When there is no usable base (`invalid-base`, `no-merge-base`, or no base ref at all), or the merge-base equals `HEAD` (working directly on the base branch), the base is `HEAD` and `changeSetBase.kind = 'uncommitted-only'`, and the tab says so (spec edge case). On `unborn-head` (no commits yet) there is no `HEAD`, so the base is the empty-tree oid from `git hash-object -t tree --stdin` with empty stdin, with `kind: 'uncommitted-only'`, `headOid: null`, and every file `added`. If the workspace is not a git repo, every method returns `not_git_workspace` (contracts/cli-rpc.md).

**Rationale**: This matches the clarification (branch vs base plus uncommitted) and the assumption ("the base Orca already uses"). The renderer's extra hosted-review rule only matters while a PR is open with a different base. Taking the raw pinned/default base keeps main independent of renderer state, and the result is reported back (`changeSetBase.baseRef`) so the user can see what was compared.

**Alternatives**: Have the renderer send its effective base ref with every call (impossible from the CLI, where there's no renderer in the loop). Use `combined-all` as is (it lists branch and uncommitted entries separately, so one file can show up twice with different line numbers, which breaks single anchors).

## R3 — One diff per file: merge-base → working tree

**Decision**: Add a `DiffSource` `'explanation'`. Its content comes from the existing `getDiff` path with a new optional `leftOid`, which generalizes today's `compareAgainstHead: true` (left = `HEAD`) to left = any commit. The working-tree side is unchanged. Main-local calls go straight through. The SSH provider (`ssh-git-read-provider.ts`) forwards `leftOid` in its `git.diff` request, and the relay's git handler honours it. This is safe because the relay daemon refuses any client whose bundle hash differs (`ssh-execution-boundary.md`, "Updating Orca strands relay-backed terminals"), so client and relay are never mixed versions. Paired remote runtimes are reached through the new `explanation.fileDiff` RPC, gated by the capability (R8), never through a changed `git.diff` RPC param.

**Rationale**: Anchors must point at one stable numbering per side. The new side is the working tree, which is also the modified side of Source Control's unstaged diff, so review-note line numbers line up (R13). The old side is the merge-base, where removed lines live. Generalizing the existing read reuses its binary detection, size budget (`assertGitDiffWithinTransportBudget`), WSL path handling and SSH routing.

**Alternatives**: Compose `git show <mergeBase>:<path>` through `provider.exec` plus a separate file read (duplicates binary/size handling). A two-step stacked diff (branch diff, then uncommitted diff) (confusing, and anchors would need a side per layer).

## R4 — Anchor validation on publish

**Decision**: For every item, `explanation-publish.ts` checks that:

1. the path is in the change set (`file_not_in_change_set`);
2. the side exists for that file (`side_unavailable`, e.g. `old` on an added file or `new` on a deleted one);
3. `1 ≤ startLine ≤ endLine ≤ lineCount(side)` (`line_out_of_range`);
4. the text is non-empty and ≤ 8 KB (`text_empty` / `text_too_long`).

Binary or over-budget files can't have line anchors. Their items must omit lines (`fileLevel: true`), and otherwise get `line_anchor_unsupported`. Anchors outside any changed hunk are **accepted with a warning** (`outside_changed_hunk`), because explaining surrounding context is legitimate. Valid items are stored. The response lists `rejected[]` and `warnings[]` with the agent's own ids (`changeIndex`, `fileIndex`, `itemIndex`, plus an optional `clientId`), so the agent can fix and re-publish (SC-004). If every item is rejected, nothing is stored and the response has `published: false`.

**Rationale**: This meets FR-004 and the edge cases while being precise enough for an agent to correct itself without a human.

**Alternatives**: All-or-nothing publish (contradicts FR-004). Silently clamping lines (violates SC-004).

## R5 — Freshness: relocation, outdated, detached

**Decision**: At publish time, each anchor stores a fingerprint: the anchored lines' text plus up to 2 context lines above and below, each trimmed of trailing whitespace. At render time, `explanation-anchor-fingerprint.ts` (pure, shared) checks the current side content in this order:

1. the anchored text is still at the same lines → `fresh`;
2. an exact match of the anchored block is found → move to the nearest one, using context to break ties → `outdated` (moved);
3. a whitespace-normalized match is found → `outdated`;
4. otherwise → `detached`.

Detached items are listed in the file's detached list, and stay in the global order with no marker. The file's diff identity is also stored so the common case (nothing changed) is answered without a scan.

**Rationale**: FR-024 needs this. Doing it in the renderer against the content it already loaded avoids an extra round trip. The shared, pure function is easy to test in table form.

**Alternatives**: Re-validate on the host for every render (an extra RPC per file). Fuzzy diff libraries (a new dependency, for little gain at this scale).

## R6 — Labels and global order

**Decision**: Orca assigns all labels (FR-010) in `explanation-labels.ts`. Change letters use bijective base-26: `A…Z, AA, AB…`. File label = letter + 1-based position in that change's file list (`B3`). Item label = file label + `.` + 1-based position (`B3.2`). Global reading order = changes in order → files in order → items in order. Within a file entry, items are sorted by the order the agent gave, not by line. The agent's order is kept, and duplicate file entries inside one change are merged into the first one (with a warning). Empty file entries and changes (all their items rejected) are removed after validation and before numbering. A file may appear in several changes. Its sidebar row shows all its labels, sorted by global order, and explained files are sorted by their first label.

**Rationale**: Labels never have gaps and stay stable for a given payload. A file belonging to A and B shows `A1 B3` (acceptance 1.3).

## R7 — Agent interface: `orca explain …`

**Decision**: New CLI group, modeled on `src/cli/specs/api-client.ts` + `handlers/api-client.ts`:

- `orca explain publish --input-stdin [--agent <name>] [--worktree <sel>] [--json]`
- `orca explain show [--worktree <sel>] [--json]`
- `orca explain clear [--worktree <sel>] [--json]`
- `orca explain changes [--worktree <sel>] [--json]` (the change set and merge-base publish validates against, so the agent never derives its own base)
- `orca explain schema [--json]` (prints the payload JSON Schema produced from zod, for agents without the guide)

The payload is read only from stdin, through the `--input-stdin` flag. `shouldReadRemoteCliStdin` (`src/relay/remote-cli-stdin.ts`) already forwards stdin for any `--*-stdin` flag, so the command works from SSH terminals **without a relay change**. A `--input <path>` flag would break over SSH, because the shim runs the host CLI on the client, which can't see a remote file. The caller identity comes from `ORCA_TERMINAL_HANDLE`, as `worktree create` and Linear do. Main resolves it to a pane key with the runtime's terminal registry. `--agent`, or the payload's `agent` field, gives a display name. Otherwise the agent kind comes from the resolved pane's agent status, or `"agent"`. `--worktree` defaults to the cwd-derived current workspace.

**Rationale**: This reuses the CLI/RPC/handler pattern, SSH passthrough and caller-identity conventions. Stdin also avoids shell-quoting problems with large JSON on Windows. The skill guide shows `Get-Content -Raw f.json | orca explain publish --input-stdin` for PowerShell and a heredoc for POSIX shells.

**Alternatives**: An MCP tool (not every agent can use MCP, while every agent can run the CLI). Agent-written files in the repo (violates FR-021).

## R8 — RPC methods and mixed versions

**Decision**: New methods `explanation.publish`, `explanation.get`, `explanation.clear`, `explanation.fileDiff`, `explanation.questions.upsert`, `explanation.questions.markSent` and `explanation.questions.delete`, registered in `methods/index.ts`. Hosts that support them advertise `AGENT_EXPLANATIONS_RUNTIME_CAPABILITY = 'agent-explanations.v1'` (`protocol-version.ts`). Clients check it with `runtimeEnvironmentSupportsCapability` before showing the tab for a `runtime:` workspace. The CLI maps `method_not_found` to "This Orca version does not support agent explanations." (pattern from `callApi` in `handlers/api-client.ts`).

**Rationale**: `remote-wire-compatibility.md` says new methods are safe and capabilities gate UI. No stream opcode is added.

## R9 — Getting changes to the renderer (≤ 2 s)

**Decision**: `explanation-store` emits a change event `{ workspaceId, revision }` after every write. Locally, main forwards it to every renderer as an IPC event (`explanations:changed`), and the renderer slice refetches `get` when the revision is newer than the one it holds. For paired runtimes, the event goes through the existing client-events subscription, only to clients that advertised the capability. Those clients also refetch when the workspace becomes active and when the tab is opened, as a fallback.

**Rationale**: Push events meet SC-002 without polling. Refetching on a revision number is idempotent and survives missed events.

## R10 — Sidebar tab

**Decision**: Add `'explanations'` to `RightSidebarTab`, to `STATIC_RIGHT_SIDEBAR_TABS` and to the activity items, inserted right after `source-control`. Its icon is lucide `MessageSquareText`, and it has `requiresExplanation: true` plus `gitOnly: true`. `getVisibleRightSidebarActivityItems` gets `hasExplanation`, so the tab is hidden when the active workspace has none (FR-006). When the tab disappears while it is active (cleared or workspace switched), the existing `resolveRightSidebarEffectiveTab` fallback picks the first visible tab. **Wire guard**: the client-ui sync must not send `rightSidebarTab: 'explanations'` to a host whose `RightSidebarTabParam` doesn't know it, because old hosts reject the whole `ui.update` payload. The serializer maps it to `'source-control'` unless the host has the capability. The reverse direction needs the same guard: the host's `ui.get` response maps `'explanations'` → `'source-control'` for clients that did not advertise `agent-explanations.v1`, so an older client never receives a tab id its schema rejects. The host's own `normalizeRightSidebarTab` (`src/main/persistence/applying-settings/ui-selection-normalization.ts`) hard-codes the known tabs and must accept `'explanations'`, or the persisted tab resets to Explorer on restart.

**Rationale**: The plugin-key escape hatch (`plugin:…`) is reserved for plugins. A static id matches built-in tabs and keeps i18n and shortcuts consistent.

## R11 — Markers and the inline card in the Monaco diff

**Decision**: When `diffSource === 'explanation'`, `DiffViewer` mounts `ExplanationMarkerLane` on the modified and original editors. Markers are absolutely positioned round buttons (`A1.1`) in a reserved left lane. The lane is widened through the existing `lineDecorationsWidth` option, and positions come from `getTopForLineNumber` + scroll events. This is the same technique as `diff-comment-add-button-overlay.ts`. Several markers on a line sit side by side in a flex row (FR-012). Removed-line anchors go on the original editor. In inline (non-side-by-side) mode they go on the deleted-line view, using the diff editor's line mapping. Clicking a marker opens `ExplanationCard` in a view zone under the anchor's last line, reusing `diff-comment-view-zone-entry.ts`. While it is open, the range gets a subtle token-based highlight decoration. The card renders text with the existing `react-markdown` setup (no raw HTML) inside a `ScrollArea` with a max height. It shows the label, "4 of 11", previous/next, an "outdated" badge, sent questions and the composer. Review notes keep their current cards and add-note gutter button, so the two stay visually distinct (FR-015).

**Rationale**: Glyph-margin decorations can't hold multi-character labels or several clickable circles, and content widgets scroll with text but are hard to keep in a lane. The overlay technique is already proven in this codebase.

## R12 — Follow-up questions

**Decision**: Questions belong to the explanation (store ops: upsert draft, mark sent, delete) and are replaced along with it (clarification). Sending uses `NotesSendMenu<ExplanationQuestion>` with one scope ("This question"). Its prompt comes from `explanation-question-prompt.ts`: the question, the file path, side and line range, the anchored code lines, the change title and the original explanation text, so it is self-contained (FR-017). Two small extensions to the existing menu:

1. `preferredTargetPaneKey`: `ReviewNotesSendMenuContent` sorts that target first and highlights it when it is live (US3-3).
2. `onDelivered(notes, target)`: the second argument is the delivered target's `{ paneKey, label }`, so the question can be marked sent to that agent (FR-018). Existing callers ignore the extra argument.

Failure and no-agent cases are already handled by the menu (toast + launch options). The draft stays in the slice and is saved as `state: 'draft'` on blur, so it is never lost (FR-019).

**Rationale**: This reuses the agent picker, launch-if-none and delivery exactly as US3 asks.

## R13 — Action notes in the explanation diff

**Decision**: Explanation diffs keep the regular diff-comment add/edit/delete path in `DiffViewer`, writing to the same `WorktreeMeta.diffComments`. A new-side note's `scope` is `'unstaged'` when the working tree differs from the index, `'staged'` when every change is staged (the unstaged diff would be empty, but the staged diff's modified side, the index, equals the working tree), and `'branch'` otherwise. In all three cases the modified side equals the working tree, so the note shows on the same line in Source Control (US4-3). Old-side notes (removed lines, numbered from the merge-base) use `scope: 'branch'` when `changeSetBase.kind === 'branch-and-uncommitted'`, since the branch diff's old side is also the merge-base. In `uncommitted-only` mode the old side is `HEAD` while Source Control's unstaged diff numbers its old side from the index, so the add-note button is disabled on the old side. Verify during implementation that Source Control's branch diff uses the same merge-base as its left side. **Fallback if it doesn't** (for example, it compares against the base ref tip): treat old-side notes as in `uncommitted-only` mode (old-side add-note button disabled) so no note is ever saved against a line numbering Source Control can't show; new-side notes are unaffected. Sending uses the existing `DiffNotesSendMenu` unchanged. Explanation markers are never mounted for other diff sources (FR-015).

## R14 — Skill delivery to Claude Code, Copilot CLI and Pi

**Decision**: Write one full, self-contained skill at `~/.claude/skills/orca-explain/SKILL.md`, as the spec clarification requires. It is not in the repo, not in the app bundle, and not installed by Orca's skill installer, so there is no `skill-guides/` copy and no `orca skills get` step. The skill resolves the CLI with the same rules `skills/orca-cli/SKILL.md` uses, written out inline. A one-time link `~/.agents/skills/orca-explain` → `~/.claude/skills/orca-explain` (junction on Windows, copy as fallback) makes the same folder visible to agents that read `~/.agents/skills`. On SSH and WSL hosts the user places the folder and link in that host's home (quickstart §4). Evidence: GitHub's Copilot CLI docs list `~/.copilot/skills` and `~/.agents/skills` as personal skill folders, and support for `~/.claude/skills` is inconsistent across their pages and versions. Pi's docs list `~/.pi/agent/skills` and `~/.agents/skills` as global folders, and need a settings entry to read `~/.claude/skills`. So the one `~/.agents/skills` link covers Copilot CLI, Pi and Codex with no per-agent setup (SC-001). On an SSH workspace, the folder must exist in the remote host's home (spec assumption).

**Open verification for implementation (not blocking design)**: Re-verify Copilot CLI ≥ current and Pi discovery of `~/.agents/skills` on macOS, Linux, Windows and WSL, and record the results in quickstart.md §4.

**Trade-off accepted**: The skill is not version-matched to the running Orca, so CLI changes must be mirrored into `~/.claude/skills/orca-explain/SKILL.md` by hand; `orca explain schema` stays the source of truth for the payload shape.

**Alternatives**: Bundle the skill in the repo and install it with `skill-bundle-install-service` (rejected by the spec clarification). Canonical copy in `~/.agents/skills` with only a Claude alias (contradicts the clarification). Per-agent copies (drift).

Sources: [Copilot CLI — Adding agent skills](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-skills), [Visual Studio — Copilot agent skills](https://learn.microsoft.com/en-us/visualstudio/ide/copilot-agent-skills), [Pi — Skills](https://pi.dev/docs/latest/skills).

## R15 — UI building blocks and design-system compliance

**Decision**: The panel follows the Source Control file-row layout and spacing. File rows reuse the existing status-letter display (`status-display.ts`) and add label chips styled with existing token classes. The legend uses `Button` (ghost) rows with a selected state. Clear uses the existing confirm-dialog primitive. All strings go through `translate()` with new `auto.components.right.sidebar.explanations.*` keys. No raw palette colors. Marker circles use the accent/muted token pair, and outdated markers use the existing warning token.
