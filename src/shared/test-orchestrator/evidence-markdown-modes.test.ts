import { describe, expect, it } from 'vitest'
import { renderEvidenceReport, type EvidenceReportContext } from './evidence-markdown'
import type { QueryEvidence, RequestEvidence, StepResult, TestRun } from './test-orchestrator-types'

const START = Date.UTC(2026, 9, 19, 19, 32, 5)
const CONTEXT: EvidenceReportContext = {
  planName: 'Smoke plan',
  orcaVersion: '1.4.0',
  utcOffsetMinutes: -300
}
const golden = (name: string): string => `./__fixtures__/evidence/${name}.md`

function exchange(id: string, status: number, sentOffsetMs?: number): RequestEvidence {
  return {
    requestId: id,
    resolvedRequest: {
      method: 'POST',
      url: 'https://qa.example.com/api/claim',
      headers: [],
      body: null
    },
    outcome: {
      kind: 'response',
      response: {
        status,
        statusText: status === 201 ? 'Created' : 'Conflict',
        headers: [],
        sizeBytes: 12,
        contentType: 'application/json',
        body: { encoding: 'utf8', text: '{"ok":true}', truncated: false },
        redirects: []
      }
    },
    tests: [],
    sentOffsetMs,
    screenshot: null
  }
}

function query(overrides: Partial<QueryEvidence>): QueryEvidence {
  return {
    queryId: 'q-1',
    sqlResolved: "SELECT count(*) FROM claims WHERE case_id = 'c-123'",
    description: 'Claims for this case',
    how: 'manual',
    result: null,
    partial: false,
    screenshot: null,
    ...overrides
  }
}

function step(overrides: Partial<StepResult>): StepResult {
  return {
    stepId: 'SC-1',
    title: 'Claim case',
    phase: 'scenario',
    result: 'pass',
    dependencyFailed: [],
    expectedText: '201',
    actualText: '201',
    before: [],
    after: [],
    exchanges: [exchange('req-1', 201)],
    durationMs: 312,
    ...overrides
  }
}

function run(databaseMode: TestRun['databaseMode'], steps: StepResult[]): TestRun {
  return {
    id: 'run-1',
    collectionId: 'col-1',
    kind: 'full',
    environmentId: null,
    targetHosts: ['qa.example.com'],
    databaseMode,
    state: 'finished',
    ending: 'passed',
    startedAt: START,
    endedAt: START + 60_000,
    pausedMs: 0,
    currentStepIndex: null,
    steps,
    pause: null,
    evidence: { folder: 'e', reportPath: 'report.md', ignoredByGit: false },
    cleanup: { cleaned: 0, notCleaned: [], keptByUser: false }
  }
}

describe('evidence markdown by database mode and concurrency', () => {
  it('renders manual query blocks with wait time, pasted text and skips', async () => {
    const report = renderEvidenceReport(
      run({ mode: 'manual' }, [
        step({
          before: [query({ waitedMs: 63_000, pastedText: 'count\n-----\n0' })],
          after: [
            query({ queryId: 'q-2', waitedMs: 8_000 }),
            query({ queryId: 'q-3', how: 'skipped-by-user', description: undefined })
          ]
        })
      ]),
      CONTEXT
    )
    await expect(report).toMatchFileSnapshot(golden('manual-queries'))
  })

  it('renders browser query blocks with partial, blurred and withheld notes', async () => {
    const result = { columns: ['count'], rows: [['3']], totalRows: 1, truncated: false }
    const report = renderEvidenceReport(
      run({ mode: 'browser', site: 'console.cloud.example.com' }, [
        step({
          before: [
            query({
              how: 'browser',
              result,
              partial: true,
              blurredCount: 3,
              screenshot: 'SC-1/SC-1-before-1.png'
            })
          ],
          after: [
            query({
              queryId: 'q-2',
              how: 'browser',
              result,
              screenshotWithheld: 'residual'
            })
          ]
        })
      ]),
      CONTEXT
    )
    await expect(report).toMatchFileSnapshot(golden('browser-queries'))
  })

  it('renders a concurrent group with offsets and the group verdict', async () => {
    const report = renderEvidenceReport(
      run({ mode: 'none' }, [
        step({
          title: 'Two users claim the same case',
          expectedText: '201 + 409',
          actualText: '201, 409',
          exchanges: [exchange('req-1', 201, 0), exchange('req-2', 409, 3)]
        })
      ]),
      CONTEXT
    )
    await expect(report).toMatchFileSnapshot(golden('concurrent-group'))
  })
})
