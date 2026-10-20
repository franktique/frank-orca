import { describe, expect, it } from 'vitest'
import type {
  ChangeSetFileStatus,
  ExplanationSet
} from '../../../../../shared/agent-explanations/explanation-types'
import {
  buildExplanationPanelModel,
  filterExplanationRowsByChange
} from './explanation-panel-model'

function file(path: string, position: number, status: ChangeSetFileStatus = 'modified') {
  return { path, status, position, items: [] }
}

const set: ExplanationSet = {
  id: 'e1',
  workspaceId: 'wt',
  revision: 1,
  producer: { agentName: 'claude' },
  generatedAt: 1,
  changeSetBase: { kind: 'uncommitted-only', baseRef: null, mergeBase: 'abc', headOid: null },
  changes: [
    { index: 0, title: 'A', summary: '', files: [file('src/a.ts', 1), file('src/shared.ts', 2)] },
    { index: 1, title: 'B', summary: '', files: [file('src/b.ts', 1), file('src/shared.ts', 2)] }
  ],
  questions: [],
  publishWarnings: []
}

const base = set.changeSetBase

describe('buildExplanationPanelModel', () => {
  it('orders explained rows by first label and gives a shared file every label', () => {
    const model = buildExplanationPanelModel(set, {
      status: 'ready',
      base,
      files: [
        { path: 'src/shared.ts', status: 'modified' },
        { path: 'src/b.ts', status: 'added' },
        { path: 'src/a.ts', status: 'modified' }
      ]
    })
    expect(model.explained.map((row) => [row.path, row.labels])).toEqual([
      ['src/a.ts', ['A1']],
      ['src/shared.ts', ['A2', 'B2']],
      ['src/b.ts', ['B1']]
    ])
    expect(model.explained.find((row) => row.path === 'src/b.ts')?.status).toBe('added')
  })

  it('lists files the agent did not explain under Unexplained, sorted by path', () => {
    const model = buildExplanationPanelModel(set, {
      status: 'ready',
      base,
      files: [
        { path: 'z.ts', status: 'modified' },
        { path: 'src/a.ts', status: 'modified' },
        { path: 'c.ts', oldPath: 'old.ts', status: 'renamed' }
      ]
    })
    expect(model.unexplained.map((row) => row.path)).toEqual(['c.ts', 'z.ts'])
    expect(model.unexplained[0]).toMatchObject({ oldPath: 'old.ts', explained: false, labels: [] })
  })

  it('flags explained files that are no longer in the change set', () => {
    const model = buildExplanationPanelModel(set, {
      status: 'ready',
      base,
      files: [{ path: 'src/a.ts', status: 'modified' }]
    })
    const flags = Object.fromEntries(model.explained.map((row) => [row.path, row.noLongerChanged]))
    expect(flags).toEqual({ 'src/a.ts': false, 'src/shared.ts': true, 'src/b.ts': true })
  })

  it('keeps the saved explanation readable without flags or an Unexplained group when unavailable', () => {
    const model = buildExplanationPanelModel(set, { status: 'unavailable' })
    expect(model.changeSetUnavailable).toBe(true)
    expect(model.unexplained).toEqual([])
    expect(model.explained.map((row) => row.noLongerChanged)).toEqual([false, false, false])
    expect(model.explained.map((row) => row.path)).toEqual([
      'src/a.ts',
      'src/shared.ts',
      'src/b.ts'
    ])
  })

  it('does not report unavailable while the change set has not loaded yet', () => {
    const model = buildExplanationPanelModel(set, { status: 'idle' })
    expect(model.changeSetUnavailable).toBe(false)
    expect(model.unexplained).toEqual([])
  })
})

describe('filterExplanationRowsByChange', () => {
  it("returns one change's files in label order with only that change's labels", () => {
    const model = buildExplanationPanelModel(set, { status: 'unavailable' })
    expect(
      filterExplanationRowsByChange(set, model, 1).map((row) => [row.path, row.labels])
    ).toEqual([
      ['src/b.ts', ['B1']],
      ['src/shared.ts', ['B2']]
    ])
    expect(filterExplanationRowsByChange(set, model, 9)).toEqual([])
  })
})
