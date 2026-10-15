import { describe, expect, it } from 'vitest'
import { buildMobileSessionTabSnapshots } from './sync-runtime-graph'
import { makeState } from './sync-runtime-graph-test-harness'
import type { Tab, TabGroup } from '../../../shared/tab-types'

function sqlTab(): Tab {
  return {
    id: 'sql-tab',
    entityId: 'sql-tab',
    groupId: 'group-1',
    worktreeId: 'wt-1',
    contentType: 'sql',
    label: 'SQL',
    customLabel: null,
    color: null,
    sortOrder: 0,
    createdAt: 1,
    sql: {
      draftText: 'select secret_column from t',
      connectionId: null,
      savedQueryId: null,
      savedQueryRevision: null,
      splitRatio: 0.5
    }
  }
}

describe('buildMobileSessionTabSnapshots with sql tabs', () => {
  it('never publishes a sql tab or its draft to paired clients', () => {
    const group: TabGroup = {
      id: 'group-1',
      worktreeId: 'wt-1',
      activeTabId: 'sql-tab',
      tabOrder: ['sql-tab']
    }
    const state = makeState({
      browserTabsByWorktree: {},
      unifiedTabsByWorktree: { 'wt-1': [sqlTab()] },
      groupsByWorktree: { 'wt-1': [group] },
      activeGroupIdByWorktree: { 'wt-1': 'group-1' },
      activeTabType: 'sql',
      activeTabTypeByWorktree: { 'wt-1': 'sql' }
    })

    const snapshot = buildMobileSessionTabSnapshots(state)[0]

    expect(snapshot?.tabs ?? []).toEqual([])
    expect(JSON.stringify(snapshot ?? {})).not.toContain('sql-tab')
    expect(JSON.stringify(snapshot ?? {})).not.toContain('secret_column')
    expect(snapshot?.activeTabType ?? null).toBeNull()
  })
})
