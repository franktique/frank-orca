import { translate } from '@/i18n/i18n'
import { AGENT_EXPLANATIONS_RUNTIME_CAPABILITY } from '../../../shared/protocol-version'
import type { GitDiffResult } from '../../../shared/git-diff-compare-types'
import type {
  ChangeSetBase,
  ChangeSetFile,
  ExplanationSet,
  FollowUpQuestion
} from '../../../shared/agent-explanations/explanation-types'
import type { ExplanationsResult } from '../../../preload/api/explanations-api'
import type { RuntimeGitContext } from './runtime-git-client-context'
import {
  callRuntimeRpc,
  getActiveRuntimeTarget,
  runtimeEnvironmentSupportsCapability
} from './runtime-rpc-client'
import { toRuntimeWorktreeSelector } from './runtime-worktree-selector'

export type ExplanationClientContext = Pick<RuntimeGitContext, 'settings' | 'connectionId'> & {
  workspaceId: string
}

const unsupported = (): { ok: false; code: 'unsupported'; message: string } => ({
  ok: false,
  code: 'unsupported',
  message: translate(
    'auto.components.right.sidebar.explanations.unsupported',
    'This Orca host does not support agent explanations.'
  )
})

type ExplanationRpcFailure = { ok: false; code: string; message: string }

export function isExplanationFailure(value: object): value is ExplanationRpcFailure {
  return 'ok' in value && value.ok === false
}
const RPC_TIMEOUT_MS = 15_000

/** True for local runtimes and for `runtime:` hosts that advertise agent-explanations.v1. */
export async function runtimeSupportsExplanations(
  context: Pick<ExplanationClientContext, 'settings'>
): Promise<boolean> {
  const target = getActiveRuntimeTarget(context.settings)
  return (
    target.kind === 'local' ||
    runtimeEnvironmentSupportsCapability(
      target.environmentId,
      AGENT_EXPLANATIONS_RUNTIME_CAPABILITY
    )
  )
}

async function viaRuntime<T>(
  context: ExplanationClientContext,
  local: () => Promise<T>,
  method: string,
  params: Record<string, unknown>
): Promise<T | ReturnType<typeof unsupported>> {
  const target = getActiveRuntimeTarget(context.settings)
  if (target.kind === 'local') {
    return local()
  }
  if (!(await runtimeSupportsExplanations(context))) {
    return unsupported()
  }
  return callRuntimeRpc<T>(
    target,
    method,
    { worktree: toRuntimeWorktreeSelector(context.workspaceId), ...params },
    { timeoutMs: RPC_TIMEOUT_MS }
  )
}

export function getRuntimeExplanation(
  context: ExplanationClientContext
): Promise<ExplanationsResult<{ explanation: ExplanationSet | null }>> {
  return viaRuntime(
    context,
    () => window.api.explanations.get({ workspaceId: context.workspaceId }),
    'explanation.get',
    {}
  )
}

export function getRuntimeExplanationChangeSet(
  context: ExplanationClientContext
): Promise<ExplanationsResult<{ base: ChangeSetBase; files: ChangeSetFile[] }>> {
  return viaRuntime(
    context,
    () =>
      window.api.explanations.changeSet({
        workspaceId: context.workspaceId,
        connectionId: context.connectionId
      }),
    'explanation.changeSet',
    {}
  )
}

export function clearRuntimeExplanation(
  context: ExplanationClientContext,
  explanationId?: string
): Promise<ExplanationsResult<{ cleared: boolean }>> {
  return viaRuntime(
    context,
    () => window.api.explanations.clear({ workspaceId: context.workspaceId, explanationId }),
    'explanation.clear',
    { explanationId }
  )
}

export function upsertRuntimeExplanationQuestion(
  context: ExplanationClientContext,
  args: { explanationId: string; question: { id?: string; itemId: string; body: string } }
): Promise<ExplanationsResult<{ question: FollowUpQuestion }>> {
  return viaRuntime(
    context,
    () => window.api.explanations.upsertQuestion({ workspaceId: context.workspaceId, ...args }),
    'explanation.questions.upsert',
    args
  )
}

export function markRuntimeExplanationQuestionsSent(
  context: ExplanationClientContext,
  args: {
    explanationId: string
    questionIds: string[]
    sentTo: { paneKey?: string; label: string }
  }
): Promise<ExplanationsResult> {
  return viaRuntime(
    context,
    () => window.api.explanations.markQuestionsSent({ workspaceId: context.workspaceId, ...args }),
    'explanation.questions.markSent',
    args
  )
}

export function deleteRuntimeExplanationQuestion(
  context: ExplanationClientContext,
  args: { explanationId: string; questionId: string }
): Promise<ExplanationsResult> {
  return viaRuntime(
    context,
    () => window.api.explanations.deleteQuestion({ workspaceId: context.workspaceId, ...args }),
    'explanation.questions.delete',
    args
  )
}

export function getRuntimeExplanationFileDiff(
  context: ExplanationClientContext,
  args: { path: string; oldPath?: string; mergeBase: string }
): Promise<GitDiffResult | ExplanationRpcFailure> {
  return viaRuntime(
    context,
    () =>
      window.api.explanations.fileDiff({
        workspaceId: context.workspaceId,
        connectionId: context.connectionId,
        ...args
      }),
    'explanation.fileDiff',
    args
  )
}
