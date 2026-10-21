import { describe, expect, it } from 'vitest'
import { createRunSensitiveValues } from '../../../shared/test-orchestrator/run-sensitive-values'
import type {
  PauseAnswer,
  PauseRequest,
  VerificationQuery
} from '../../../shared/test-orchestrator/test-orchestrator-types'
import { createRunVariableScope } from '../run-variable-scope'
import type { StepHookContext } from '../test-run-step-executor'
import { fakePlanStep } from '../test-support/test-run-fakes'
import type {
  BrowserConsoleDriver,
  ConsoleRunOutcome,
  ConsoleScreenshotOutcome
} from './browser-console-driver'
import { createBrowserQueryHooks } from './browser-query-runner'

const query = (id: string, sql: string, extra: Partial<VerificationQuery> = {}) => ({
  id,
  sql,
  precondition: false,
  changesData: false,
  ...extra
})

const CAPTURED: ConsoleScreenshotOutcome = {
  kind: 'captured',
  data: 'AAAA',
  format: 'png',
  blurredCount: 2,
  overlaysRestored: true
}

function fakeDriver(
  outcomes: ConsoleRunOutcome[],
  shot: ConsoleScreenshotOutcome = CAPTURED
): BrowserConsoleDriver & { ran: string[] } {
  const ran: string[] = []
  return {
    ran,
    locate: async () => ({ ok: true, editor: 'e', run: 'r' }),
    isTabOpen: () => true,
    runQuery: async (sql) => {
      ran.push(sql)
      return outcomes.shift() ?? { kind: 'completed', partial: false }
    },
    readResult: async () => ({ ok: true, found: true, text: 'id\tname\n1\tann' }),
    captureScreenshot: async () => shot
  }
}

function setup(answers: PauseAnswer[], approved = false) {
  const sensitive = createRunSensitiveValues()
  const scope = createRunVariableScope({
    runId: 'r',
    worktreeId: 'w',
    collectionId: 'c',
    environment: null,
    collectionVariables: [],
    inputs: [],
    sensitive,
    ledger: { append: async () => undefined }
  })
  const pauses: PauseRequest[] = []
  const context: StepHookContext = {
    runId: 'r',
    signal: new AbortController().signal,
    scope,
    sensitive,
    pause: async (request) => {
      pauses.push(request)
      const next = answers.shift()
      if (!next) {
        throw new Error('unexpected pause')
      }
      return next
    }
  }
  const step = (queries: VerificationQuery[]) => ({
    ...fakePlanStep('SC-1', 'scenario', 0, { entry: { after: queries } }),
    approvedDataChange: approved
  })
  return { context, pauses, step }
}

const recovery = (action: string, extra: object = {}): PauseAnswer =>
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: test-only answer built from known actions.
  ({ kind: 'browser-recovery', action, ...extra }) as PauseAnswer

describe('createBrowserQueryHooks', () => {
  it('records blur count and the result table for a normal query', async () => {
    const driver = fakeDriver([])
    const { context, step } = setup([])
    const hooks = createBrowserQueryHooks({ createDriver: () => driver, browserPageId: 'p1' })
    const [item] = (await hooks.runAfter?.(step([query('q1', 'select 1')]), context, [])) ?? []
    expect(item).toMatchObject({
      how: 'browser',
      blurredCount: 2,
      result: { columns: ['id', 'name'], rows: [['1', 'ann']] }
    })
  })

  it('records screenshotWithheld when redaction blocks the capture', async () => {
    const driver = fakeDriver([], {
      kind: 'withheld',
      reason: 'residual',
      blurredCount: 1,
      overlaysRestored: true
    })
    const { context, step } = setup([])
    const hooks = createBrowserQueryHooks({ createDriver: () => driver, browserPageId: 'p1' })
    const [item] = (await hooks.runAfter?.(step([query('q1', 'select 1')]), context, [])) ?? []
    expect(item).toMatchObject({ screenshotWithheld: 'residual', blurredCount: 1 })
  })

  it('does not run a data-changing query unless the step is approved', async () => {
    const driver = fakeDriver([])
    const { context, step } = setup([])
    const hooks = createBrowserQueryHooks({ createDriver: () => driver, browserPageId: 'p1' })
    const [item] = (await hooks.runAfter?.(step([query('q1', 'delete from t')]), context, [])) ?? []
    expect(item.how).toBe('skipped-not-approved')
    expect(driver.ran).toEqual([])
    const approved = setup([], true)
    const [ran] =
      (await hooks.runAfter?.(
        approved.step([query('q1', 'delete from t')]),
        approved.context,
        []
      )) ?? []
    expect(ran.how).toBe('browser')
  })

  it('pauses with a screenshot on sign-in and retries', async () => {
    const driver = fakeDriver([{ kind: 'sign-in' }])
    const { context, pauses, step } = setup([recovery('retry')])
    const hooks = createBrowserQueryHooks({ createDriver: () => driver, browserPageId: 'p1' })
    const [item] = (await hooks.runAfter?.(step([query('q1', 'select 1')]), context, [])) ?? []
    expect(pauses[0]).toMatchObject({
      kind: 'browser-recovery',
      problem: 'sign-in',
      screenshot: 'data:image/png;base64,AAAA'
    })
    expect(item.how).toBe('browser')
    expect(driver.ran).toHaveLength(2)
  })

  it('switches to another tab on pick-tab', async () => {
    const first = fakeDriver([{ kind: 'tab-closed' }])
    const second = fakeDriver([])
    const { context, step } = setup([recovery('pick-tab', { browserPageId: 'p2' })])
    const hooks = createBrowserQueryHooks({
      createDriver: (id) => (id === 'p1' ? first : second),
      browserPageId: 'p1'
    })
    const [item] = (await hooks.runAfter?.(step([query('q1', 'select 1')]), context, [])) ?? []
    expect(item.how).toBe('browser')
    expect(second.ran).toEqual(['select 1'])
  })

  it('skips on skip and records skipped-by-user', async () => {
    const driver = fakeDriver([{ kind: 'error', message: 'boom' }])
    const { context, step } = setup([recovery('skip')])
    const hooks = createBrowserQueryHooks({ createDriver: () => driver, browserPageId: 'p1' })
    const [item] = (await hooks.runAfter?.(step([query('q1', 'select 1')]), context, [])) ?? []
    expect(item.how).toBe('skipped-by-user')
  })

  it('do-manually asks for that query only, then continues in the browser', async () => {
    const driver = fakeDriver([{ kind: 'timeout', timeoutMs: 5 }])
    const { context, pauses, step } = setup([
      recovery('do-manually'),
      { kind: 'manual-queries', action: 'continue', pasted: { q1: 'pasted' } }
    ])
    const hooks = createBrowserQueryHooks({ createDriver: () => driver, browserPageId: 'p1' })
    const items =
      (await hooks.runAfter?.(
        step([query('q1', 'select 1'), query('q2', 'select 2')]),
        context,
        []
      )) ?? []
    expect(pauses[1]).toMatchObject({ kind: 'manual-queries' })
    expect(items.map((item) => item.how)).toEqual(['manual', 'browser'])
    expect(items[0].pastedText).toBe('pasted')
  })

  it('switch-rest-to-manual sends the failing and later queries to one manual pause', async () => {
    const driver = fakeDriver([{ kind: 'error', message: 'x' }])
    const { context, pauses, step } = setup([
      recovery('switch-rest-to-manual'),
      { kind: 'manual-queries', action: 'continue' }
    ])
    const hooks = createBrowserQueryHooks({ createDriver: () => driver, browserPageId: 'p1' })
    const items =
      (await hooks.runAfter?.(
        step([query('q1', 'select 1'), query('q2', 'select 2')]),
        context,
        []
      )) ?? []
    expect(pauses[1]).toMatchObject({ kind: 'manual-queries' })
    expect(items.map((item) => item.how)).toEqual(['manual', 'manual'])
  })

  it('skip-remaining-queries skips this and every later query without pausing', async () => {
    const driver = fakeDriver([{ kind: 'error', message: 'x' }])
    const { context, pauses, step } = setup([recovery('skip-remaining-queries')])
    const hooks = createBrowserQueryHooks({ createDriver: () => driver, browserPageId: 'p1' })
    const items =
      (await hooks.runAfter?.(
        step([query('q1', 'select 1'), query('q2', 'select 2')]),
        context,
        []
      )) ?? []
    expect(items.map((item) => item.how)).toEqual(['skipped-by-user', 'skipped-by-user'])
    expect(pauses).toHaveLength(1)
  })
})
