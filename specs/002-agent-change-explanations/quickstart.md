# Quickstart: Validating Agent Change Explanations

How to prove the feature works from start to finish. Behavior details live in the [contracts](./contracts/) and the [data model](./data-model.md). This guide only says what to run and what to expect.

## Prerequisites

- `pnpm install`, then `pnpm run build:cli` (installs the dev `orca` CLI, which the skill resolves as `orca-dev` in a dev checkout).
- A test git repo with a base branch `main` and a feature branch that has at least one commit **and** uncommitted edits across 3+ files. The repo should include one renamed file, one deleted file and one binary file.
- Automated UI runs always use `ORCA_BACKGROUND_LAUNCH=1` and CDP screenshots. Never focus or show windows (AGENTS.md).

## 1. Automated checks

```bash
pnpm tc
pnpm test src/shared/agent-explanations src/main/agent-explanations src/cli/handlers/explanation.test.ts
pnpm test src/renderer/src/components/right-sidebar/explanations src/renderer/src/components/editor/explanation-diff
pnpm run verify:rpc-params-catalog
pnpm run check:code-quality:changed
ORCA_BACKGROUND_LAUNCH=1 npx playwright test tests/e2e/agent-explanations --config tests/playwright.config.ts --project=electron-headless
```

Expected: everything passes. Unit coverage must include labels (`Z`→`AA`), relocation states (fresh/outdated/detached), every [issue code](./contracts/publish-payload.md#issue-codes), and change-set union and rename handling.

## 2. Publish from the CLI (no agent needed)

In an Orca terminal inside the test workspace (dev build running: `ORCA_BACKGROUND_LAUNCH=1 pnpm dev`):

```bash
orca-dev explain schema --json | head
cat <<'EOF' | orca-dev explain publish --input-stdin --agent manual --json
{ "version": 1, "changes": [
  { "title": "Retry policy", "summary": "…", "files": [
    { "path": "src/a.ts", "items": [ { "id": "a1", "startLine": 3, "endLine": 6, "text": "Why A1.1" },
                                     { "startLine": 9999, "text": "bad" } ] },
    { "path": "src/b.ts", "items": [ { "text": "file-level note" } ] } ] },
  { "title": "Settings toggle", "summary": "…", "files": [
    { "path": "src/a.ts", "items": [ { "side": "old", "startLine": 2, "text": "Removed code" } ] },
    { "path": "not/changed.ts", "items": [ { "startLine": 1, "text": "x" } ] } ] } ] }
EOF
```

Expected: `published: true`, with `rejected` holding `line_out_of_range` (item 2 of A1) and `file_not_in_change_set` (B2), and labels `A1.1`, `A2.1`, `B1.1`. `orca-dev explain show` prints the legend and `src/a.ts  A1 B1`.

## 3. UI scenarios (map to spec acceptance)

| #       | Steps                                                                                  | Expected                                                                                                                                                                                                                                                                                    |
| ------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| US1-1   | Fresh workspace, open the right sidebar                                                | No Explanations tab                                                                                                                                                                                                                                                                         |
| US1-2   | Publish (step 2)                                                                       | The tab appears next to Source Control within 2 s, with no reload (SC-002). Legend A/B. Explained files first, the rest under "Unexplained"                                                                                                                                                 |
| US1-3   | Look at `src/a.ts`                                                                     | It shows `A1 B1`                                                                                                                                                                                                                                                                            |
| US1-4/5 | Open `src/a.ts`                                                                        | Circles `A1.1` (new side), `B1.1` (old side). Two anchors on one line sit side by side. Clicking opens the inline card with markdown text                                                                                                                                                   |
| US1-6   | Click legend B                                                                         | The list focuses B's files in `B1, B2…` order                                                                                                                                                                                                                                               |
| US2     | From `A1.1`, press Next repeatedly                                                     | Visits every item once in label order, opens the next file automatically, shows "n of N" (SC-003)                                                                                                                                                                                           |
| US3     | On a card, write a question → Send → pick an agent                                     | The agent pane opens/focuses and receives the question with file, lines, anchored code and the original explanation (SC-005). The question shows "Sent to <agent>". With the publishing agent still running, it is preselected. With no agent, launch options appear and the draft survives |
| US4     | Add a review note in the explanation diff, then open the same file from Source Control | The note shows in both, looking like a regular note. No explanation circles in Source Control (FR-015)                                                                                                                                                                                      |
| US5-1   | Publish again with one change                                                          | Fully replaces the old one. The header shows the new agent/time. Old questions are gone                                                                                                                                                                                                     |
| US5-2   | Clear from the tab header                                                              | The tab disappears. `orca-dev explain show --json` → `explanation: null`                                                                                                                                                                                                                    |
| US5-3   | Edit lines above an anchor, then reopen                                                | The marker moves and is flagged "possibly outdated". Delete the anchored code → it is listed under "Detached"                                                                                                                                                                               |
| Edge    | Binary file with a file-level item                                                     | Listed with labels. The explanation shows as a list, without circles                                                                                                                                                                                                                        |
| Edge    | Workspace on the default branch (no base)                                              | Publish succeeds with `changeSetBase.kind: "uncommitted-only"`. The tab says so                                                                                                                                                                                                             |
| Edge    | Non-git folder workspace                                                               | Publish → `not_git_workspace`. No tab                                                                                                                                                                                                                                                       |

## 4. Agent and host matrix (SC-001, FR-025)

On each execution host (local, WSL distro, SSH remote), place the skill at `~/.claude/skills/orca-explain/SKILL.md` and create the shared link (Orca does not install it):

```bash
mkdir -p ~/.agents/skills && ln -s ~/.claude/skills/orca-explain ~/.agents/skills/orca-explain
```

```powershell
New-Item -ItemType Junction -Path "$HOME\.agents\skills\orca-explain" -Target "$HOME\.claude\skills\orca-explain"
```

In each agent, ask: "Use $orca-explain to explain your changes." Each cell passes only when a scripted 2-change publish from that agent succeeds (SC-001), not just when the skill is discovered.

| Agent       | Local macOS | Linux | Windows | WSL | SSH remote |
| ----------- | ----------- | ----- | ------- | --- | ---------- |
| Claude Code | ☐           | ☐     | ☐       | ☐   | ☐          |
| Copilot CLI | ☐           | ☐     | ☐       | ☐   | ☐          |
| Pi          | ☐           | ☐     | ☐       | ☐   | ☐          |

Pass = the tab appears with correct labels and every anchor is either shown or reported as rejected (SC-004). For SSH, also disconnect the client and confirm that the last explanation stays readable and that sending a question reports the connection problem.

## 5. Mixed versions

Pair a new client with an older runtime server. The tab never appears for that runtime's workspaces, `ui.update` is not rejected (the sidebar tab is mapped to Source Control), and `orca explain publish` on that host prints "This Orca version does not support agent explanations."
