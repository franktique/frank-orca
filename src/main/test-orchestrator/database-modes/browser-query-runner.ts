// Browser database mode (FR-006b, FR-009): types each query into a page console and recovers per query.
import type {
  BrowserRecoveryProblem,
  PauseAnswer,
  QueryEvidence,
  QueryResultTable,
  TestPlanStep,
  VerificationQuery
} from '../../../shared/test-orchestrator/test-orchestrator-types'
import type {
  BeforeQueriesResult,
  StepEvidenceCapture,
  StepHookContext,
  StepQueryHooks
} from '../test-run-step-executor'
import { classifyDataChange } from './automatic-query-runner'
import type {
  BrowserConsoleDriver,
  ConsoleRunOutcome,
  ConsoleScreenshotOutcome
} from './browser-console-driver'
import { createManualQueryHooks } from './manual-query-runner'

export const BROWSER_NOT_APPROVED_MESSAGE = 'Skipped: data change not approved'

export type BrowserQueryHooksOptions = {
  /** Builds a driver for a console tab; called again when the user picks another tab. */
  createDriver: (browserPageId: string) => BrowserConsoleDriver
  browserPageId: string
  /** Stores console screenshots next to the report; without it no image is written. */
  capture?: Pick<StepEvidenceCapture, 'writeImage'>
}

type Side = 'before' | 'after'
type RecoveryOutcome = Exclude<ConsoleRunOutcome, { kind: 'completed' } | { kind: 'aborted' }>
type ResolvedQuery = { query: VerificationQuery; sql: string }

const MANUAL_HOOKS = createManualQueryHooks()

function problemOf(outcome: RecoveryOutcome): BrowserRecoveryProblem {
  switch (outcome.kind) {
    case 'locate-failed':
      return 'not-found'
    case 'error':
    case 'sign-in':
    case 'timeout':
    case 'tab-closed':
      return outcome.kind
  }
}

function textToTable(text: string): QueryResultTable | null {
  if (text === '') {
    return null
  }
  const [header, ...rows] = text.split('\n').map((line) => line.split('\t'))
  return { columns: header, rows, totalRows: rows.length, truncated: false }
}

/** Hooks adapter for Browser mode; the console tab belongs to the user, so nothing is disposed. */
export function createBrowserQueryHooks(options: BrowserQueryHooksOptions): StepQueryHooks {
  const { capture } = options
  let driver = options.createDriver(options.browserPageId)
  let manualFromHere = false
  let skipRemaining = false

  const baseOf = (item: ResolvedQuery, context: StepHookContext) => ({
    queryId: item.query.id,
    ...(item.query.description === undefined
      ? {}
      : { description: context.sensitive.maskText(item.query.description) }),
    sqlResolved: context.sensitive.maskText(item.sql),
    partial: false,
    screenshot: null
  })

  const writeScreenshot = async (
    step: TestPlanStep,
    side: Side,
    queryIndex: number,
    shot: ConsoleScreenshotOutcome
  ): Promise<string | null> => {
    if (!capture || shot.kind !== 'captured') {
      return null
    }
    // Why: a failed write only loses the image; the query result stands.
    try {
      return await capture.writeImage(
        step,
        { kind: side, queryIndex },
        Buffer.from(shot.data, 'base64')
      )
    } catch {
      return null
    }
  }

  const recoveryScreenshot = async (context: StepHookContext): Promise<string> => {
    const shot = await driver.captureScreenshot(context.sensitive.values())
    return shot.kind === 'captured' ? `data:image/${shot.format};base64,${shot.data}` : ''
  }

  const runInBrowser = async (
    step: TestPlanStep,
    side: Side,
    item: ResolvedQuery,
    queryIndex: number,
    context: StepHookContext
  ): Promise<QueryEvidence | RecoveryOutcome> => {
    const outcome = await driver.runQuery(item.sql, context.signal)
    if (outcome.kind === 'aborted') {
      return {
        ...baseOf(item, context),
        how: 'failed',
        result: null,
        error: 'Query cancelled'
      }
    }
    if (outcome.kind !== 'completed') {
      return outcome
    }
    const text = await driver.readResult(context.sensitive.maskText)
    const shot = await driver.captureScreenshot(context.sensitive.values())
    const screenshot = await writeScreenshot(step, side, queryIndex, shot)
    return {
      ...baseOf(item, context),
      how: 'browser',
      result: text.ok ? textToTable(text.text) : null,
      partial: outcome.partial,
      screenshot,
      ...(shot.kind === 'captured' || shot.kind === 'withheld'
        ? { blurredCount: shot.blurredCount }
        : {}),
      ...(shot.kind === 'withheld' ? { screenshotWithheld: shot.reason } : {}),
      ...(text.ok ? {} : { error: context.sensitive.maskText(text.message) })
    }
  }

  const skipped = (item: ResolvedQuery, context: StepHookContext): QueryEvidence => ({
    ...baseOf(item, context),
    how: 'skipped-by-user',
    result: null
  })

  const runWithRecovery = async (
    step: TestPlanStep,
    side: Side,
    item: ResolvedQuery,
    queryIndex: number,
    context: StepHookContext
  ): Promise<QueryEvidence | 'manual'> => {
    for (;;) {
      const done = await runInBrowser(step, side, item, queryIndex, context)
      if (!('kind' in done)) {
        return done
      }
      const answer: PauseAnswer = await context.pause({
        kind: 'browser-recovery',
        stepId: step.stepId,
        queryId: item.query.id,
        problem: problemOf(done),
        screenshot: await recoveryScreenshot(context)
      })
      if (answer.kind !== 'browser-recovery') {
        throw new Error(`Unexpected ${answer.kind} answer to a browser-recovery pause.`)
      }
      switch (answer.action) {
        case 'retry':
          break
        case 'pick-tab':
          driver = options.createDriver(answer.browserPageId)
          break
        case 'do-manually':
          return 'manual'
        case 'skip':
          return skipped(item, context)
        case 'switch-rest-to-manual':
          manualFromHere = true
          return 'manual'
        case 'skip-remaining-queries':
          skipRemaining = true
          return skipped(item, context)
      }
    }
  }

  const failedEvidence = (item: ResolvedQuery, context: StepHookContext, error: string) =>
    ({
      ...baseOf(item, context),
      how: 'failed',
      result: null,
      error: context.sensitive.maskText(error)
    }) satisfies QueryEvidence

  // Why: manual pauses reuse the Manual mode card, one query (or the rest of the side) at a time.
  const runManually = async (
    step: TestPlanStep,
    side: Side,
    queries: readonly VerificationQuery[],
    context: StepHookContext
  ): Promise<QueryEvidence[]> => {
    const manualStep: TestPlanStep = {
      ...step,
      entry: step.entry ? { ...step.entry, before: [...queries], after: [...queries] } : null
    }
    return side === 'before'
      ? ((await MANUAL_HOOKS.runBefore?.(manualStep, context))?.evidence ?? [])
      : ((await MANUAL_HOOKS.runAfter?.(manualStep, context, [])) ?? [])
  }

  const runSide = async (
    step: TestPlanStep,
    side: Side,
    queries: readonly VerificationQuery[],
    context: StepHookContext
  ): Promise<BeforeQueriesResult> => {
    const evidence: QueryEvidence[] = []
    for (const [position, query] of queries.entries()) {
      if (manualFromHere) {
        evidence.push(...(await runManually(step, side, queries.slice(position), context)))
        return { evidence }
      }
      const resolved = context.scope.resolve(query.sql, step.requests[0]?.scope.folders)
      const item: ResolvedQuery = { query, sql: resolved.text }
      let produced: QueryEvidence | 'manual'
      if (skipRemaining) {
        produced = skipped(item, context)
      } else if (resolved.unresolved.length > 0) {
        const names = [...new Set(resolved.unresolved.map((span) => span.name))].join(', ')
        produced = failedEvidence(
          { query, sql: query.sql },
          context,
          `Unresolved variable: ${names}`
        )
      } else if (!step.approvedDataChange && (query.changesData || classifyDataChange(item.sql))) {
        produced = {
          ...baseOf(item, context),
          how: 'skipped-not-approved',
          result: null,
          error: BROWSER_NOT_APPROVED_MESSAGE
        }
      } else {
        produced = await runWithRecovery(step, side, item, position + 1, context)
      }
      if (produced === 'manual') {
        if (manualFromHere) {
          evidence.push(...(await runManually(step, side, queries.slice(position), context)))
          return { evidence }
        }
        produced = (await runManually(step, side, [query], context))[0]
      }
      evidence.push(produced)
      if (side === 'before' && query.precondition && produced.how === 'failed') {
        return { evidence, preconditionFailure: produced.error ?? 'precondition query failed' }
      }
    }
    return { evidence }
  }

  return {
    runBefore: (step, context) => runSide(step, 'before', step.entry?.before ?? [], context),
    runAfter: async (step, context) =>
      (await runSide(step, 'after', step.entry?.after ?? [], context)).evidence
  }
}
