# Contract: `orca explain` CLI and `explanation.*` RPC

The CLI specs go in `src/cli/specs/explanation.ts` and the handlers in `src/cli/handlers/explanation.ts`. Both follow the pattern of `specs/api-client.ts` and `handlers/api-client.ts`. The RPC methods go in `src/main/runtime/rpc/methods/explanation.ts`, with params in `src/shared/rpc-contract/explanation-params.ts`.

## CLI commands

| Command           | Usage                                                                                  | Behavior                                                                                                                                                                                                                                                                                                             |
| ----------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `explain publish` | `orca explain publish --input-stdin [--agent <name>] [--worktree <selector>] [--json]` | Reads the [publish payload](./publish-payload.md) from stdin and calls `explanation.publish`. Exit 0 when `published: true`, even with some rejections. Exit 1 on a fatal error or when nothing is published. Human output: a summary line, then one line per rejection/warning (`A2 item 3: line_out_of_range — …`) |
| `explain show`    | `orca explain show [--worktree <selector>] [--json]`                                   | Prints the current explanation: legend, labelled files, items with resolved labels, questions. `--json` returns the `ExplanationSet` (data-model.md) plus `labels`                                                                                                                                                   |
| `explain clear`   | `orca explain clear [--worktree <selector>] [--json]`                                  | Removes the explanation and its questions                                                                                                                                                                                                                                                                            |
| `explain changes` | `orca explain changes [--worktree <selector>] [--json]`                                | Calls `explanation.changeSet`. Prints the base (`kind`, `baseRef`, `mergeBase`) and the changed files with status and `oldPath` — exactly the files and sides publish validates against                                                                                                                              |
| `explain schema`  | `orca explain schema [--json]`                                                         | Prints the payload JSON Schema. Works without a running runtime                                                                                                                                                                                                                                                      |

**Flags**: `input-stdin` (boolean; required for publish, since the payload is stdin-only so it works over SSH; research R7), `agent`, `worktree` (default: the current workspace from cwd via `resolveCurrentWorktreeSelector`), plus `GLOBAL_FLAGS`.

**Caller identity**: When `ORCA_TERMINAL_HANDLE` is set, the handler sends `{ terminalHandle }` with publish.

**Old host**: `method_not_found` → `This Orca version does not support agent explanations.` (exit 1).

**Registration**: Add to `src/cli/specs/index.ts`, the handler-group manifest, and `registry-parity.test.ts`. There is no bundled skill guide, so `skill-guide-cli-parity.test.ts` is not involved; keep `~/.claude/skills/orca-explain/SKILL.md` in step by hand (contracts/skill.md).

## RPC methods

Every method takes `worktree: string` (a selector). Main resolves it to a `workspaceId` with `runtime.showTerminalWorkspaceLaunchScope`, the same as `resolveTarget` in `methods/api-client.ts`. Failures are `{ ok: false, code, message }`.

| Method                           | Params                                                                            | Result                                                                                                                                            |
| -------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `explanation.publish`            | `{ worktree, payload: unknown, agent?: string, terminalHandle?: string }`         | `{ ok: true, published, explanationId?, replacedPrevious, changeSetBase, counts, labels, rejected, warnings }` (publish-payload.md)               |
| `explanation.get`                | `{ worktree }`                                                                    | `{ ok: true, explanation: ExplanationSet \| null }`                                                                                               |
| `explanation.clear`              | `{ worktree, explanationId?: string }`                                            | `{ ok: true, cleared: boolean }`. With `explanationId`, it only clears if that set is still current (protects against a race with a new publish)  |
| `explanation.fileDiff`           | `{ worktree, path, oldPath?, mergeBase }`                                         | `GitDiffResult` (merge-base blob vs working tree, the same transport budget as `git.diff`). Used by paired-runtime clients. Local clients use IPC |
| `explanation.changeSet`          | `{ worktree }`                                                                    | `{ ok: true, base: ChangeSetBase, files: { path, oldPath?, status }[] }`                                                                          |
| `explanation.questions.upsert`   | `{ worktree, explanationId, question: { id?, itemId, body } }`                    | `{ ok: true, question }`. Code `stale_explanation` when `explanationId` is not current                                                            |
| `explanation.questions.markSent` | `{ worktree, explanationId, questionIds: string[], sentTo: { paneKey?, label } }` | `{ ok: true }`                                                                                                                                    |
| `explanation.questions.delete`   | `{ worktree, explanationId, questionId }`                                         | `{ ok: true }`                                                                                                                                    |

**Error codes**: `selector_not_found`, `not_git_workspace`, `stale_explanation`, `invalid_params`, plus the fatal publish codes. `not_git_workspace` is returned by every method, publish included, when the workspace is a folder that is not a git repository; it is checked while resolving `worktree`, before the payload is parsed. `no_changes` (publish only) means a git workspace whose change set is empty.

**Capability**: The host advertises `agent-explanations.v1` (`AGENT_EXPLANATIONS_RUNTIME_CAPABILITY`). Clients don't call these methods on, or show the tab for, `runtime:` workspaces whose host lacks it.

**Mobile/web**: Not added to `runtime-rpc-mobile-method-allowlist.ts` in v1 (spec: out of scope).

## SSH

Inside an SSH terminal, `orca` is the relay shim, which proxies argv + env + stdin to the client's host CLI. `--input-stdin` matches the relay's existing `--*-stdin` forwarding rule, so it needs no relay change. The publish then runs against the client runtime. That runtime reads git through the SSH provider on the remote host (research R2/R3). When the client is disconnected, the shim reports `No owning Orca client is connected to the relay`, and the skill guide tells the agent to say that to the user and stop.
