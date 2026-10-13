import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => {
  function emptyMap<T>(): Record<string, T> {
    return {}
  }
  return {
    activeWorktreeId: 'visible',
    activeGroupIdByWorktree: emptyMap<string>(),
    groupsByWorktree: emptyMap<{ id: string }[]>(),
    unifiedTabsByWorktree: emptyMap<{ id: string; groupId: string; contentType: string }[]>(),
    createUnifiedTab: vi.fn(),
    ensureApiClientTabState: vi.fn(),
    requestApiClientTabView: vi.fn(),
    focusGroup: vi.fn(),
    activateTab: vi.fn(),
    setActiveTabType: vi.fn()
  }
})

vi.mock('@/store', () => ({ useAppStore: { getState: () => state } }))
vi.mock('@/i18n/i18n', () => ({ translate: (_key: string, fallback: string) => fallback }))

import { ensureApiClientTab } from './ensure-api-client-tab'

beforeEach(() => {
  for (const value of Object.values(state)) {
    if (typeof value === 'function' && 'mockReset' in value) {
      value.mockReset()
    }
  }
  state.activeWorktreeId = 'visible'
  state.activeGroupIdByWorktree = { visible: 'g-visible' }
  state.groupsByWorktree = { visible: [{ id: 'g-visible' }] }
  state.unifiedTabsByWorktree = {}
  state.createUnifiedTab.mockImplementation(
    (worktreeId: string, _type: string, init: { targetGroupId?: string }) => ({
      id: `tab-in-${worktreeId}`,
      groupId: init.targetGroupId ?? 'new-group'
    })
  )
})

describe('ensureApiClientTab', () => {
  it('creates a tab and surfaces it in the worktree that is on screen', () => {
    const tabId = ensureApiClientTab('visible', { view: { kind: 'request', requestId: 'r1' } })
    expect(tabId).toBe('tab-in-visible')
    expect(state.createUnifiedTab).toHaveBeenCalledWith(
      'visible',
      'api-client',
      expect.objectContaining({ activate: true, targetGroupId: 'g-visible' })
    )
    expect(state.requestApiClientTabView).toHaveBeenCalledWith('tab-in-visible', {
      kind: 'request',
      requestId: 'r1'
    })
    expect(state.focusGroup).toHaveBeenCalled()
    expect(state.setActiveTabType).toHaveBeenCalledWith('api-client')
  })

  it('creates the tab in a worktree that is not shown without switching, focusing or activating', () => {
    const tabId = ensureApiClientTab('elsewhere', { view: { kind: 'request', requestId: 'r1' } })
    expect(tabId).toBe('tab-in-elsewhere')
    expect(state.createUnifiedTab).toHaveBeenCalledWith(
      'elsewhere',
      'api-client',
      expect.objectContaining({ activate: false })
    )
    expect(state.requestApiClientTabView).toHaveBeenCalledWith('tab-in-elsewhere', {
      kind: 'request',
      requestId: 'r1'
    })
    expect(state.activeWorktreeId).toBe('visible')
    expect(state.focusGroup).not.toHaveBeenCalled()
    expect(state.activateTab).not.toHaveBeenCalled()
    expect(state.setActiveTabType).not.toHaveBeenCalled()
  })

  it('reuses an existing tab instead of creating another one', () => {
    state.unifiedTabsByWorktree = {
      visible: [{ id: 'existing', groupId: 'g-visible', contentType: 'api-client' }]
    }
    expect(ensureApiClientTab('visible')).toBe('existing')
    expect(state.createUnifiedTab).not.toHaveBeenCalled()
  })

  it('always creates a new tab for the + menu', () => {
    state.unifiedTabsByWorktree = {
      visible: [{ id: 'existing', groupId: 'g-visible', contentType: 'api-client' }]
    }
    expect(ensureApiClientTab('visible', { forceNew: true })).toBe('tab-in-visible')
    expect(state.createUnifiedTab).toHaveBeenCalledTimes(1)
  })
})
