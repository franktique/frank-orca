import { describe, expect, it } from 'vitest'
import { createTestStore } from '@/store/slices/store-test-helpers'
import { selectApiClientSidebarWorktreeId } from '../api-client/sidebar/api-client-sidebar-selector'
import { selectSqlSidebarTarget } from './sql-sidebar-selector'

function tab(id: string, contentType: 'sql' | 'api-client' | 'terminal', sortOrder: number) {
  return {
    id,
    entityId: id,
    groupId: 'g1',
    worktreeId: 'wt-1',
    contentType,
    label: id,
    customLabel: null,
    color: null,
    sortOrder,
    createdAt: 1
  }
}

function seedStore(activeTabId: string) {
  const store = createTestStore()
  store.setState({
    repos: [{ id: 'wt', path: '/w', displayName: 'W', badgeColor: '#000', addedAt: 0 }],
    activeWorktreeId: 'wt-1',
    groupsByWorktree: {
      'wt-1': [{ id: 'g1', worktreeId: 'wt-1', activeTabId, tabOrder: ['sql', 'api', 'term'] }]
    },
    activeGroupIdByWorktree: { 'wt-1': 'g1' },
    unifiedTabsByWorktree: {
      'wt-1': [tab('sql', 'sql', 0), tab('api', 'api-client', 1), tab('term', 'terminal', 2)]
    }
  })
  return store
}

describe('right sidebar dispatch', () => {
  it('serves the focused SQL tab and nothing else', () => {
    const state = seedStore('sql').getState()
    expect(selectSqlSidebarTarget(state)).toEqual({ worktreeId: 'wt-1', tabId: 'sql' })
    expect(selectApiClientSidebarWorktreeId(state)).toBeNull()
  })

  it('leaves the API Client panel to API Client tabs', () => {
    const state = seedStore('api').getState()
    expect(selectSqlSidebarTarget(state)).toBeNull()
    expect(selectApiClientSidebarWorktreeId(state)).toBe('wt-1')
  })

  it('returns to the routed panel once a terminal tab is focused', () => {
    const store = seedStore('sql')
    store.setState((state) => ({
      groupsByWorktree: {
        'wt-1': state.groupsByWorktree['wt-1'].map((group) => ({ ...group, activeTabId: 'term' }))
      }
    }))
    expect(selectSqlSidebarTarget(store.getState())).toBeNull()
    expect(selectApiClientSidebarWorktreeId(store.getState())).toBeNull()
  })

  it('never changes the persisted right sidebar route', () => {
    const store = seedStore('sql')
    const before = store.getState().rightSidebarTab
    selectSqlSidebarTarget(store.getState())
    expect(store.getState().rightSidebarTab).toBe(before)
  })
})
