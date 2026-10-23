import { describe, expect, it } from 'vitest'
import type { ApiRequest, Collection } from '../api-client/api-client-types'
import { isHostAllowed, resolvePlanTargetHosts } from './plan-target-hosts'
import type { TestPlanStep } from './test-orchestrator-types'

function step(url: string, requiredVariables: string[] = []): TestPlanStep {
  const snapshot: ApiRequest = {
    id: url,
    kind: 'request',
    name: url,
    method: 'GET',
    url: { raw: url, query: [] },
    pathVariables: [],
    headers: [],
    events: {},
    settings: {},
    revision: 0,
    postmanExtra: {}
  }
  const collection: Collection = {
    id: 'c',
    name: 'c',
    variables: [],
    events: {},
    items: [],
    revision: 0,
    postmanExtra: {},
    importWarnings: []
  }
  return {
    index: 0,
    stepId: 'S-1',
    title: url,
    phase: 'scenario',
    requests: [{ requestId: url, snapshot, scope: { collection, folders: [] } }],
    entry: null,
    requiredVariables,
    approvedDataChange: false
  }
}

const baseEnv = [{ key: 'baseUrl', value: '', enabled: true, type: 'default' as const }]

describe('resolvePlanTargetHosts', () => {
  it('resolves hosts from inputs and tags local ones', () => {
    const result = resolvePlanTargetHosts({
      steps: [step('{{baseUrl}}/a'), step('https://api.example.com/b')],
      environment: baseEnv,
      inputs: { baseUrl: 'http://localhost:3000' }
    })
    expect(result.hosts).toEqual([
      { host: 'localhost', local: true },
      { host: 'api.example.com', local: false }
    ])
    expect(result.unresolved).toEqual([])
    expect(result.refused).toBeNull()
  })

  it('collects unresolved variables except captured ones', () => {
    const result = resolvePlanTargetHosts({
      steps: [step('{{baseUrl}}/o/{{orderId}}/{{other}}', ['orderId'])],
      environment: [],
      inputs: {}
    })
    expect(result.unresolved).toEqual(['baseUrl', 'other'])
    expect(result.hosts).toEqual([])
  })

  it('refuses a host outside allowedHosts, including local ones', () => {
    const result = resolvePlanTargetHosts({
      steps: [step('http://localhost/a'), step('https://qa.example.com/b')],
      environment: [],
      inputs: {},
      allowedHosts: ['*.example.com']
    })
    expect(result.refused).toEqual({ host: 'localhost', allowedHosts: ['*.example.com'] })
  })

  it('allows everything when no list is set', () => {
    const result = resolvePlanTargetHosts({
      steps: [step('https://x.test/a')],
      environment: [],
      inputs: {}
    })
    expect(result.refused).toBeNull()
  })
})

describe('isHostAllowed', () => {
  it('matches exact hosts case-insensitively', () => {
    expect(isHostAllowed('API.example.com', ['api.example.com'])).toBe(true)
    expect(isHostAllowed('other.example.com', ['api.example.com'])).toBe(false)
  })

  it('wildcard matches subdomains only', () => {
    expect(isHostAllowed('a.example.com', ['*.example.com'])).toBe(true)
    expect(isHostAllowed('a.b.example.com', ['*.example.com'])).toBe(true)
    expect(isHostAllowed('example.com', ['*.example.com'])).toBe(false)
    expect(isHostAllowed('badexample.com', ['*.example.com'])).toBe(false)
  })
})
