import { describe, expect, it } from 'vitest'
import type { ApiFolder, ApiRequest, Collection } from '../api-client/api-client-types'
import { buildPlanSteps } from './plan-steps'
import type { TestMap, TestMapEntry } from './test-orchestrator-types'

function request(id: string, url = 'http://x', extra: Partial<ApiRequest> = {}): ApiRequest {
  return {
    id,
    kind: 'request',
    name: `Req ${id}`,
    method: 'GET',
    url: { raw: url, query: [] },
    pathVariables: [],
    headers: [],
    events: {},
    settings: {},
    revision: 0,
    postmanExtra: {},
    ...extra
  }
}

function folder(name: string, items: (ApiFolder | ApiRequest)[]): ApiFolder {
  return {
    id: `f-${name}`,
    kind: 'folder',
    name,
    variables: [],
    events: {},
    items,
    postmanExtra: {}
  }
}

function collection(items: (ApiFolder | ApiRequest)[]): Collection {
  return {
    id: 'c',
    name: 'c',
    variables: [],
    events: {},
    items,
    revision: 0,
    postmanExtra: {},
    importWarnings: []
  }
}

function entry(requestId: string, overrides: Partial<TestMapEntry> = {}): TestMapEntry {
  return {
    ref: { id: requestId },
    link: { state: 'linked', requestId },
    before: [],
    after: [],
    ...overrides
  }
}

function testMap(entries: TestMapEntry[]): TestMap {
  return { orcaTestMap: 1, collectionId: 'c', entries, loadedAt: 0 }
}

describe('buildPlanSteps', () => {
  it('orders by phase then collection order, with default ids and titles', () => {
    const steps = buildPlanSteps({
      collection: collection([
        folder('Cleanup', [request('d')]),
        folder('02 - Scenarios', [request('s1'), request('s2')]),
        folder('Setup', [request('u')]),
        request('loose')
      ]),
      testMap: null
    })
    expect(steps.map((s) => [s.stepId, s.phase, s.requests[0].requestId])).toEqual([
      ['S-1', 'setup', 'u'],
      ['SC-1', 'scenario', 's1'],
      ['SC-2', 'scenario', 's2'],
      ['SC-3', 'scenario', 'loose'],
      ['C-1', 'cleanup', 'd']
    ])
    expect(steps.map((s) => s.index)).toEqual([0, 1, 2, 3, 4])
    expect(steps[0].title).toBe('Req u')
    expect(steps[0].entry).toBeNull()
  })

  it('lets the test map override phase, id, and title', () => {
    const steps = buildPlanSteps({
      collection: collection([folder('Scenarios', [request('a'), request('b')])]),
      testMap: testMap([entry('b', { phase: 'preflight', stepId: 'PF', title: 'Health' })])
    })
    expect(steps.map((s) => [s.stepId, s.title])).toEqual([
      ['PF', 'Health'],
      ['SC-1', 'Req a']
    ])
  })

  it('collapses a concurrent group into one step at the first member', () => {
    const steps = buildPlanSteps({
      collection: collection([request('a'), request('b'), request('c')]),
      testMap: testMap([
        entry('a', { concurrentGroup: 'race' }),
        entry('c', { concurrentGroup: 'race' })
      ])
    })
    expect(steps).toHaveLength(2)
    expect(steps[0].requests.map((r) => r.requestId)).toEqual(['a', 'c'])
    expect(steps[0].title).toBe('race')
    expect(steps[1].requests[0].requestId).toBe('b')
  })

  it('never reorders for dependsOn', () => {
    const steps = buildPlanSteps({
      collection: collection([request('a'), request('b')]),
      testMap: testMap([entry('a', { dependsOn: ['SC-2'] })])
    })
    expect(steps.map((s) => s.requests[0].requestId)).toEqual(['a', 'b'])
  })

  it('lists variables captured by earlier steps as required', () => {
    const steps = buildPlanSteps({
      collection: collection([
        folder('Setup', [request('create')]),
        folder('Scenarios', [request('read', 'http://x/{{orderId}}/{{baseUrl}}')]),
        folder('Cleanup', [request('del')])
      ]),
      testMap: testMap([
        entry('create', { captures: [{ variable: 'orderId', from: 'body.id' }] }),
        entry('del', {
          forEach: 'orderId',
          after: [{ id: 'q', sql: 'select {{orderId}}', precondition: false, changesData: false }]
        })
      ])
    })
    expect(steps.map((s) => s.requiredVariables)).toEqual([[], ['orderId'], ['orderId']])
  })

  it('treats script-set variables as captured and flags approvals', () => {
    const steps = buildPlanSteps({
      collection: collection([
        request('a', 'http://x', {
          events: { test: { exec: ["pm.collectionVariables.set('token', 'x')"] } }
        }),
        request('b', 'http://x/{{token}}')
      ]),
      testMap: null,
      approvedStepIds: new Set(['SC-2'])
    })
    expect(steps[1].requiredVariables).toEqual(['token'])
    expect(steps.map((s) => s.approvedDataChange)).toEqual([false, true])
  })

  it('snapshots scope without items', () => {
    const [step] = buildPlanSteps({
      collection: collection([folder('Setup', [request('a')])]),
      testMap: null
    })
    expect(step.requests[0].scope.collection.items).toEqual([])
    expect(step.requests[0].scope.folders.map((f) => f.name)).toEqual(['Setup'])
  })
})
