import { describe, expect, it } from 'vitest'
import { buildMobileSessionTabSnapshots } from './sync-runtime-graph'
import { makeState } from './sync-runtime-graph-test-harness'
import type { Tab, TabGroup } from '../../../shared/tab-types'

function apiClientTab(): Tab {
  return {
    id: 'api-tab',
    entityId: 'api-tab',
    groupId: 'group-1',
    worktreeId: 'wt-1',
    contentType: 'api-client',
    label: 'API Client',
    customLabel: null,
    color: null,
    sortOrder: 0,
    createdAt: 1
  }
}

describe('buildMobileSessionTabSnapshots with api-client tabs', () => {
  it('never publishes an api-client tab to paired clients', () => {
    const group: TabGroup = {
      id: 'group-1',
      worktreeId: 'wt-1',
      activeTabId: 'api-tab',
      tabOrder: ['api-tab']
    }
    const state = makeState({
      browserTabsByWorktree: {},
      unifiedTabsByWorktree: { 'wt-1': [apiClientTab()] },
      groupsByWorktree: { 'wt-1': [group] },
      activeGroupIdByWorktree: { 'wt-1': 'group-1' },
      activeTabType: 'api-client',
      activeTabTypeByWorktree: { 'wt-1': 'api-client' }
    })

    const snapshot = buildMobileSessionTabSnapshots(state)[0]

    expect(snapshot?.tabs ?? []).toEqual([])
    expect(JSON.stringify(snapshot ?? {})).not.toContain('api-tab')
    expect(snapshot?.activeTabType ?? null).toBeNull()
  })
})
