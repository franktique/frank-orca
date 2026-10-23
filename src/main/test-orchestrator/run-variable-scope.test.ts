import { describe, expect, it } from 'vitest'
import { createRunSensitiveValues } from '../../shared/test-orchestrator/run-sensitive-values'
import type { CapturedValue } from '../../shared/test-orchestrator/test-orchestrator-types'
import { createRunVariableScope } from './run-variable-scope'

const noWrites = { set: {}, unset: [] }

function setup(overrides: { secretInput?: boolean } = {}) {
  const appended: CapturedValue[] = []
  const sensitive = createRunSensitiveValues()
  const scope = createRunVariableScope({
    runId: 'r1',
    worktreeId: 'w1',
    collectionId: 'c1',
    environment: {
      variables: [
        { key: 'host', value: 'https://api', enabled: true, type: 'default' },
        { key: 'apiSecret', value: 'env-secret-value', enabled: true, type: 'secret' }
      ]
    },
    collectionVariables: [{ key: 'region', value: 'eu', enabled: true }],
    inputs: [{ name: 'userToken', value: 'tok-12345', secret: overrides.secretInput ?? true }],
    sensitive,
    ledger: { append: async (_w, _c, v) => void appended.push(v) },
    now: () => 42
  })
  return { scope, appended, sensitive }
}

describe('createRunVariableScope', () => {
  it('overlays inputs onto the environment and masks secret ones', () => {
    const { scope, sensitive } = setup()
    const { environment, collection } = scope.overlay()
    expect(environment.find((v) => v.key === 'userToken')).toMatchObject({
      value: 'tok-12345',
      type: 'secret'
    })
    expect(collection).toHaveLength(1)
    expect(sensitive.maskText('x tok-12345 env-secret-value')).not.toContain('tok-12345')
    expect(sensitive.maskText('env-secret-value')).not.toContain('env-secret-value')
  })

  it('returns copies that do not leak mutations back', () => {
    const { scope } = setup()
    scope.overlay().environment[0].value = 'changed'
    expect(scope.overlay().environment[0].value).toBe('https://api')
  })

  it('records script writes with source and step, and applies them to later overlays', async () => {
    const { scope, appended } = setup()
    await scope.sinkFor('s1')({
      environment: { set: { caseId: '99' }, unset: [] },
      collection: { set: { region: 'us' }, unset: [] }
    })
    expect(appended.map((v) => [v.variable, v.value, v.source, v.stepId, v.runId])).toEqual([
      ['caseId', '99', 'script', 's1', 'r1'],
      ['region', 'us', 'script', 's1', 'r1']
    ])
    expect(appended[0]).toMatchObject({ capturedAt: 42, cleaned: null })
    const next = scope.overlay()
    expect(next.environment.find((v) => v.key === 'caseId')?.value).toBe('99')
    expect(next.collection.find((v) => v.key === 'region')?.value).toBe('us')
  })

  it('applies unsets and ignores empty writes', async () => {
    const { scope, appended } = setup()
    await scope.sinkFor('s1')({ environment: { set: {}, unset: ['host'] }, collection: noWrites })
    expect(appended).toEqual([])
    expect(scope.overlay().environment.some((v) => v.key === 'host')).toBe(false)
  })

  it('grows the sensitive set from sensitive captures and secret overwrites', async () => {
    const { scope, sensitive } = setup()
    await scope.sinkFor('s1')({
      environment: { set: { authToken: 'fresh-tok-777', apiSecret: 'rotated-value' }, unset: [] },
      collection: noWrites
    })
    await scope.capture('s2', 'sessionKey', 'key-abc-123')
    await scope.capture('s2', 'caseId', 'plain-id-5')
    const masked = sensitive.maskText('fresh-tok-777 rotated-value key-abc-123 plain-id-5')
    expect(masked).not.toMatch(/fresh-tok-777|rotated-value|key-abc-123/)
    expect(masked).toContain('plain-id-5')
  })

  it('records test-map captures and resolves them in queries', async () => {
    const { scope, appended } = setup()
    await scope.capture('s2', 'caseId', '7')
    expect(appended[0]).toMatchObject({ variable: 'caseId', source: 'test-map', stepId: 's2' })
    expect(scope.resolve('{{host}}/cases/{{caseId}}?r={{region}}&x={{nope}}')).toEqual({
      text: 'https://api/cases/7?r=eu&x={{nope}}',
      unresolved: [{ name: 'nope', start: 41, end: 49 }]
    })
  })

  it('lets folder variables sit between environment and collection', () => {
    const { scope } = setup()
    const folders = [{ name: 'Setup', variables: [{ key: 'region', value: 'ap', enabled: true }] }]
    expect(scope.resolve('{{region}}', folders).text).toBe('ap')
  })
})
