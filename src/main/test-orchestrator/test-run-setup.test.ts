import { describe, expect, it } from 'vitest'
import type { RunInput } from '../../shared/test-orchestrator/test-orchestrator-types'
import { fakePlanStep } from './test-support/test-run-fakes'
import type { PlanContext } from './test-run-plan-context'
import { applyRememberChoices, buildSetupModel } from './test-run-setup'

const query = (id: string, sql: string, changesData = false) => ({
  id,
  sql,
  precondition: false,
  changesData
})

describe('buildSetupModel data-changing steps', () => {
  it('flags unflagged write statements the runners would refuse', () => {
    const step = fakePlanStep('S-1', 'scenario', 0, {
      entry: {
        before: [query('q-read', 'select 1'), query('q-write', 'delete from t')],
        after: [query('q-flagged', 'select 2', true)]
      }
    })
    const model = buildSetupModel({
      context: {
        steps: [step],
        testMap: null,
        environment: { variables: [] }
      } as unknown as PlanContext,
      settings: null,
      unavailableSecretInputs: [],
      uncleanedCaptures: 0,
      activeRunId: null
    })
    expect(model.dataChangingSteps).toEqual([{ stepId: 'S-1', queryIds: ['q-write', 'q-flagged'] }])
  })
})

describe('applyRememberChoices database mode', () => {
  const base = {
    existing: null,
    collectionId: 'col',
    environmentId: 'env',
    inputs: [{ name: 'user', secret: false, required: true }] as unknown as RunInput[],
    effective: { user: 'ann' }
  }
  const databaseMode = { mode: 'manual' } as const

  it('saves the mode without storing inputs the user chose not to remember', () => {
    const next = applyRememberChoices({
      ...base,
      remember: { inputs: false, secrets: false },
      databaseMode
    })
    expect(next?.databaseMode).toEqual(databaseMode)
    expect(next?.inputs).toEqual({})
  })

  it('saves nothing when there is neither a choice to remember nor a mode', () => {
    expect(
      applyRememberChoices({
        ...base,
        remember: { inputs: false, secrets: false },
        databaseMode: undefined
      })
    ).toBeNull()
  })
})
