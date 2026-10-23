import { describe, expect, it, vi } from 'vitest'
import type { GitStatusResult } from '../../../../shared/git-status-types'
import type { OrcaRuntimeService } from '../../orca-runtime'
import { RpcDispatcher } from '../dispatcher'
import type { RpcRequest } from '../core'
import type { RuntimeGitTarget } from '../../runtime-git-command-target'
import { EXPLANATION_METHODS, terminalInfoForHandle } from './explanation'

const HEAD = 'a'.repeat(40)
const MERGE_BASE = 'b'.repeat(40)

function readyCompare(): { summary: Record<string, unknown>; entries: never[] } {
  return {
    summary: {
      baseRef: 'origin/main',
      baseOid: 'c'.repeat(40),
      compareRef: 'feature',
      headOid: HEAD,
      mergeBase: MERGE_BASE,
      changedFiles: 0,
      status: 'ready'
    },
    entries: []
  }
}

function makeTarget(): RuntimeGitTarget {
  const worktree = {
    id: 'wt-1',
    repoId: 'repo-1',
    path: '/repo/wt',
    git: { path: '/repo/wt', head: HEAD, branch: 'feature', isBare: false, isMainWorktree: false }
  } satisfies Partial<RuntimeGitTarget['worktree']>
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: test double only needs the members the code under test reads.
  return {
    worktree,
    repo: { id: 'repo-1', path: '/repo', worktreeBaseRef: 'origin/main' }
  } as unknown as RuntimeGitTarget
}

const GIT_STATUS: GitStatusResult = {
  entries: [{ path: 'src/a.ts', area: 'unstaged', status: 'modified' }],
  conflictOperation: 'unknown'
}

function dispatcher(runtimeOverrides: Record<string, unknown> = {}): RpcDispatcher {
  const runtime = {
    getRuntimeId: () => 'test-runtime',
    showTerminalWorkspaceLaunchScope: async (selector: string) => {
      if (selector === 'missing') {
        throw new Error('selector_not_found')
      }
      if (selector === 'folder') {
        return {
          id: 'fw-1',
          path: '/folder',
          connectionId: null,
          repo: null,
          folderWorkspace: { id: 'fw-1' }
        }
      }
      return { id: 'wt-1', path: '/repo/wt', connectionId: null, repo: null, folderWorkspace: null }
    },
    showRuntimeGitTarget: async () => makeTarget(),
    getRuntimeGitBranchCompare: async () => readyCompare(),
    getRuntimeGitStatus: async (): Promise<GitStatusResult> => GIT_STATUS,
    showManagedWorktreeMetaForHost: () => undefined,
    getRuntimeGitDiff: vi.fn(),
    getOrchestrationFleetAgentStatusSnapshot: () => [],
    ...runtimeOverrides
  }
  // SAFETY: only the members explanation.ts reads are stubbed; the rest of the runtime is unused.
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: test stub of the runtime surface.
  return new RpcDispatcher({
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: test double only needs the members the code under test reads.
    runtime: runtime as unknown as OrcaRuntimeService,
    methods: EXPLANATION_METHODS
  })
}

/** The envelope is transport-level; handler failures travel as `{ok:false, code, message}` results. */
async function call(
  method: string,
  params: unknown,
  overrides: Record<string, unknown> = {}
): Promise<unknown> {
  const rpc: RpcRequest = { id: 'req', authToken: 'tok', method, params }
  const response = await dispatcher(overrides).dispatch(rpc)
  if (!response.ok) {
    throw new Error(`${response.error.code}: ${response.error.message}`)
  }
  return response.result
}

describe('explanation RPC methods', () => {
  it('rejects an unknown selector for every method', async () => {
    for (const method of [
      'explanation.publish',
      'explanation.get',
      'explanation.changeSet',
      'explanation.fileDiff'
    ]) {
      const outcome = await call(method, {
        worktree: 'missing',
        payload: {},
        path: 'a.ts',
        mergeBase: HEAD
      })
      expect(outcome).toMatchObject({ ok: false, code: 'selector_not_found' })
    }
  })

  it('refuses folder workspaces before parsing the payload', async () => {
    const outcome = await call('explanation.publish', {
      worktree: 'folder',
      payload: 'not json at all'
    })
    expect(outcome).toMatchObject({ ok: false, code: 'not_git_workspace' })
  })

  it('refuses folder workspaces for reads too', async () => {
    expect(await call('explanation.get', { worktree: 'folder' })).toMatchObject({
      ok: false,
      code: 'not_git_workspace'
    })
    expect(await call('explanation.changeSet', { worktree: 'folder' })).toMatchObject({
      ok: false,
      code: 'not_git_workspace'
    })
  })

  it('builds the change set through the runtime git commands', async () => {
    const outcome = await call('explanation.changeSet', { worktree: 'wt-1' })
    expect(outcome).toEqual({
      ok: true,
      base: {
        kind: 'branch-and-uncommitted',
        baseRef: 'origin/main',
        mergeBase: MERGE_BASE,
        headOid: HEAD
      },
      files: [{ path: 'src/a.ts', status: 'modified' }]
    })
  })

  it('returns published:false when every item is rejected', async () => {
    const outcome = await call('explanation.publish', {
      worktree: 'wt-1',
      payload: {
        version: 1,
        changes: [
          {
            title: 'T',
            summary: 'S',
            files: [{ path: 'src/gone.ts', items: [{ id: 'x1', text: 'hi' }] }]
          }
        ]
      }
    })
    expect(outcome).toEqual({
      ok: true,
      published: false,
      replacedPrevious: false,
      changeSetBase: {
        kind: 'branch-and-uncommitted',
        baseRef: 'origin/main',
        mergeBase: MERGE_BASE,
        headOid: HEAD
      },
      counts: { changes: 0, files: 0, items: 0, rejected: 1, warnings: 0 },
      labels: [],
      rejected: [
        {
          code: 'file_not_in_change_set',
          message: 'Path "src/gone.ts" is not in the change set.',
          changeIndex: 0,
          fileIndex: 0,
          path: 'src/gone.ts'
        }
      ],
      warnings: []
    })
  })

  it('rejects an invalid path in fileDiff without reading the diff', async () => {
    const diff = vi.fn()
    const outcome = await call(
      'explanation.fileDiff',
      { worktree: 'wt-1', path: '../escape', mergeBase: HEAD },
      { getRuntimeGitDiff: diff }
    )
    expect(outcome).toMatchObject({ ok: false, code: 'invalid_params' })
    expect(diff).not.toHaveBeenCalled()
  })

  it('resolves terminal info from the fleet snapshot bindings', () => {
    expect(terminalInfo([evidence('t-1', 'pane-1', 'claude')], 't-1')).toEqual({
      paneKey: 'pane-1',
      agentName: 'claude'
    })
    expect(terminalInfo([evidence('t-1', 'pane-1', 'claude')], 't-9')).toBeNull()
    expect(
      terminalInfo(
        [
          {
            binding: { kind: 'unresolved', reason: 'pane_not_bound' },
            activity: { agentType: 'claude' }
          }
        ],
        't-1'
      )
    ).toBeNull()
  })
})

function evidence(
  terminalHandle: string,
  paneKey: string | null,
  agentType: string
): Record<string, unknown> {
  return {
    binding: { kind: 'pane', terminalHandle, paneKey, processIncarnation: 'i' },
    clock: { kind: 'delivery', at: 0 },
    deliveredAt: 0,
    activity: {
      paneKey: paneKey ?? '',
      connectionId: null,
      state: 'idle',
      agentType,
      model: null,
      worktreeId: 'wt-1',
      restoredUnconfirmed: false,
      providerSessionOnly: false
    }
  }
}

function terminalInfo(fleet: unknown[], terminalHandle: string): unknown {
  // SAFETY: only the fleet snapshot is read by terminalInfoForHandle.
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: test stub of the fleet snapshot.
  return terminalInfoForHandle(
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: test double only needs the members the code under test reads.
    { getOrchestrationFleetAgentStatusSnapshot: () => fleet } as unknown as OrcaRuntimeService,
    terminalHandle
  )
}
