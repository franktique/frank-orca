import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ExplanationSet } from '../../shared/agent-explanations/explanation-types'
import { ExplanationStore } from './explanation-store'

const tempRoots: string[] = []

function createTempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'explanation-store-'))
  tempRoots.push(root)
  return root
}

afterEach(() => {
  while (tempRoots.length > 0) {
    rmSync(tempRoots.pop()!, { recursive: true, force: true })
  }
})

const WORKSPACE_ID = 'wt-explanation-store-test'

function makeSet(workspaceId: string, revision = 1): ExplanationSet {
  return {
    id: `expl-${revision}`,
    workspaceId,
    revision,
    producer: { agentName: 'claude' },
    generatedAt: 1_000,
    changeSetBase: {
      kind: 'uncommitted-only',
      baseRef: null,
      mergeBase: 'a'.repeat(40),
      headOid: null
    },
    changes: [
      {
        index: 0,
        title: 'First change',
        summary: '',
        files: [
          {
            path: 'src/a.ts',
            status: 'modified',
            position: 1,
            items: [
              {
                id: 'item-1',
                position: 1,
                anchor: { fileLevel: true },
                text: 'Why this changed'
              }
            ]
          }
        ]
      }
    ],
    questions: [],
    publishWarnings: []
  }
}

describe('ExplanationStore', () => {
  it('increments revision on every write', async () => {
    const store = new ExplanationStore(createTempRoot())

    const first = await store.replace(WORKSPACE_ID, makeSet(WORKSPACE_ID))
    const second = await store.replace(WORKSPACE_ID, makeSet(WORKSPACE_ID, 99))

    expect(first).toEqual({ replacedPrevious: false, revision: 1 })
    expect(second).toEqual({ replacedPrevious: true, revision: 2 })
    expect((await store.get(WORKSPACE_ID))?.revision).toBe(2)
  })

  it('serializes concurrent writes so the later one wins', async () => {
    const store = new ExplanationStore(createTempRoot())

    const [slow, fast] = await Promise.all([
      store.replace(WORKSPACE_ID, makeSet(WORKSPACE_ID, 1)),
      store.replace(WORKSPACE_ID, makeSet(WORKSPACE_ID, 2))
    ])

    expect(slow.revision).toBe(1)
    expect(fast.revision).toBe(2)
    expect(fast.replacedPrevious).toBe(true)
    const stored = await store.get(WORKSPACE_ID)
    expect(stored?.id).toBe('expl-2')
    expect(stored?.revision).toBe(2)
  })

  it('emits one change event per write', async () => {
    const store = new ExplanationStore(createTempRoot())
    const listener = vi.fn()
    store.subscribe(listener)

    await store.replace(WORKSPACE_ID, makeSet(WORKSPACE_ID))
    await store.replace(WORKSPACE_ID, makeSet(WORKSPACE_ID))

    expect(listener.mock.calls).toEqual([
      [{ workspaceId: WORKSPACE_ID, revision: 1 }],
      [{ workspaceId: WORKSPACE_ID, revision: 2 }]
    ])
  })

  it('quarantines a corrupt file into corrupt/ and reads as null', async () => {
    const root = createTempRoot()
    const { hashWorktreeId } = await import('../terminal-history-id')
    const hash = hashWorktreeId(WORKSPACE_ID)
    writeFileSync(join(root, `${hash}.json`), '{ not json')
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const store = new ExplanationStore(root)

    expect(await store.get(WORKSPACE_ID)).toBeNull()
    const quarantined = readdirSync(join(root, 'corrupt'))
    expect(quarantined).toHaveLength(1)
    expect(quarantined[0].startsWith(`${hash}-`)).toBe(true)
    errorSpy.mockRestore()
  })

  it('leaves a future schemaVersion in place and reads it as null', async () => {
    const root = createTempRoot()
    const { hashWorktreeId } = await import('../terminal-history-id')
    const file = join(root, `${hashWorktreeId(WORKSPACE_ID)}.json`)
    const future = JSON.stringify({ schemaVersion: 2, workspaceId: WORKSPACE_ID, explanation: {} })
    writeFileSync(file, future)
    const store = new ExplanationStore(root)

    expect(await store.get(WORKSPACE_ID)).toBeNull()
    expect(readFileSync(file, 'utf-8')).toBe(future)
  })
})

describe('ExplanationStore questions', () => {
  async function seeded() {
    const store = new ExplanationStore(createTempRoot())
    await store.replace(WORKSPACE_ID, makeSet(WORKSPACE_ID))
    const set = (await store.get(WORKSPACE_ID))!
    return { store, set }
  }

  it('adds a draft question and bumps the revision', async () => {
    const { store, set } = await seeded()
    const result = await store.upsertQuestion(WORKSPACE_ID, set.id, {
      itemId: 'item-1',
      body: 'Why?'
    })
    expect(result).toMatchObject({ ok: true, question: { state: 'draft', body: 'Why?' } })
    const after = await store.get(WORKSPACE_ID)
    expect(after?.revision).toBe(set.revision + 1)
    expect(after?.questions).toHaveLength(1)
  })

  it('edits a draft in place', async () => {
    const { store, set } = await seeded()
    const created = await store.upsertQuestion(WORKSPACE_ID, set.id, {
      itemId: 'item-1',
      body: 'a'
    })
    if (!created.ok) {
      throw new Error('expected ok')
    }
    await store.upsertQuestion(WORKSPACE_ID, set.id, {
      id: created.question.id,
      itemId: 'item-1',
      body: 'b'
    })
    expect((await store.get(WORKSPACE_ID))?.questions.map((q) => q.body)).toEqual(['b'])
  })

  it('rejects a stale explanation id and an unknown item', async () => {
    const { store, set } = await seeded()
    expect(
      await store.upsertQuestion(WORKSPACE_ID, 'old-id', { itemId: 'item-1', body: 'x' })
    ).toMatchObject({ ok: false, code: 'stale_explanation' })
    expect(
      await store.upsertQuestion(WORKSPACE_ID, set.id, { itemId: 'nope', body: 'x' })
    ).toMatchObject({ ok: false, code: 'invalid_params' })
    expect(await store.deleteQuestion(WORKSPACE_ID, 'old-id', 'q')).toMatchObject({
      ok: false,
      code: 'stale_explanation'
    })
  })

  it('caps a set at 200 questions', async () => {
    const { store, set } = await seeded()
    for (let i = 0; i < 200; i++) {
      await store.upsertQuestion(WORKSPACE_ID, set.id, { itemId: 'item-1', body: `q${i}` })
    }
    expect(
      await store.upsertQuestion(WORKSPACE_ID, set.id, { itemId: 'item-1', body: 'one too many' })
    ).toMatchObject({ ok: false, code: 'invalid_params' })
  })

  it('marks a question sent, and editing it afterwards drafts a new one', async () => {
    const { store, set } = await seeded()
    const created = await store.upsertQuestion(WORKSPACE_ID, set.id, {
      itemId: 'item-1',
      body: 'a'
    })
    if (!created.ok) {
      throw new Error('expected ok')
    }
    await store.markQuestionsSent(WORKSPACE_ID, set.id, [created.question.id], {
      paneKey: 'tab:1',
      label: 'Claude'
    })
    const sent = (await store.get(WORKSPACE_ID))!.questions[0]
    expect(sent).toMatchObject({ state: 'sent', sentTo: { label: 'Claude' } })
    expect(sent.sentAt).toBeTypeOf('number')

    await store.upsertQuestion(WORKSPACE_ID, set.id, {
      id: created.question.id,
      itemId: 'item-1',
      body: 'a, but sharper'
    })
    const questions = (await store.get(WORKSPACE_ID))!.questions
    expect(questions.map((q) => [q.body, q.state])).toEqual([
      ['a', 'sent'],
      ['a, but sharper', 'draft']
    ])
  })

  it('deletes a question in either state', async () => {
    const { store, set } = await seeded()
    const created = await store.upsertQuestion(WORKSPACE_ID, set.id, {
      itemId: 'item-1',
      body: 'a'
    })
    if (!created.ok) {
      throw new Error('expected ok')
    }
    await store.deleteQuestion(WORKSPACE_ID, set.id, created.question.id)
    expect((await store.get(WORKSPACE_ID))?.questions).toEqual([])
  })
})

describe('ExplanationStore clear', () => {
  it('removes the explanation, emits a newer revision, and keeps later publishes ahead of it', async () => {
    const store = new ExplanationStore(createTempRoot())
    const events: number[] = []
    store.subscribe((event) => events.push(event.revision))
    await store.replace(WORKSPACE_ID, makeSet(WORKSPACE_ID))

    expect(await store.clear(WORKSPACE_ID)).toEqual({ ok: true, cleared: true })
    expect(await store.get(WORKSPACE_ID)).toBeNull()
    expect(events).toEqual([1, 2])

    const republished = await store.replace(WORKSPACE_ID, makeSet(WORKSPACE_ID))
    expect(republished.revision).toBe(3)
  })

  it('only clears the set it was asked about', async () => {
    const store = new ExplanationStore(createTempRoot())
    await store.replace(WORKSPACE_ID, makeSet(WORKSPACE_ID))
    const current = (await store.get(WORKSPACE_ID))!
    expect(await store.clear(WORKSPACE_ID, 'a-newer-set')).toEqual({ ok: true, cleared: false })
    expect((await store.get(WORKSPACE_ID))?.id).toBe(current.id)
    expect(await store.clear(WORKSPACE_ID, current.id)).toEqual({ ok: true, cleared: true })
    expect(await store.clear(WORKSPACE_ID)).toEqual({ ok: true, cleared: false })
  })
})
