import { describe, expect, it } from 'vitest'
import { parseWorkspaceSession } from './workspace-session-schema'

function tab(id: string, contentType: string): Record<string, unknown> {
  return {
    id,
    entityId: id,
    groupId: 'group-1',
    worktreeId: 'wt',
    contentType,
    label: id,
    customLabel: null,
    color: null,
    sortOrder: 0,
    createdAt: 1
  }
}

function session(tabs: Record<string, unknown>[]): Record<string, unknown> {
  return {
    activeRepoId: null,
    activeWorktreeId: null,
    activeTabId: null,
    tabsByWorktree: {},
    terminalLayoutsByTabId: {},
    unifiedTabs: { wt: tabs }
  }
}

describe('workspace session tab content types', () => {
  it('round-trips an api-client tab', () => {
    const result = parseWorkspaceSession(session([tab('a', 'api-client')]))
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.unifiedTabs?.wt.map((t) => t.contentType)).toEqual(['api-client'])
    }
  })

  it('round-trips a sql tab with its persisted draft', () => {
    const sqlTab = {
      ...tab('s', 'sql'),
      sql: {
        draftText: 'select 1',
        connectionId: 'c1',
        savedQueryId: null,
        savedQueryRevision: null,
        splitRatio: 0.4
      }
    }
    const result = parseWorkspaceSession(session([sqlTab]))
    expect(result.ok).toBe(true)
    if (result.ok) {
      const parsed = result.value.unifiedTabs?.wt[0]
      expect(parsed?.contentType).toBe('sql')
      expect(parsed?.sql).toMatchObject({
        draftText: 'select 1',
        connectionId: 'c1',
        splitRatio: 0.4
      })
    }
  })

  it('drops a corrupt sql payload but keeps the tab', () => {
    const result = parseWorkspaceSession(session([{ ...tab('s', 'sql'), sql: { splitRatio: 9 } }]))
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.unifiedTabs?.wt[0]?.sql).toBeUndefined()
    }
  })

  it('drops a tab with an unknown content type without failing the session', () => {
    const result = parseWorkspaceSession(
      session([tab('a', 'terminal'), tab('b', 'future-tab-kind'), tab('c', 'api-client')])
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.unifiedTabs?.wt.map((t) => t.id)).toEqual(['a', 'c'])
    }
  })
})

describe('workspace session API Client tab state', () => {
  it('round-trips the open request and layout of an api-client tab', () => {
    const tabWithState = {
      ...tab('a', 'api-client'),
      apiClient: {
        view: { kind: 'request', requestId: 'r1' },
        consoleCollapsed: true,
        consoleHeight: 240,
        splitRatio: 0.4
      }
    }
    const result = parseWorkspaceSession(session([tabWithState]))
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.unifiedTabs?.wt[0].apiClient).toEqual(tabWithState.apiClient)
    }
  })

  it('drops a corrupt API Client view without losing the tab', () => {
    const result = parseWorkspaceSession(
      session([{ ...tab('a', 'api-client'), apiClient: { view: { kind: 'nonsense' } } }])
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.unifiedTabs?.wt).toHaveLength(1)
      expect(result.value.unifiedTabs?.wt[0].apiClient).toBeUndefined()
    }
  })
})
