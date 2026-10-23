import { defineMethod, type RpcContext } from '../core'
import {
  ExplanationChangeSetParams,
  ExplanationClearParams,
  ExplanationFileDiffParams,
  ExplanationGetParams,
  ExplanationPublishParams,
  ExplanationQuestionDeleteParams,
  ExplanationQuestionMarkSentParams,
  ExplanationQuestionUpsertParams
} from '../../../../shared/rpc-contract/explanation-params'
import { remoteRpcContentBudget } from '../../../../shared/remote-rpc-content-budget'
import { buildExplanationChangeSet } from '../../../agent-explanations/explanation-change-set'
import { readExplanationFileDiff } from '../../../agent-explanations/explanation-file-diff'
import {
  explanationChangeSetDeps as changeSetDeps,
  explanationFailure,
  explanationFileDiffBase as fileDiffBase,
  explanationFileDiffDeps as fileDiffDeps,
  resolveExplanationWorkspace as resolveWorkspace
} from '../../../agent-explanations/explanation-runtime-access'
import {
  publishExplanation,
  type ExplanationPublishDeps
} from '../../../agent-explanations/explanation-publish'
import { getExplanationStore } from '../../../agent-explanations/explanation-store'

const fail = explanationFailure

function publishDeps(runtime: RpcContext['runtime']): ExplanationPublishDeps {
  return {
    changeSet: (selector) => buildExplanationChangeSet(selector, changeSetDeps(runtime)),
    fileDiff: (selector, filePath, mergeBase) =>
      readExplanationFileDiff(
        selector,
        filePath,
        fileDiffBase(mergeBase),
        // Uncapped: publish reads sides for fingerprints, not for the wire.
        fileDiffDeps(runtime)
      ),
    replace: (workspaceId, set) => getExplanationStore().replace(workspaceId, set),
    terminalInfo: (terminalHandle) => terminalInfoForHandle(runtime, terminalHandle)
  }
}

/** Joins a CLI terminal handle to its pane and the pane's agent identity, from the same
 *  hook-server snapshot every other reader uses. */
export function terminalInfoForHandle(
  runtime: RpcContext['runtime'],
  terminalHandle: string
): { paneKey?: string; agentName?: string | null } | null {
  for (const evidence of runtime.getOrchestrationFleetAgentStatusSnapshot()) {
    const binding = evidence.binding
    if (binding.kind !== 'unresolved' && binding.terminalHandle === terminalHandle) {
      return { paneKey: binding.paneKey, agentName: evidence.activity.agentType ?? null }
    }
  }
  return null
}

// Why: clientKind is set only for WebSocket-transported requests, so desktop-local and in-process
// callers keep uncapped full-fidelity diffs.
function remoteDiffContentBudget(
  clientKind: 'mobile' | 'runtime' | undefined,
  requestId: string | undefined
): number | undefined {
  return clientKind && requestId ? remoteRpcContentBudget(requestId) : undefined
}

export const EXPLANATION_METHODS = [
  defineMethod({
    name: 'explanation.publish',
    params: ExplanationPublishParams,
    handler: async (params, { runtime }) => {
      const resolved = await resolveWorkspace(runtime, params.worktree)
      if (!resolved.ok) {
        return resolved
      }
      const outcome = await publishExplanation(
        params.worktree,
        params.payload,
        { agent: params.agent, terminalHandle: params.terminalHandle },
        publishDeps(runtime)
      )
      return outcome.ok ? outcome.result : fail(outcome.code, outcome.message)
    }
  }),
  defineMethod({
    name: 'explanation.get',
    params: ExplanationGetParams,
    handler: async (params, { runtime }) => {
      const resolved = await resolveWorkspace(runtime, params.worktree)
      if (!resolved.ok) {
        return resolved
      }
      return {
        ok: true as const,
        explanation: await getExplanationStore().get(resolved.workspaceId)
      }
    }
  }),
  defineMethod({
    name: 'explanation.clear',
    params: ExplanationClearParams,
    handler: async (params, { runtime }) => {
      const resolved = await resolveWorkspace(runtime, params.worktree)
      if (!resolved.ok) {
        return resolved
      }
      return getExplanationStore().clear(resolved.workspaceId, params.explanationId)
    }
  }),
  defineMethod({
    name: 'explanation.questions.upsert',
    params: ExplanationQuestionUpsertParams,
    handler: async (params, { runtime }) => {
      const resolved = await resolveWorkspace(runtime, params.worktree)
      return resolved.ok
        ? getExplanationStore().upsertQuestion(
            resolved.workspaceId,
            params.explanationId,
            params.question
          )
        : resolved
    }
  }),
  defineMethod({
    name: 'explanation.questions.markSent',
    params: ExplanationQuestionMarkSentParams,
    handler: async (params, { runtime }) => {
      const resolved = await resolveWorkspace(runtime, params.worktree)
      return resolved.ok
        ? getExplanationStore().markQuestionsSent(
            resolved.workspaceId,
            params.explanationId,
            params.questionIds,
            params.sentTo
          )
        : resolved
    }
  }),
  defineMethod({
    name: 'explanation.questions.delete',
    params: ExplanationQuestionDeleteParams,
    handler: async (params, { runtime }) => {
      const resolved = await resolveWorkspace(runtime, params.worktree)
      return resolved.ok
        ? getExplanationStore().deleteQuestion(
            resolved.workspaceId,
            params.explanationId,
            params.questionId
          )
        : resolved
    }
  }),
  defineMethod({
    name: 'explanation.changeSet',
    params: ExplanationChangeSetParams,
    handler: async (params, { runtime }) => {
      const resolved = await resolveWorkspace(runtime, params.worktree)
      if (!resolved.ok) {
        return resolved
      }
      const snapshot = await buildExplanationChangeSet(params.worktree, changeSetDeps(runtime))
      return { ok: true as const, base: snapshot.base, files: snapshot.files }
    }
  }),
  defineMethod({
    name: 'explanation.fileDiff',
    params: ExplanationFileDiffParams,
    handler: async (params, { runtime, clientKind, requestId }) => {
      const resolved = await resolveWorkspace(runtime, params.worktree)
      if (!resolved.ok) {
        return resolved
      }
      try {
        return await readExplanationFileDiff(
          params.worktree,
          params.path,
          fileDiffBase(params.mergeBase),
          fileDiffDeps(runtime, remoteDiffContentBudget(clientKind, requestId))
        )
      } catch (error) {
        if (error instanceof Error && error.message === 'invalid_relative_path') {
          return fail('invalid_params', `Path "${params.path}" is not a valid repo-relative path.`)
        }
        throw error
      }
    }
  })
]
