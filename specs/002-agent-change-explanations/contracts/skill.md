# Contract: `orca-explain` skill

## Placement

| Path                                                              | Kind                                         | Purpose                                                                      |
| ----------------------------------------------------------------- | -------------------------------------------- | ---------------------------------------------------------------------------- |
| `~/.claude/skills/orca-explain/SKILL.md` (execution host)         | the skill (only copy)                        | Required by the spec. Full, self-contained instructions. Read by Claude Code |
| `~/.agents/skills/orca-explain` → `~/.claude/skills/orca-explain` | link (junction on Windows; a copy as fallback must be refreshed by hand when the skill changes) | Read by Copilot CLI, Pi and Codex (research R14)                             |

The skill is **not** in the repository, not in the app bundle, and not installed by Orca's skill installer (spec clarification). It is written once into `~/.claude/skills/orca-explain/` on each execution host that runs agents: local, WSL, or the SSH remote. Because it is not version-matched to Orca, `orca explain schema` is the source of truth for the payload shape, and CLI changes must be mirrored into the skill by hand.

## Frontmatter

```yaml
---
name: orca-explain
description: >-
  Explain your implementation to the user inside Orca. Use when the user asks you to
  "explain your changes", "walk me through what you did", "$orca-explain", or to annotate
  the diff. Groups the work into lettered changes, anchors explanations to exact lines,
  and publishes them to Orca's Explanations tab with `orca explain publish`.
---
```

## Required content (behavioral contract)

1. **Resolve the CLI** with the same rules `skills/orca-cli/SKILL.md` uses, written out inline (`ORCA_CLI_COMMAND`, `orca-dev`, `orca-ide` on Linux, else `orca`). If no CLI is found, tell the user the skill must run inside an Orca terminal and stop.
2. **Get the change set** with `orca explain changes --json`: the authoritative list of files that may be anchored, plus the `mergeBase` to compare against. Read line content with `git diff <mergeBase> -- <path>` or the working-tree file for new-side lines (git 2.25-safe). Do not work out a base yourself. Also run `orca explain show --json` to see any current explanation. If the command fails with `not_git_workspace`, or the change set is empty, tell the user there are no changes to explain and stop.
3. **Group the work** into a small number of changes (aim for 1–5; never more than needed), each with a short title and a 1–3 sentence summary. List the files of each change in recommended reading order. A file may belong to several changes.
4. **Anchor** every explanation to `side: "new"` lines of the working tree, or `side: "old"` for removed code. Use line ranges for blocks. Explain _why_, not what the diff already shows. Keep each item under ~120 words.
5. **Publish** with stdin only: a POSIX heredoc piped into `orca explain publish --input-stdin --json`, or `Get-Content -Raw <file> | orca explain publish --input-stdin --json` in PowerShell. Never write the payload into the repository. A temp file goes in the OS temp dir. Run `orca explain schema` if unsure of the payload shape.
6. **Fix rejections**: read `rejected[]`, fix the paths or lines, and re-publish the whole payload once. Then report the result: labels created, plus anything still rejected.
7. **SSH**: if the CLI reports `No owning Orca client is connected to the relay`, tell the user and stop.
8. **Follow-up questions** arrive later as normal prompts that carry the file, lines and original explanation. Answer them in the chat. Do not re-publish unless asked.
9. **Clear** with `orca explain clear` only when the user asks to remove the explanation. Re-publishing already replaces it, so never clear before a publish.

## Agent compatibility evidence (to record during implementation)

For each of Claude Code, Copilot CLI and Pi, on macOS, Linux, Windows and WSL: the skill is discovered from the placements above with no per-agent setup, and a scripted 2-change publish succeeds (SC-001). Record the results in the matrix in quickstart.md §4.
