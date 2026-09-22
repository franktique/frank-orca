// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, renderHook } from '@testing-library/react'
import { useAppStore } from '@/store'
import type { Tab } from '../../../../shared/tab-types'
import { getWorktreeHostIdentity } from '../../../../shared/worktree/host-qualified-identity'
import { makeRepo, makeWorktree } from '../worktree-jump-palette-test-fixtures'
import { useVisibleWorkspaceKanbanWorktreeIds } from './use-visible-workspace-kanban-worktree-ids'

const initialState = useAppStore.getInitialState()

describe('useVisibleWorkspaceKanbanWorktreeIds', () => {
  beforeEach(() => {
    useAppStore.setState(initialState, true)
  })

  afterEach(() => {
    cleanup()
    useAppStore.setState(initialState, true)
  })

  it('keeps a single-host filter host-qualified when workspace ids collide', () => {
    const local = makeWorktree('shared', 'Local workspace', { hostId: 'local' })
    const ssh = makeWorktree('shared', 'SSH workspace', { hostId: 'ssh:box' })
    const repo = makeRepo()
    useAppStore.setState({
      worktreesByRepo: { [repo.id]: [local, ssh] },
      showSleepingWorkspaces: true,
      visibleWorkspaceHostIds: ['local']
    })

    const { result } = renderHook(() =>
      useVisibleWorkspaceKanbanWorktreeIds({
        allWorktrees: [local, ssh],
        repoMap: new Map([[repo.id, repo]])
      })
    )

    expect(result.current).toEqual(new Set([getWorktreeHostIdentity(local)]))
  })

  it('keeps a structured-chat workspace visible when sleeping workspaces are hidden', () => {
    const worktree = makeWorktree('chat', 'Chat workspace')
    const repo = makeRepo()
    const structuredTab: Tab = {
      id: 'chat-tab',
      entityId: 'chat-session',
      groupId: 'chat-group',
      worktreeId: worktree.id,
      contentType: 'agent-session',
      agentSessionAgent: 'codex',
      label: 'Chat',
      customLabel: null,
      color: null,
      sortOrder: 0,
      createdAt: 0
    }
    useAppStore.setState({
      worktreesByRepo: { [repo.id]: [worktree] },
      unifiedTabsByWorktree: { [worktree.id]: [structuredTab] },
      showSleepingWorkspaces: false
    })

    const { result } = renderHook(() =>
      useVisibleWorkspaceKanbanWorktreeIds({
        allWorktrees: [worktree],
        repoMap: new Map([[repo.id, repo]])
      })
    )

    expect(result.current).toEqual(new Set([getWorktreeHostIdentity(worktree)]))
  })

  it('drops worktrees of hidden repos unless showHiddenProjects is set', () => {
    const repo = { ...makeRepo(), hidden: true }
    const alpha = makeWorktree('alpha', 'Alpha workspace', { hostId: 'local' })
    const beta = makeWorktree('beta', 'Beta workspace', { hostId: 'local' })
    useAppStore.setState({
      worktreesByRepo: { [repo.id]: [alpha, beta] },
      showSleepingWorkspaces: true
    })

    const { result } = renderHook(() =>
      useVisibleWorkspaceKanbanWorktreeIds({
        allWorktrees: [alpha, beta],
        repoMap: new Map([[repo.id, repo]])
      })
    )
    expect(result.current).toEqual(new Set())

    useAppStore.setState({ showHiddenProjects: true })
    const openResult = renderHook(() =>
      useVisibleWorkspaceKanbanWorktreeIds({
        allWorktrees: [alpha, beta],
        repoMap: new Map([[repo.id, repo]])
      })
    )
    expect(openResult.result.current).toEqual(
      new Set([getWorktreeHostIdentity(alpha), getWorktreeHostIdentity(beta)])
    )
  })

  it('drops individually hidden worktrees unless showHiddenProjects is set', () => {
    const repo = makeRepo()
    const visible = makeWorktree('alpha', 'Alpha workspace', { hostId: 'local' })
    const hidden = {
      ...makeWorktree('beta', 'Beta workspace', { hostId: 'local' }),
      isHidden: true
    }
    useAppStore.setState({
      worktreesByRepo: { [repo.id]: [visible, hidden] },
      showSleepingWorkspaces: true
    })

    const { result } = renderHook(() =>
      useVisibleWorkspaceKanbanWorktreeIds({
        allWorktrees: [visible, hidden],
        repoMap: new Map([[repo.id, repo]])
      })
    )
    expect(result.current).toEqual(new Set([getWorktreeHostIdentity(visible)]))

    useAppStore.setState({ showHiddenProjects: true })
    const openResult = renderHook(() =>
      useVisibleWorkspaceKanbanWorktreeIds({
        allWorktrees: [visible, hidden],
        repoMap: new Map([[repo.id, repo]])
      })
    )
    expect(openResult.result.current).toEqual(
      new Set([getWorktreeHostIdentity(visible), getWorktreeHostIdentity(hidden)])
    )
  })
})
