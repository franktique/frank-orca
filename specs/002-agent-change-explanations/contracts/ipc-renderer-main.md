# Contract: Renderer ↔ main (`window.api.explanations`)

Preload code goes in `src/preload/api/explanations-api.ts` (+ bridge), and handlers in `src/main/ipc/agent-explanations/explanation-ipc.ts`. Every payload is validated with the zod schemas from `explanation-schemas.ts`. The handlers call the same `explanation-store` / `explanation-publish` / `explanation-change-set` functions the RPC methods use, so the behavior is identical.

The renderer never calls these directly. It goes through `src/renderer/src/runtime/runtime-explanation-client.ts`, which picks local IPC or `callRuntimeRpc` the same way `runtime-git-diff-client.ts` does.

```ts
type ExplanationsApi = {
  get(args: {
    workspaceId: string;
  }): Promise<Result<{ explanation: ExplanationSet | null }>>;
  clear(args: {
    workspaceId: string;
    explanationId?: string;
  }): Promise<Result<{ cleared: boolean }>>;
  changeSet(args: {
    workspaceId: string;
    connectionId?: string;
  }): Promise<Result<{ base: ChangeSetBase; files: ChangeSetFile[] }>>;
  fileDiff(args: {
    workspaceId: string;
    path: string;
    oldPath?: string;
    mergeBase: string;
    connectionId?: string;
  }): Promise<GitDiffResult>;
  upsertQuestion(args: {
    workspaceId: string;
    explanationId: string;
    question: { id?: string; itemId: string; body: string };
  }): Promise<Result<{ question: FollowUpQuestion }>>;
  markQuestionsSent(args: {
    workspaceId: string;
    explanationId: string;
    questionIds: string[];
    sentTo: { paneKey?: string; label: string };
  }): Promise<Result>;
  deleteQuestion(args: {
    workspaceId: string;
    explanationId: string;
    questionId: string;
  }): Promise<Result>;
  /** Returns the unsubscribe function. */
  onChanged(
    listener: (event: { workspaceId: string; revision: number }) => void,
  ): () => void;
};
type Result<T = object> =
  ({ ok: true } & T) | { ok: false; code: string; message: string };
```

**`connectionId`** (IPC `changeSet` and `fileDiff`, the two channels that read git): the SSH connection of the workspace, passed the same way `runtime-git-diff-client.ts` passes it to `window.api.git.diff`, so main routes the git reads to the right remote host. The RPC has no equivalent because the host resolves the connection from `worktree`.

**Channels**: `explanations:get`, `explanations:clear`, `explanations:changeSet`, `explanations:fileDiff`, `explanations:questions:upsert`, `explanations:questions:markSent`, `explanations:questions:delete` (invoke), and `explanations:changed` (main → renderer event).

**Push**: `explanation-store` emits after every write. Main broadcasts `explanations:changed` to all windows. The renderer slice refetches `get` only when `revision` is greater than the one it holds (research R9).

**No publish over IPC**: Only agents publish, through the CLI/RPC. The UI can read, clear and manage questions.

## Renderer-internal contracts touched

- `DiffSource` += `'explanation'`. `OpenFile` gets an optional `explanationRef: { explanationId: string; focusItemId?: string }`, plus the `mergeBase` it was opened with. The diff reload path (`editor-panel-diff-reload.ts`) calls `fileDiff` for this source. Tab labels and headers (`editor-labels.ts`, `editor-header.ts`) show "Explanation" plus the base.
- `NotesSendMenu` props += `preferredTargetPaneKey?: string`. `onDelivered(notes, target?: { paneKey?: string; label: string })`. Both are optional, and existing callers don't change.
- `getVisibleRightSidebarActivityItems(items, { …, hasExplanation })` and `ActivityBarItem.requiresExplanation?: boolean`.
- The client-ui sync serializer maps `'explanations'` → `'source-control'` for hosts without `agent-explanations.v1`, and the host's `ui.get` does the same for clients without it. `normalizeRightSidebarTab` accepts `'explanations'` (research R10).
- **Naming**: every new contract uses `workspaceId` (worktree id or folder-workspace key, data-model.md). Existing renderer code that calls it `worktreeId` passes the same value.
