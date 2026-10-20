# Feature Specification: Agent Change Explanations

**Feature Branch**: `franktique/feature-diff-agent-explanation`

**Created**: 2026-10-14

**Status**: Draft

**Input**: User description: "Today, clicking a modified file in the Source Control tab lets me add inline notes that I can later send to an agent for review. That communication only goes one way: me → agent. I want the agent to explain its implementation when I ask for it, through a skill usable from Claude, Copilot, Pi or any other coding agent. The agent leaves explanation comments that I can see in the diff, in a new sidebar tab next to Source Control so they don't mix with Source Control notes. The tab lists the modified files and only appears once the explanation skill has been run. Each important change gets a letter (A, B, C…) applied across files; files carry a letter plus reading order (A1, A2…), and a file touched by several changes carries several labels. In the diff, numbered circles mark the explained lines with a hierarchy like A1.1; clicking a circle shows the agent's explanation and lets me ask follow-up questions about it. The tab must also let me add regular notes, as in the Source Control diff, and send them to an agent to act on."

## Product Context

Orca already supports one-way review: the user writes inline notes on a diff and sends them to an agent running in the workspace. This feature adds the reverse direction — the agent explains what it built, anchored to the exact lines it changed — and lets the user ask follow-up questions about any explanation directly from it.

The explanation is produced by an agent, not by Orca. A skill (instructions any coding agent can follow), saved in the user's global skills folder `~/.claude/skills`, works together with a documented command interface the agent calls to publish its explanation. Orca stores, organizes, and displays the result.

**Follow-up questions**: A question asked on an explanation is sent to an agent through the same flow used today to send diff notes: the user picks an agent, and that agent's window opens with the question and its context. The agent answers there, in its own session. Answers are **not** written back into the explanation in this scope, so the feature does not depend on agents following an extra reply protocol.

## Clarifications

### Session 2026-10-14

- Q: Should the Explanations tab list every modified file in the workspace, or only the files the agent explained? → A: Every modified file; explained files carry their labels and sort first in reading order, unexplained files are grouped below under "Unexplained".
- Q: Which set of changes should an explanation cover? → A: Everything on the branch compared with its base branch, plus uncommitted changes.
- Q: What happens to a previous explanation when a new one is published? → A: It is replaced entirely, with its sent questions; no history is kept.
- Q: How should the explanation skill reach each coding agent? → A: The skill is saved in the user's global skills folder, `~/.claude/skills`, not bundled with Orca.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Ask an agent to explain its changes and read the explanation in the diff (Priority: P1)

After an agent finishes implementing something, the user asks it (by invoking the explanation skill from that agent's chat) to explain its implementation. The agent publishes a structured explanation. A new "Explanations" tab appears in the sidebar next to Source Control. It lists the explained files with labels like `A1`, `A2 B1`, and a legend of the changes (`A — Retry policy for uploads`, `B — New settings toggle`…). Clicking a file opens its diff with numbered circles (`A1.1`, `A1.2`…) beside the explained lines; clicking a circle opens the agent's explanation for that spot.

**Why this priority**: This is the core value — understanding an agent's work in a guided order instead of reading a raw diff. Every other story builds on it.

**Independent Test**: In a workspace with uncommitted or branch changes, run the skill from any supported agent; verify the tab appears, the file labels and legend match what the agent published, and each circle in the diff opens the correct explanation.

**Acceptance Scenarios**:

1. **Given** a workspace with no published explanation, **When** the user views the sidebar, **Then** no Explanations tab is shown.
2. **Given** the agent publishes an explanation with changes A and B, **When** publishing completes, **Then** the Explanations tab appears without restarting or reloading Orca, and lists every explained file with its labels, followed by any modified files the agent did not explain under an "Unexplained" group.
3. **Given** a file explained as the first file of change A and the third of change B, **When** the file list renders, **Then** the file shows both `A1` and `B3`.
4. **Given** the user opens a file labelled `A1`, **When** the diff renders, **Then** each explained line shows a circle labelled `A1.1`, `A1.2`… in reading order, and clicking a circle shows that explanation inline in the diff.
5. **Given** two explanations anchored to the same line (e.g. from changes A and B), **When** the diff renders, **Then** both circles are shown side by side on that line, each opening its own explanation.
6. **Given** the change legend, **When** the user selects change B, **Then** the file list filters to change B's files in `B1, B2…` order.

---

### User Story 2 - Follow the guided reading order (Priority: P2)

The user walks through the explanation in the order the agent intended: `A1.1 → A1.2 → A2.1 → … → B1.1 …`, moving across files automatically.

**Why this priority**: Labels already convey order (P1); one-step navigation makes reviewing a large change practical but is not required to get value.

**Independent Test**: With a published explanation spanning several files, use "next"/"previous" from the first explanation and confirm every explanation is visited once, in label order, opening the right file each time.

**Acceptance Scenarios**:

1. **Given** explanation `A1.2` is the last one in file `A1`, **When** the user chooses "next", **Then** file `A2` opens and explanation `A2.1` is shown.
2. **Given** the last explanation of change A, **When** the user chooses "next", **Then** the first explanation of change B is shown.
3. **Given** the user is on any explanation, **When** they look at the explanation, **Then** they can see its position (e.g. "A2.1 · 4 of 11").

---

### User Story 3 - Ask a follow-up question from an explanation (Priority: P2)

Inside an explanation, the user writes a follow-up question ("Why not reuse the existing retry helper?"), picks an agent, and that agent's window opens with the question and its context, exactly as when sending a diff note today. The conversation continues in the agent's window.

**Why this priority**: Lets the user dig into any explanation without copying context by hand, but depends on P1.

**Independent Test**: Ask a question on one explanation, choose a running agent, and verify that agent's window opens with the question, the file, the anchored lines, and the original explanation.

**Acceptance Scenarios**:

1. **Given** an open explanation, **When** the user writes a question and sends it, **Then** they can choose the target agent using the same picker as for sending diff notes.
2. **Given** the user chose an agent, **When** the question is sent, **Then** that agent's window is opened/focused and receives the question together with the file, the anchored lines, and the original explanation text.
3. **Given** the agent that published the explanation is still running in this workspace, **When** the picker opens, **Then** that agent is preselected; the user can still choose another one.
4. **Given** a question was sent, **When** the user reopens that explanation, **Then** the question is shown under it marked as sent (and to which agent), the same way sent diff notes are marked.
5. **Given** no agent is running in the workspace, **When** the user tries to send, **Then** the same options the diff-note flow offers in that situation apply (e.g. starting an agent), and the unsent question is not lost.

---

### User Story 4 - Add action notes from the Explanations tab and send them to an agent (Priority: P3)

While reading explanations, the user spots something to change. They add an inline note on a diff line in the Explanations view — exactly as in the Source Control diff, except that removed lines accept notes only where Source Control can show them (see Edge Cases) — and send the notes to an agent to act on.

**Why this priority**: Closes the loop from understanding to correction, but the same capability already exists in Source Control, so it is a convenience.

**Independent Test**: In the Explanations diff, add a note on a line, send it to an agent, and verify the agent receives it in the same format Source Control notes use.

**Acceptance Scenarios**:

1. **Given** a file open from the Explanations tab, **When** the user adds a note on a line, **Then** it appears as a regular review note, visually distinct from agent explanation circles.
2. **Given** review notes exist, **When** the user sends them to an agent, **Then** delivery and post-delivery behaviour are identical to sending notes from Source Control.
3. **Given** a note added in the Explanations view, **When** the user opens the same file from Source Control, **Then** the note is visible there too (one notes collection per workspace), while agent explanations are never shown in Source Control.

---

### User Story 5 - Refresh or clear an explanation (Priority: P3)

The user re-runs the skill after further changes, or dismisses the explanation once done.

**Why this priority**: Housekeeping that keeps the tab trustworthy over time.

**Independent Test**: Publish, then re-publish a different explanation and confirm it replaces the first; then clear it and confirm the tab disappears.

**Acceptance Scenarios**:

1. **Given** a published explanation, **When** the agent publishes a new one for the same workspace, **Then** the new one replaces the previous one entirely and the tab shows when it was generated and by which agent.
2. **Given** a published explanation, **When** the user clears it, **Then** the explanation and its sent questions are removed and the Explanations tab disappears.
3. **Given** the code at an explained line changed after the explanation was published, **When** the diff renders, **Then** the circle is still placed at its best-matching line and marked as possibly outdated; if no reasonable match exists, the explanation is listed as "detached" in the file's explanation list instead of disappearing.

---

### Edge Cases

- The agent references a file that is not part of the workspace's change set, or a line outside the file → that item is rejected with a specific error returned to the agent; valid items are still published, and the agent is told which ones failed.
- The agent publishes an explanation anchored to a removed line (only present on the old side of the diff) → the circle is placed on the removed line in the diff.
- An explanation covers a range of lines → the circle sits on the first line and the range is subtly highlighted while the explanation is open.
- More than 26 changes → labels continue `AA`, `AB`… (practically, the skill guides agents to keep the number of changes small).
- A file was deleted or renamed by the change → it still appears in the list with its labels; explanations attach to the old-side lines (deleted) or the new path (renamed).
- Binary or very large files where the diff cannot be shown → the file is listed with its labels and its explanations are shown as a list without line circles.
- Two agents publish to the same workspace at nearly the same time → publishes are handled one after another and the later one wins; its response reports that it replaced a previous explanation, and the tab header shows the current agent. The earlier agent is not notified; `orca explain show` shows who published last.
- The workspace runs on a remote host over SSH → publishing, storage, and sending questions behave the same as for a local workspace; if the host is unreachable, the last known explanation stays readable and sending a question reports the connection problem.
- No base branch can be determined (e.g. working directly on the default branch) → the change set falls back to uncommitted changes only, and the tab says so.
- A folder workspace that is not a git repository has no diff → the skill reports that there are no changes to explain and nothing is published.
- Very long explanation text or markdown/code in explanations → rendered as formatted text, scrollable within the inline popover.
- The user wants to add a review note on a removed line (old side) in the Explanations diff → allowed only when Source Control can show that note on the same line: the explanation compares against the base branch and Source Control's branch diff uses the same merge-base. Otherwise (uncommitted-only mode, or a different base in Source Control) the add-note button is not offered on removed lines; new-side notes are unaffected. Agent explanations on removed lines are always shown, since they never appear in Source Control.

## Requirements _(mandatory)_

### Functional Requirements

**Skill and agent interface**

- **FR-001**: The feature MUST deliver an explanation skill saved in the user's global skills folder (`~/.claude/skills/<skill-name>/`), not bundled with or installed by Orca. Any supported coding agent (at minimum Claude Code, GitHub Copilot CLI, and Pi) MUST be able to invoke it from that folder, either directly or through a single `~/.agents/skills/<skill-name>` link to it shared by all agents that read that folder. The skill instructs the agent to analyze its changes in the workspace and publish a structured explanation.
- **FR-002**: The skill MUST instruct the agent to group its work into a small number of cross-cutting changes (aim for 1–5), each with a short title and summary; to give, per change, the files in recommended reading order; and to anchor each explanation to a file and a line or line range.
- **FR-003**: Orca MUST provide a documented command interface, callable by agents from within the workspace, to publish an explanation and to read the currently published one.
- **FR-004**: When publishing, Orca MUST validate every anchor against the workspace's change set — all changes on the branch compared with its base branch, plus uncommitted changes — publish all valid items, and return to the agent a precise list of rejected items with reasons.
- **FR-005**: Publishing MUST record which agent produced the explanation and when.

**Explanations tab and file list**

- **FR-006**: The sidebar MUST show an "Explanations" tab only while the active workspace has a published explanation; otherwise (including right after it is cleared, FR-023) the tab MUST NOT appear.
- **FR-007**: The tab MUST show a legend of the changes (letter, title, summary) and the list of all files modified in the workspace: explained files first, in reading order with their labels, then the remaining modified files in an "Unexplained" group. Unexplained files open as a normal diff (no markers) where notes can still be added.
- **FR-008**: Each file in the list MUST show one label per change it belongs to, formed by the change letter plus the file's position in that change's reading order (e.g. `A1`, `A2 B3`).
- **FR-009**: Users MUST be able to focus a single change from the legend, showing its files in that change's reading order.
- **FR-010**: Labels MUST be assigned by Orca from the order the agent provides, so they are always consistent and gap-free.

**Diff view with explanation markers**

- **FR-011**: Opening a file from the Explanations tab MUST show its diff with a numbered circular marker beside every explained line, labelled hierarchically `<change><file order>.<n>` (e.g. `A1.1`, `A1.2`).
- **FR-012**: Several markers on the same line MUST be shown side by side.
- **FR-013**: Clicking a marker MUST open the explanation inline in the diff, showing the agent's text and any questions already sent about it.
- **FR-014**: Users MUST be able to move to the next/previous explanation in global reading order, crossing files and changes automatically, and see their position in the sequence.
- **FR-015**: Agent explanation markers MUST NOT appear in the Source Control diff view, and Source Control's review notes MUST be visually distinguishable from explanation markers wherever both appear.

**Follow-up questions**

- **FR-016**: Users MUST be able to write a question in any explanation and send it to an agent using the same agent-selection and delivery flow as sending diff notes, with the explanation's original agent preselected when it is still running.
- **FR-017**: Sending a question MUST open/focus the chosen agent's window and deliver the question with enough context to answer it without the UI: the file, anchored lines, and original explanation text.
- **FR-018**: Sent questions MUST remain visible under their explanation, marked as sent and to which agent; agent answers are NOT shown in the explanation (they stay in the agent's window).
- **FR-019**: If sending fails or no agent is available, the question MUST NOT be lost and the user MUST get the same options the diff-note flow offers.

**Action notes**

- **FR-020**: Users MUST be able to add, edit, and delete inline review notes in the Explanations diff view and send them to an agent, with the same behaviour as in Source Control, sharing the workspace's single notes collection. On removed lines (old side), adding a note MUST be offered only when Source Control would show it on the same line (see Edge Cases).

**Lifecycle and storage**

- **FR-021**: The explanation and its sent questions MUST be stored as workspace metadata owned by Orca, never written to the repository, and MUST persist across app restarts until replaced, cleared, or the workspace is deleted.
- **FR-022**: Publishing a new explanation MUST replace the previous one for that workspace.
- **FR-023**: Users MUST be able to clear the explanation, which removes it with its sent questions (the tab then hides, FR-006).
- **FR-024**: When explained code has changed since publishing, markers MUST be relocated to the best-matching line and flagged as possibly outdated, or listed as detached when no match exists. Matching order: the same lines still hold the anchored text (fresh); otherwise the nearest exact match of the anchored block, using surrounding lines to break ties (outdated); otherwise a match ignoring whitespace (outdated); otherwise detached.
- **FR-025**: The feature MUST work for local, WSL, and SSH-hosted workspaces, and for git worktrees and git-backed folder workspaces, on macOS, Linux, and Windows.

### Key Entities

- **Explanation set**: The agent's published explanation for one workspace. Has the producing agent, generation time, an ordered list of changes. At most one per workspace.
- **Change**: A cross-cutting unit of work (letter, title, summary) with an ordered list of file entries.
- **File entry**: A file's participation in one change, with its reading position (gives labels like `A2`) and its ordered explanation items.
- **Explanation item**: One anchored explanation (file, side of diff, line or range, text) with hierarchical label `A2.1`; its freshness (fresh, possibly outdated, detached) is computed when displayed, not stored. May have follow-up questions.
- **Follow-up question**: A user question about one explanation item — text, time, target agent, and delivery state (draft, sent). Answers are not stored.
- **Review note**: The existing user-authored inline note sent to agents for action; unchanged by this feature except that it can be created from the Explanations view.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: The same explanation skill produces a published, correctly labelled explanation from at least three different coding agents (Claude Code, Copilot CLI, Pi) without agent-specific setup by the user.
- **SC-002**: The Explanations tab appears within 2 seconds of the agent finishing a publish, without any manual refresh.
- **SC-003**: A user can go from the first to the last explanation of a 10-file, 3-change explanation using only "next", without manually opening any file.
- **SC-004**: 100% of anchors the agent publishes are either shown at the correct line or reported back to the agent as rejected — none silently disappear.
- **SC-005**: A follow-up question reaches the chosen agent's window, with its explanation context, in one send action and without the user copying any text by hand.
- **SC-006**: Users report that reviewing an agent's multi-file change with explanations takes noticeably less effort than reading the raw diff (qualitative check during dogfooding).

## Assumptions

- The explanation's change set is the branch compared with its base branch plus uncommitted changes; the "modified files" list in the tab and the diffs it opens use this same comparison. The base branch is the one Orca already uses for the workspace's branch comparison. When a pull/merge request is open whose target differs from the workspace's pinned or default base, the explanation still uses the pinned or default base, so the agent and the CLI see the same base; the tab header shows which base was compared.
- The skill lives in `~/.claude/skills` rather than being bundled with Orca's own skills; Orca neither ships nor installs it. Claude Code reads that folder directly. Copilot CLI and Pi read `~/.agents/skills`, so a one-time `~/.agents/skills/<skill-name>` link (a junction on Windows) points them at the same folder; this is one shared step, not per-agent setup. For an SSH-hosted or WSL workspace, the agent runs on that host, so the skill folder (and the link) must exist in that host's home.
- The existing mechanism that makes Orca's command interface available to agents in a workspace is reused.
- Follow-up questions reuse the existing diff-note send flow (agent picker, opening the agent's window, delivery). Showing agent answers inside the explanation is out of scope for v1.
- Review notes created in the Explanations view join the existing workspace notes collection rather than a separate one; "don't mix" applies to agent explanations, which stay out of Source Control.
- Explanation text supports basic formatting (paragraphs, lists, inline and block code).
- Mobile and web clients are out of scope for v1; they may show nothing new.
