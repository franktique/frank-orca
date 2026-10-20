import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RuntimeClientEvent } from '../../shared/runtime-client-events'
import { ExplanationStore } from './explanation-store'
import { forwardExplanationStoreEvents } from './explanation-client-events'

describe('forwardExplanationStoreEvents', () => {
  const roots: string[] = []

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
  })

  it('emits explanationsChanged with the stored workspace and revision', async () => {
    const root = await mkdtemp(join(tmpdir(), 'explanation-events-'))
    roots.push(root)
    const store = new ExplanationStore(root)
    const emitted: RuntimeClientEvent[] = []
    const stop = forwardExplanationStoreEvents({ emit: (event) => emitted.push(event) }, store)
    try {
      await store.replace('wt-1', {
        id: 'set-1',
        workspaceId: 'wt-1',
        revision: 0,
        producer: { agentName: 'agent' },
        generatedAt: 0,
        changeSetBase: {
          kind: 'uncommitted-only',
          baseRef: null,
          mergeBase: 'b'.repeat(40),
          headOid: 'a'.repeat(40)
        },
        changes: [],
        questions: [],
        publishWarnings: []
      })
      expect(emitted).toEqual([{ type: 'explanationsChanged', workspaceId: 'wt-1', revision: 1 }])
      await store.replace('wt-1', {
        id: 'set-2',
        workspaceId: 'wt-1',
        revision: 1,
        producer: { agentName: 'agent' },
        generatedAt: 0,
        changeSetBase: {
          kind: 'uncommitted-only',
          baseRef: null,
          mergeBase: 'b'.repeat(40),
          headOid: 'a'.repeat(40)
        },
        changes: [],
        questions: [],
        publishWarnings: []
      })
      expect(emitted[1]).toEqual({ type: 'explanationsChanged', workspaceId: 'wt-1', revision: 2 })
    } finally {
      stop()
    }
  })

  it('stops forwarding after unsubscribe', async () => {
    const root = await mkdtemp(join(tmpdir(), 'explanation-events-'))
    roots.push(root)
    const store = new ExplanationStore(root)
    const emit = vi.fn()
    const stop = forwardExplanationStoreEvents({ emit }, store)
    stop()
    await store.replace('wt-1', {
      id: 'set-1',
      workspaceId: 'wt-1',
      revision: 0,
      producer: { agentName: 'agent' },
      generatedAt: 0,
      changeSetBase: {
        kind: 'uncommitted-only',
        baseRef: null,
        mergeBase: 'b'.repeat(40),
        headOid: 'a'.repeat(40)
      },
      changes: [],
      questions: [],
      publishWarnings: []
    })
    expect(emit).not.toHaveBeenCalled()
  })
})
