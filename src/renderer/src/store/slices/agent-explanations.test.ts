// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExplanationSet } from '../../../../shared/agent-explanations/explanation-types'
import { createTestStore } from './store-test-helpers'

const api = { get: vi.fn(), changeSet: vi.fn() }

function setOf(id: string, revision: number): ExplanationSet {
  return {
    id,
    workspaceId: 'wt',
    revision,
    producer: { agentName: 'claude' },
    generatedAt: 1,
    changeSetBase: { kind: 'uncommitted-only', baseRef: null, mergeBase: 'abc', headOid: null },
    changes: [{ index: 0, title: 'T', summary: 'S', files: [] }],
    questions: [],
    publishWarnings: []
  }
}

beforeEach(() => {
  Object.values(api).forEach((fn) => fn.mockReset())
  Object.defineProperty(window, 'api', { configurable: true, value: { explanations: api } })
})

describe('agent explanations slice', () => {
  it('loads the explanation and exposes it per workspace', async () => {
    api.get.mockResolvedValue({ ok: true, explanation: setOf('e1', 1) })
    const store = createTestStore()
    await store.getState().loadExplanation('wt')
    expect(store.getState().explanationsByWorkspace.wt?.explanation?.id).toBe('e1')
    expect(store.getState().explanationsByWorkspace.wt?.revision).toBe(1)
  })

  it('refetches only when the pushed revision is newer', async () => {
    api.get.mockResolvedValue({ ok: true, explanation: setOf('e1', 2) })
    const store = createTestStore()
    await store.getState().loadExplanation('wt')
    api.get.mockClear()

    await store.getState().applyExplanationsChanged({ workspaceId: 'wt', revision: 2 })
    expect(api.get).not.toHaveBeenCalled()

    api.get.mockResolvedValue({ ok: true, explanation: setOf('e2', 3) })
    await store.getState().applyExplanationsChanged({ workspaceId: 'wt', revision: 3 })
    expect(api.get).toHaveBeenCalledTimes(1)
    expect(store.getState().explanationsByWorkspace.wt?.explanation?.id).toBe('e2')
  })

  it('remembers a clear revision and resets focus when the set is replaced', async () => {
    api.get.mockResolvedValue({ ok: true, explanation: setOf('e1', 1) })
    const store = createTestStore()
    await store.getState().loadExplanation('wt')
    store.getState().setFocusedExplanationChange('wt', 0)
    store.getState().setActiveExplanationItem('wt', 'item-1')

    api.get.mockResolvedValue({ ok: true, explanation: null })
    await store.getState().applyExplanationsChanged({ workspaceId: 'wt', revision: 2 })
    const state = store.getState().explanationsByWorkspace.wt
    expect(state?.explanation).toBeNull()
    expect(state?.revision).toBe(2)
    expect(state?.focusedChangeIndex).toBeNull()
    expect(state?.activeItemId).toBeNull()

    api.get.mockClear()
    await store.getState().applyExplanationsChanged({ workspaceId: 'wt', revision: 2 })
    expect(api.get).not.toHaveBeenCalled()
  })

  it('keeps the last explanation when the host cannot be reached', async () => {
    api.get.mockResolvedValue({ ok: true, explanation: setOf('e1', 1) })
    const store = createTestStore()
    await store.getState().loadExplanation('wt')
    api.get.mockRejectedValue(new Error('disconnected'))
    await store.getState().loadExplanation('wt')
    expect(store.getState().explanationsByWorkspace.wt?.explanation?.id).toBe('e1')
  })

  it('marks the change set unavailable when it cannot be read', async () => {
    const store = createTestStore()
    api.changeSet.mockRejectedValue(new Error('disconnected'))
    await store.getState().loadExplanationChangeSet('wt')
    expect(store.getState().explanationsByWorkspace.wt?.changeSet).toEqual({
      status: 'unavailable'
    })

    api.changeSet.mockResolvedValue({
      ok: true,
      base: { kind: 'uncommitted-only', baseRef: null, mergeBase: 'abc', headOid: null },
      files: [{ path: 'a.ts', status: 'modified' }]
    })
    await store.getState().loadExplanationChangeSet('wt')
    expect(store.getState().explanationsByWorkspace.wt?.changeSet.status).toBe('ready')
  })
})

describe('stepExplanationItem', () => {
  function itemOf(id: string, position: number) {
    return {
      id,
      position,
      anchor: { fileLevel: true as const },
      text: id
    }
  }
  // Two changes over three files: A covers a.ts + b.ts, B covers b.ts again.
  const walkthrough: ExplanationSet = {
    ...setOf('walk', 1),
    changes: [
      {
        index: 0,
        title: 'A',
        summary: '',
        files: [
          {
            path: 'a.ts',
            status: 'modified',
            position: 1,
            items: [itemOf('i1', 1), itemOf('i2', 2)]
          },
          { path: 'b.ts', status: 'modified', position: 2, items: [itemOf('i3', 1)] }
        ]
      },
      {
        index: 1,
        title: 'B',
        summary: '',
        files: [{ path: 'b.ts', status: 'modified', position: 1, items: [itemOf('i4', 1)] }]
      }
    ]
  }

  async function storeWithWalkthrough() {
    api.get.mockResolvedValue({ ok: true, explanation: walkthrough })
    const store = createTestStore()
    await store.getState().loadExplanation('wt')
    const opened: unknown[][] = []
    store.setState({
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: test double only needs the members the code under test reads.
      getKnownWorktreeById: () => ({ path: '/repo' }) as never,
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: test double only needs the members the code under test reads.
      openExplanationDiff: ((...args: unknown[]) => void opened.push(args)) as never
    })
    return { store, opened }
  }

  it('walks every item across files and changes in order, then stops at the ends', async () => {
    const { store, opened } = await storeWithWalkthrough()
    const active = (): string | null =>
      store.getState().explanationsByWorkspace.wt?.activeItemId ?? null

    const seen: (string | null)[] = []
    for (let i = 0; i < 6; i++) {
      store.getState().stepExplanationItem('wt', 1)
      seen.push(active())
    }
    expect(seen).toEqual(['i1', 'i2', 'i3', 'i4', 'i4', 'i4'])
    // Opens a file whenever the item is not in the open explanation diff.
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: test double only needs the members the code under test reads.
    expect(opened.map((args) => (args[3] as { focusItemId: string }).focusItemId)).toEqual([
      'i1',
      'i2',
      'i3',
      'i4'
    ])

    store.getState().stepExplanationItem('wt', -1)
    expect(active()).toBe('i3')
  })

  it('starts from the last item when stepping back with nothing open', async () => {
    const { store } = await storeWithWalkthrough()
    store.getState().stepExplanationItem('wt', -1)
    expect(store.getState().explanationsByWorkspace.wt?.activeItemId).toBe('i4')
  })
})
