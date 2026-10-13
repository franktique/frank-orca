// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  ApiClientPersistedTab,
  ApiRequest,
  Collection,
  LatestResult,
  WorktreeApiData
} from '../../../../shared/api-client/api-client-types'
import { selectViewedRequest } from './api-client-execution'
import { createTestStore } from './store-test-helpers'

function request(name: string, revision: number): ApiRequest {
  return {
    id: 'r1',
    kind: 'request',
    name,
    method: 'GET',
    url: { raw: 'http://x', query: [] },
    pathVariables: [],
    headers: [],
    events: {},
    settings: {},
    revision,
    postmanExtra: {}
  }
}

function snapshot(
  worktreeId: string,
  requestName: string,
  revision: number,
  rev: number
): WorktreeApiData {
  const collection: Collection = {
    id: 'c1',
    name: 'c',
    variables: [],
    events: {},
    items: [request(requestName, revision)],
    revision: 0,
    postmanExtra: {},
    importWarnings: []
  }
  return {
    worktreeId,
    schemaVersion: 1,
    collections: [collection],
    environments: [],
    activeEnvironmentId: null,
    revision: rev
  }
}

function result(requestId: string, status: number): LatestResult {
  return {
    requestId,
    origin: 'manual',
    startedAt: 1,
    durationMs: 1,
    ttfbMs: 1,
    resolvedRequest: { method: 'GET', url: 'http://x', headers: [], body: null },
    outcome: {
      kind: 'response',
      response: {
        status,
        statusText: '',
        headers: [],
        sizeBytes: 0,
        contentType: null,
        body: { encoding: 'utf8', text: '', truncated: false },
        redirects: []
      }
    },
    tests: [],
    scriptLogs: [],
    environmentId: null
  }
}

const api = {
  getSnapshot: vi.fn(),
  saveRequest: vi.fn(),
  setActiveEnvironment: vi.fn(),
  send: vi.fn(),
  getLatestResult: vi.fn()
}

beforeEach(() => {
  Object.values(api).forEach((fn) => fn.mockReset())
  Object.defineProperty(window, 'api', { configurable: true, value: { apiClient: api } })
})

async function twoTabs() {
  const store = createTestStore()
  const state = store.getState()
  api.getSnapshot.mockResolvedValue({ ok: true, data: snapshot('wt', 'Original', 0, 1) })
  await state.loadApiClientSnapshot('wt')
  for (const tabId of ['tab-a', 'tab-b']) {
    state.ensureApiClientTabState(tabId, 'wt')
    state.setApiClientTabView(tabId, { kind: 'request', requestId: 'r1' })
  }
  return store
}

describe('API Client store — several tabs on one worktree', () => {
  it('shows a saved change in every tab that has no draft', async () => {
    const store = await twoTabs()
    api.getSnapshot.mockResolvedValue({ ok: true, data: snapshot('wt', 'Renamed', 1, 2) })
    await store
      .getState()
      .applyApiClientChanged({ worktreeId: 'wt', revision: 2, kind: 'collection', id: 'c1' })
    for (const tabId of ['tab-a', 'tab-b']) {
      expect(selectViewedRequest(store.getState(), tabId)?.name).toBe('Renamed')
    }
  })

  it('keeps a tab’s draft and flags it when the saved request changed elsewhere', async () => {
    const store = await twoTabs()
    store.getState().editApiClientRequest('tab-a', request('My edit', 0))
    api.getSnapshot.mockResolvedValue({ ok: true, data: snapshot('wt', 'Renamed', 1, 2) })
    await store
      .getState()
      .applyApiClientChanged({ worktreeId: 'wt', revision: 2, kind: 'collection', id: 'c1' })

    const draft = store.getState().apiClientDraftsByTab['tab-a']
    expect(draft?.kind === 'request' && draft.request.name).toBe('My edit')
    expect(draft?.changedElsewhere).toBe(true)
    expect(store.getState().apiClientDraftsByTab['tab-b']).toBeUndefined()
  })

  it('reports a conflict on save, and Reload replaces the draft with the saved copy', async () => {
    const store = await twoTabs()
    store.getState().editApiClientRequest('tab-a', request('My edit', 0))
    api.getSnapshot.mockResolvedValue({ ok: true, data: snapshot('wt', 'Renamed', 1, 2) })
    await store
      .getState()
      .applyApiClientChanged({ worktreeId: 'wt', revision: 2, kind: 'collection', id: 'c1' })
    api.saveRequest.mockResolvedValue({ ok: false, code: 'conflict', message: 'stale' })

    expect(await store.getState().saveApiClientDraft('tab-a')).toBe(false)
    expect(store.getState().apiClientDraftsByTab['tab-a']?.conflict).toBe(true)

    store.getState().reloadApiClientDraft('tab-a')
    expect(store.getState().apiClientDraftsByTab['tab-a']).toBeUndefined()
    expect(selectViewedRequest(store.getState(), 'tab-a')?.name).toBe('Renamed')
  })

  it('drops a draft that matches the saved copy again', async () => {
    const store = await twoTabs()
    store.getState().editApiClientRequest('tab-a', request('Changed', 0))
    expect(store.getState().apiClientDraftsByTab['tab-a']).toBeDefined()
    store.getState().editApiClientRequest('tab-a', request('Original', 0))
    expect(store.getState().apiClientDraftsByTab['tab-a']).toBeUndefined()
  })

  it('parks a view switch while a draft exists and applies it after Discard', async () => {
    const store = await twoTabs()
    store.getState().editApiClientRequest('tab-a', request('Changed', 0))
    store.getState().requestApiClientTabView('tab-a', { kind: 'empty' })
    expect(store.getState().apiClientTabsById['tab-a']?.view.kind).toBe('request')
    expect(store.getState().apiClientPendingViewByTab['tab-a']).toEqual({ kind: 'empty' })

    await store.getState().confirmApiClientPendingView('tab-a', false)
    expect(store.getState().apiClientTabsById['tab-a']?.view.kind).toBe('empty')
    expect(store.getState().apiClientDraftsByTab['tab-a']).toBeUndefined()
  })

  it('updates the environment selector of every tab when one tab changes it', async () => {
    const store = await twoTabs()
    api.setActiveEnvironment.mockResolvedValue({ ok: true })
    await store.getState().setApiClientActiveEnvironment('wt', 'env-1')
    expect(store.getState().apiClientSnapshotsByWorktree.wt?.activeEnvironmentId).toBe('env-1')
    expect(api.setActiveEnvironment).toHaveBeenCalledWith({
      worktreeId: 'wt',
      environmentId: 'env-1'
    })
  })

  it('shares a finished execution with every tab showing that request', async () => {
    const store = await twoTabs()
    api.send.mockResolvedValue({ ok: true, executionId: 'exec-1' })
    await store.getState().sendApiClientRequest('tab-a')
    expect(store.getState().apiClientExecutionsByTab['tab-a']?.executionId).toBe('exec-1')

    store.getState().applyApiClientExecutionFinished({
      worktreeId: 'wt',
      executionId: 'exec-1',
      requestId: 'r1',
      result: result('r1', 201)
    })
    expect(store.getState().apiClientExecutionsByTab['tab-a']).toBeUndefined()
    const shown = store.getState().apiClientResultsByWorktree.wt?.r1
    expect(shown?.outcome.kind === 'response' && shown.outcome.response.status).toBe(201)
  })

  it.each(['run', 'agent'] as const)(
    'shows a %s-origin result in a tab already displaying the request',
    async (origin) => {
      const store = await twoTabs()
      store.getState().applyApiClientExecutionFinished({
        worktreeId: 'wt',
        executionId: 'unrelated',
        requestId: 'r1',
        result: { ...result('r1', 202), origin }
      })
      const shown = store.getState().apiClientResultsByWorktree.wt?.r1
      expect(shown?.origin).toBe(origin)
      expect(shown?.outcome.kind === 'response' && shown.outcome.response.status).toBe(202)
    }
  )

  it('ignores change events for a worktree no tab shows', async () => {
    const store = await twoTabs()
    api.getSnapshot.mockClear()
    await store
      .getState()
      .applyApiClientChanged({ worktreeId: 'other', revision: 5, kind: 'collection' })
    expect(api.getSnapshot).not.toHaveBeenCalled()
    expect(store.getState().apiClientSnapshotsByWorktree.other).toBeUndefined()
  })
})

describe('API Client store — session persistence of a tab', () => {
  function seedTab(
    store: ReturnType<typeof createTestStore>,
    apiClient?: ApiClientPersistedTab
  ): void {
    store.setState({
      unifiedTabsByWorktree: {
        wt: [
          {
            id: 'tab-a',
            entityId: 'tab-a',
            groupId: 'g1',
            worktreeId: 'wt',
            contentType: 'api-client',
            label: 'API Client',
            customLabel: null,
            color: null,
            sortOrder: 0,
            createdAt: 1,
            ...(apiClient ? { apiClient } : {})
          }
        ]
      }
    })
  }

  it('writes the view and layout onto the unified tab, which the session saves', () => {
    const store = createTestStore()
    seedTab(store)
    store.getState().ensureApiClientTabState('tab-a', 'wt')
    store.getState().setApiClientTabView('tab-a', { kind: 'request', requestId: 'r1' })
    store.getState().setApiClientTabLayout('tab-a', { consoleCollapsed: true, splitRatio: 0.3 })
    expect(store.getState().unifiedTabsByWorktree.wt[0].apiClient).toMatchObject({
      view: { kind: 'request', requestId: 'r1' },
      consoleCollapsed: true,
      splitRatio: 0.3
    })
  })

  it('restores the open request and layout from the saved tab', () => {
    const store = createTestStore()
    seedTab(store, { view: { kind: 'request', requestId: 'r1' }, consoleHeight: 321 })
    const restored = store.getState().ensureApiClientTabState('tab-a', 'wt')
    expect(restored.view).toEqual({ kind: 'request', requestId: 'r1' })
    expect(restored.consoleHeight).toBe(321)
  })

  it('falls back to the empty view when the restored request no longer exists', async () => {
    const store = createTestStore()
    seedTab(store, { view: { kind: 'request', requestId: 'deleted' } })
    store.getState().ensureApiClientTabState('tab-a', 'wt')
    api.getSnapshot.mockResolvedValue({ ok: true, data: snapshot('wt', 'Original', 0, 1) })
    await store.getState().loadApiClientSnapshot('wt')
    expect(store.getState().apiClientTabsById['tab-a']?.view).toEqual({ kind: 'empty' })
    expect(store.getState().unifiedTabsByWorktree.wt[0].apiClient?.view).toEqual({ kind: 'empty' })
  })

  it('keeps a restored request that still exists', async () => {
    const store = createTestStore()
    seedTab(store, { view: { kind: 'request', requestId: 'r1' } })
    store.getState().ensureApiClientTabState('tab-a', 'wt')
    api.getSnapshot.mockResolvedValue({ ok: true, data: snapshot('wt', 'Original', 0, 1) })
    await store.getState().loadApiClientSnapshot('wt')
    expect(store.getState().apiClientTabsById['tab-a']?.view).toEqual({
      kind: 'request',
      requestId: 'r1'
    })
  })
})
