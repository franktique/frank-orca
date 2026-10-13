import { describe, expect, it } from 'vitest'
import { createTestStore } from '@/store/slices/store-test-helpers'
import { selectApiClientSidebarWorktreeId } from './api-client-sidebar-selector'

function seedStore() {
  const store = createTestStore()
  store.setState({
    activeWorktreeId: 'wt-1',
    groupsByWorktree: {
      'wt-1': [{ id: 'g1', worktreeId: 'wt-1', activeTabId: 'api', tabOrder: ['api', 'term'] }]
    },
    activeGroupIdByWorktree: { 'wt-1': 'g1' },
    unifiedTabsByWorktree: {
      'wt-1': [
        {
          id: 'api',
          entityId: 'api',
          groupId: 'g1',
          worktreeId: 'wt-1',
          contentType: 'api-client',
          label: 'API Client',
          customLabel: null,
          color: null,
          sortOrder: 0,
          createdAt: 1
        },
        {
          id: 'term',
          entityId: 'term',
          groupId: 'g1',
          worktreeId: 'wt-1',
          contentType: 'terminal',
          label: 'Terminal',
          customLabel: null,
          color: null,
          sortOrder: 1,
          createdAt: 1
        }
      ]
    }
  })
  return store
}

describe('selectApiClientSidebarWorktreeId', () => {
  it('overrides the sidebar while the focused tab is an API Client tab', () => {
    const store = seedStore()
    expect(selectApiClientSidebarWorktreeId(store.getState())).toBe('wt-1')
  })

  it('restores the usual panel once another tab is focused', () => {
    const store = seedStore()
    store.setState((state) => ({
      groupsByWorktree: {
        'wt-1': state.groupsByWorktree['wt-1'].map((group) => ({ ...group, activeTabId: 'term' }))
      }
    }))
    expect(selectApiClientSidebarWorktreeId(store.getState())).toBeNull()
  })

  it('stays out of the way without an active worktree', () => {
    const store = seedStore()
    store.setState({ activeWorktreeId: null })
    expect(selectApiClientSidebarWorktreeId(store.getState())).toBeNull()
  })
})
