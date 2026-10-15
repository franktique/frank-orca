import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => {
  const groups: Record<string, { id: string }[]> = {}
  const activeGroups: Record<string, string> = {}
  return {
    activeWorktreeId: 'visible',
    activeGroupIdByWorktree: activeGroups,
    groupsByWorktree: groups,
    rightSidebarOpen: false,
    createUnifiedTab: vi.fn(),
    ensureSqlTabState: vi.fn(),
    updateSqlTab: vi.fn(),
    focusGroup: vi.fn(),
    activateTab: vi.fn(),
    setActiveTabType: vi.fn(),
    setRightSidebarOpen: vi.fn()
  }
})

vi.mock('@/store', () => ({ useAppStore: { getState: () => state } }))
vi.mock('@/i18n/i18n', () => ({ translate: (_key: string, fallback: string) => fallback }))

import { ensureSqlTab } from './ensure-sql-tab'

beforeEach(() => {
  for (const value of Object.values(state)) {
    if (typeof value === 'function' && 'mockReset' in value) {
      value.mockReset()
    }
  }
  state.activeWorktreeId = 'visible'
  state.activeGroupIdByWorktree = { visible: 'g-visible' }
  state.groupsByWorktree = { visible: [{ id: 'g-visible' }] }
  state.rightSidebarOpen = false
  state.createUnifiedTab.mockImplementation(
    (worktreeId: string, _type: string, init: { targetGroupId?: string }) => ({
      id: `tab-in-${worktreeId}`,
      groupId: init.targetGroupId ?? 'new-group'
    })
  )
})

describe('ensureSqlTab', () => {
  it('creates a tab, focuses it and opens a collapsed right sidebar', () => {
    const tabId = ensureSqlTab('visible')
    expect(tabId).toBe('tab-in-visible')
    expect(state.createUnifiedTab).toHaveBeenCalledWith(
      'visible',
      'sql',
      expect.objectContaining({ label: 'SQL', targetGroupId: 'g-visible', activate: true })
    )
    expect(state.ensureSqlTabState).toHaveBeenCalledWith('tab-in-visible', 'visible')
    expect(state.setActiveTabType).toHaveBeenCalledWith('sql')
    expect(state.setRightSidebarOpen).toHaveBeenCalledWith(true)
  })

  it('respects a sidebar that is already open', () => {
    state.rightSidebarOpen = true
    ensureSqlTab('visible')
    expect(state.setRightSidebarOpen).not.toHaveBeenCalled()
  })

  it('always creates a new tab on every call', () => {
    ensureSqlTab('visible')
    ensureSqlTab('visible')
    expect(state.createUnifiedTab).toHaveBeenCalledTimes(2)
  })

  it('never steals focus in a worktree that is not on screen', () => {
    ensureSqlTab('hidden')
    expect(state.createUnifiedTab).toHaveBeenCalledWith(
      'hidden',
      'sql',
      expect.objectContaining({ activate: false })
    )
    expect(state.activateTab).not.toHaveBeenCalled()
    expect(state.setRightSidebarOpen).not.toHaveBeenCalled()
  })

  it('preselects a connection when given one', () => {
    ensureSqlTab('visible', { connectionId: 'c1' })
    expect(state.updateSqlTab).toHaveBeenCalledWith('tab-in-visible', { connectionId: 'c1' })
  })
})
