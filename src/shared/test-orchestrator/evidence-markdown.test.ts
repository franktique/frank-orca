import { describe, expect, it } from 'vitest'
import { renderEvidenceReport, type EvidenceReportContext } from './evidence-markdown'
import type { QueryEvidence, RequestEvidence, StepResult, TestRun } from './test-orchestrator-types'

const START = Date.UTC(2026, 9, 19, 19, 32, 5)
const CONTEXT: EvidenceReportContext = {
  planName: 'Smoke plan',
  orcaVersion: '1.4.0',
  utcOffsetMinutes: -300
}

function exchange(overrides: Partial<RequestEvidence> = {}): RequestEvidence {
  return {
    requestId: 'req-1',
    resolvedRequest: {
      method: 'POST',
      url: 'https://qa.example.com/api/v1/cases/c-123/bulk',
      headers: [
        ['Authorization', 'Bearer ••••'],
        ['Content-Type', 'application/json']
      ],
      body: '{"users":["u-1"]}'
    },
    outcome: {
      kind: 'response',
      response: {
        status: 201,
        statusText: 'Created',
        headers: [],
        sizeBytes: 1229,
        contentType: 'application/json',
        body: { encoding: 'utf8', text: '{"data":{"requestId":"r-77"}}', truncated: false },
        redirects: []
      }
    },
    tests: [],
    screenshot: null,
    ...overrides
  }
}

function step(overrides: Partial<StepResult>): StepResult {
  return {
    stepId: 'SC-1',
    title: 'Bulk create | stores rows',
    phase: 'scenario',
    result: 'pass',
    dependencyFailed: [],
    expectedText: '201',
    actualText: '201',
    before: [],
    after: [],
    exchanges: [exchange({ screenshot: 'images/03-sc-1-request.png' })],
    durationMs: 312,
    ...overrides
  }
}

function run(overrides: Partial<TestRun>): TestRun {
  return {
    id: 'run-1',
    collectionId: 'col-1',
    kind: 'full',
    environmentId: null,
    targetHosts: ['qa.example.com'],
    databaseMode: { mode: 'none' },
    state: 'finished',
    ending: 'passed',
    startedAt: START,
    endedAt: START + 252_000,
    pausedMs: 63_000,
    currentStepIndex: null,
    steps: [],
    pause: null,
    evidence: { folder: 'evidencias/smoke-plan/x', reportPath: 'report.md', ignoredByGit: false },
    cleanup: { cleaned: 2, notCleaned: [], keptByUser: false },
    ...overrides
  }
}

const health = step({
  stepId: 'P-1',
  title: 'Health',
  phase: 'preflight',
  exchanges: [],
  durationMs: 0
})
const cleanupStep = step({
  stepId: 'C-1',
  title: 'Delete request',
  phase: 'cleanup',
  expectedText: '204',
  actualText: '204',
  exchanges: [exchange({ screenshot: null })]
})
const golden = (name: string): string => `./__fixtures__/evidence/${name}.md`

describe('renderEvidenceReport', () => {
  it('renders a passed run', async () => {
    const report = renderEvidenceReport(
      run({
        databaseMode: { mode: 'automatic', connectionName: 'qa-readonly' },
        steps: [health, step({}), cleanupStep]
      }),
      { ...CONTEXT, guideLink: { text: 'guide.html', href: '../../../guide.html' } }
    )
    await expect(report).toMatchFileSnapshot(golden('passed'))
  })

  it('renders before/after query blocks', async () => {
    const query = (overrides: Partial<QueryEvidence>): QueryEvidence => ({
      queryId: 'q-1',
      sqlResolved: "SELECT count(*) FROM requests WHERE case_id = 'c-123'",
      description: 'Rows for this case',
      how: 'automatic',
      result: { columns: ['count'], rows: [['0']], totalRows: 1, truncated: false },
      partial: false,
      screenshot: 'images/03-sc-1-before-1.png',
      ...overrides
    })
    const report = renderEvidenceReport(
      run({
        databaseMode: { mode: 'automatic', connectionName: 'qa-readonly' },
        steps: [
          step({
            before: [query({})],
            after: [
              query({
                queryId: 'q-2',
                screenshot: 'images/03-sc-1-after-1.png',
                result: {
                  columns: ['id', 'note'],
                  rows: [
                    ['1', 'a|b'],
                    ['2', 'NULL']
                  ],
                  totalRows: 1532,
                  truncated: true
                }
              }),
              query({
                queryId: 'q-3',
                description: undefined,
                how: 'failed',
                result: null,
                screenshot: null,
                error: 'relation "x" does not exist'
              }),
              query({ queryId: 'q-4', how: 'skipped-not-approved', result: null, screenshot: null })
            ]
          })
        ]
      }),
      CONTEXT
    )
    await expect(report).toMatchFileSnapshot(golden('queries'))
  })

  it('renders a failed run with a blocked step and the git-ignore note', async () => {
    const report = renderEvidenceReport(
      run({
        ending: 'failed',
        databaseMode: { mode: 'manual' },
        evidence: { folder: 'e', reportPath: 'report.md', ignoredByGit: true },
        steps: [
          step({
            stepId: 'S-3',
            title: 'Create case',
            phase: 'setup',
            result: 'fail',
            actualText: '500'
          }),
          step({
            stepId: 'SC-7',
            result: 'blocked',
            reason: 'blocked by setup step S-3',
            actualText: '',
            exchanges: []
          })
        ]
      }),
      CONTEXT
    )
    await expect(report).toMatchFileSnapshot(golden('failed-blocked'))
  })

  it('lists steps never reached after Stop', async () => {
    const report = renderEvidenceReport(
      run({
        ending: 'stopped-by-user',
        databaseMode: { mode: 'browser', site: 'console.cloud.example.com' },
        pausedMs: 0,
        steps: [
          step({}),
          step({
            stepId: 'SC-2',
            result: 'skipped',
            reason: 'skipped — run stopped',
            actualText: '',
            exchanges: []
          })
        ]
      }),
      CONTEXT
    )
    await expect(report).toMatchFileSnapshot(golden('stopped'))
  })

  it('marks values kept by the user on Stop', async () => {
    const report = renderEvidenceReport(
      run({
        ending: 'stopped-by-user',
        steps: [step({})],
        cleanup: {
          cleaned: 0,
          notCleaned: [{ variable: 'requestId', valueMasked: 'r-77' }],
          keptByUser: true
        }
      }),
      CONTEXT
    )
    await expect(report).toMatchFileSnapshot(golden('stopped-keep-data'))
  })

  it('renders an in-progress run', async () => {
    const report = renderEvidenceReport(
      run({
        state: 'running',
        ending: null,
        endedAt: null,
        currentStepIndex: 1,
        evidence: null,
        steps: [
          step({}),
          step({ stepId: 'SC-2', result: 'running', actualText: '', exchanges: [] }),
          step({ stepId: 'SC-3', result: 'pending', actualText: '', exchanges: [] })
        ]
      }),
      CONTEXT
    )
    await expect(report).toMatchFileSnapshot(golden('in-progress'))
  })

  it('shows a broken test-map link as a skipped step', async () => {
    const report = renderEvidenceReport(
      run({
        ending: 'failed',
        steps: [
          step({
            stepId: 'SC-5',
            result: 'skipped',
            reason: 'skipped — broken test-map link',
            actualText: '',
            exchanges: []
          })
        ]
      }),
      CONTEXT
    )
    await expect(report).toMatchFileSnapshot(golden('broken-link'))
  })

  it('flags a dependency failure in the summary and the step', async () => {
    const report = renderEvidenceReport(
      run({
        ending: 'failed',
        steps: [
          step({ stepId: 'SC-2', result: 'fail', dependencyFailed: ['SC-1'], actualText: '404' })
        ]
      }),
      CONTEXT
    )
    await expect(report).toMatchFileSnapshot(golden('dependency-failed'))
  })

  it('explains an unavailable not-cleaned value, and renders text and binary bodies', async () => {
    const response = exchange().outcome
    if (response.kind !== 'response') {
      throw new Error('fixture must be a response')
    }
    const textual = exchange({
      outcome: {
        kind: 'response',
        response: {
          ...response.response,
          body: { encoding: 'utf8', text: 'plain ok', truncated: false }
        }
      }
    })
    const binary = exchange({
      outcome: {
        kind: 'response',
        response: {
          ...response.response,
          sizeBytes: 34 * 1024,
          contentType: 'image/png',
          body: { encoding: 'base64', truncated: false }
        }
      }
    })
    const report = renderEvidenceReport(
      run({
        steps: [step({ exchanges: [textual, binary], stepId: 'SC-1' })],
        cleanup: {
          cleaned: 1,
          notCleaned: [{ variable: 'apiToken', valueMasked: '••••', unavailable: true }],
          keptByUser: false
        }
      }),
      CONTEXT
    )
    await expect(report).toMatchFileSnapshot(golden('unavailable-not-cleaned'))
  })
})
