import { z } from 'zod'
import type { AgentBrowserBridge } from '../../browser/agent-browser-bridge'
import type { DatabaseConsoleHints } from '../../../shared/test-orchestrator/test-orchestrator-types'
import {
  buildConsoleProbeScript,
  buildReadResultScript,
  consoleProbeSchema,
  consoleResultSchema,
  type ConsoleProbe
} from './browser-console-page-scripts'
import {
  buildRedactionScript,
  parseEvaluateValue,
  parseRedactionReport,
  parseRestoreReport,
  redactionBlocksScreenshot,
  RESTORE_REDACTION_SCRIPT
} from './browser-console-redaction'

export type BrowserConsoleBridge = Pick<
  AgentBrowserBridge,
  | 'snapshot'
  | 'click'
  | 'keypress'
  | 'keyboardInsertText'
  | 'focus'
  | 'selectAll'
  | 'evaluate'
  | 'screenshot'
  | 'tabList'
>

/** Matches the Run control's accessible name (R7 step 1). */
export const RUN_CONTROL_NAME = /^(run|execute|ejecutar|run query|▶)/i
const EDITOR_NAME = /editor|query|sql|code|cursor|consulta/i
export const DEFAULT_CONSOLE_QUERY_TIMEOUT_MS = 30_000

export type BrowserConsoleDriverOptions = {
  bridge: BrowserConsoleBridge
  worktreeId?: string
  browserPageId: string
  hints?: DatabaseConsoleHints
  /** The SQL tab's query timeout from feature 002's settings; 30 s when unset. */
  queryTimeoutMs?: number
  pollIntervalMs?: number
  platform?: NodeJS.Platform
  sleep?: (ms: number) => Promise<void>
  now?: () => number
}

export type ConsoleLocateResult =
  | { ok: true; editor: string; run: string }
  | {
      ok: false
      reason: 'editor-not-found' | 'run-not-found' | 'tab-closed' | 'bridge-error'
      message: string
    }

/** Every non-completed outcome is a recovery pause for the runner (FR-006b). */
export type ConsoleRunOutcome =
  | { kind: 'completed'; partial: boolean }
  | { kind: 'sign-in' }
  | { kind: 'error'; message: string }
  | { kind: 'timeout'; timeoutMs: number }
  | { kind: 'locate-failed'; locate: Extract<ConsoleLocateResult, { ok: false }> }
  | { kind: 'tab-closed' }
  | { kind: 'aborted' }

export type ConsoleResultText =
  | { ok: true; found: boolean; text: string }
  | { ok: false; message: string }

type ConsoleScreenshotBody =
  | { kind: 'captured'; data: string; format: 'png' | 'jpeg'; blurredCount: number }
  | { kind: 'withheld'; reason: 'residual' | 'uninspectable'; blurredCount: number }
  | { kind: 'failed'; message: string }

/** `overlaysRestored: false` means the page still carries overlays and needs attention. */
export type ConsoleScreenshotOutcome = ConsoleScreenshotBody & { overlaysRestored: boolean }

export type BrowserConsoleDriver = {
  locate: () => Promise<ConsoleLocateResult>
  isTabOpen: () => boolean
  runQuery: (sql: string, signal?: AbortSignal) => Promise<ConsoleRunOutcome>
  /** First table/grid as text, each cell passed through `maskText`. */
  readResult: (maskText: (text: string) => string) => Promise<ConsoleResultText>
  /** Blurs `sensitiveValues`, captures unless unsafe, and always removes the overlays. */
  captureScreenshot: (sensitiveValues: readonly string[]) => Promise<ConsoleScreenshotOutcome>
}

type Located = { editor: string; run: string }

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

const snapshotRefSchema = z.object({ ref: z.string(), role: z.string(), name: z.string() })
const snapshotRefMapSchema = z.record(z.string(), z.object({ role: z.string(), name: z.string() }))
type SnapshotRef = z.infer<typeof snapshotRefSchema>

/** The bridge types `refs` as a list, but agent-browser returns `{ e1: { role, name } }`. */
function listSnapshotRefs(refs: unknown): SnapshotRef[] {
  if (Array.isArray(refs)) {
    return refs.flatMap((entry) => {
      const parsed = snapshotRefSchema.safeParse(entry)
      return parsed.success ? [parsed.data] : []
    })
  }
  const parsed = snapshotRefMapSchema.safeParse(refs)
  return parsed.success
    ? Object.entries(parsed.data).map(([key, value]) => ({
        ref: key.startsWith('@') ? key : `@${key}`,
        ...value
      }))
    : []
}

function pickFromSnapshot(
  refs: readonly SnapshotRef[],
  hints: DatabaseConsoleHints | undefined
): { editor: string | null; run: string | null } {
  const textboxes = refs.filter((entry) => entry.role === 'textbox')
  const editor =
    hints?.editorSelector ??
    (textboxes.find((entry) => EDITOR_NAME.test(entry.name)) ?? textboxes[0])?.ref ??
    null
  const run =
    hints?.runSelector ??
    refs.find((entry) => entry.role === 'button' && RUN_CONTROL_NAME.test(entry.name.trim()))
      ?.ref ??
    null
  return { editor, run }
}

export function createBrowserConsoleDriver(
  options: BrowserConsoleDriverOptions
): BrowserConsoleDriver {
  const { bridge, worktreeId, browserPageId, hints } = options
  const timeoutMs = options.queryTimeoutMs ?? DEFAULT_CONSOLE_QUERY_TIMEOUT_MS
  const pollIntervalMs = options.pollIntervalMs ?? 250
  const platform = options.platform ?? process.platform
  const sleep =
    options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  const now = options.now ?? Date.now
  const submitKey = platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter'
  let located: Located | null = null
  let overlaysRestored = true

  const isTabOpen = (): boolean =>
    bridge.tabList(worktreeId).tabs.some((tab) => tab.browserPageId === browserPageId)

  async function evaluateValue(expression: string): Promise<unknown> {
    const { result } = await bridge.evaluate(expression, worktreeId, browserPageId)
    return parseEvaluateValue(result)
  }

  async function probe(): Promise<ConsoleProbe> {
    return consoleProbeSchema.parse(
      await evaluateValue(buildConsoleProbeScript(hints?.resultSelector))
    )
  }

  async function locate(): Promise<ConsoleLocateResult> {
    located = null
    try {
      if (!isTabOpen()) {
        return { ok: false, reason: 'tab-closed', message: 'The console tab is no longer open.' }
      }
      let picked: { editor: string | null; run: string | null }
      if (hints?.editorSelector && hints.runSelector) {
        picked = { editor: hints.editorSelector, run: hints.runSelector }
      } else {
        const snapshot = await bridge.snapshot(worktreeId, browserPageId)
        picked = pickFromSnapshot(listSnapshotRefs(snapshot.refs), hints)
      }
      if (!picked.editor) {
        return {
          ok: false,
          reason: 'editor-not-found',
          message: 'No query editor was found on the page.'
        }
      }
      if (!picked.run) {
        return {
          ok: false,
          reason: 'run-not-found',
          message: 'No Run control was found on the page.'
        }
      }
      located = { editor: picked.editor, run: picked.run }
      return { ok: true, ...located }
    } catch (error) {
      return { ok: false, reason: 'bridge-error', message: messageOf(error) }
    }
  }

  async function enterAndSubmit(target: Located, sql: string): Promise<void> {
    await bridge.focus(target.editor, worktreeId, browserPageId)
    await bridge.selectAll(target.editor, worktreeId, browserPageId)
    await bridge.keyboardInsertText(sql, worktreeId, browserPageId)
    try {
      await bridge.click(target.run, worktreeId, browserPageId)
    } catch {
      await bridge.focus(target.editor, worktreeId, browserPageId)
      await bridge.keypress(submitKey, worktreeId, browserPageId)
    }
  }

  async function waitForOutcome(
    baseline: ConsoleProbe,
    signal?: AbortSignal
  ): Promise<ConsoleRunOutcome> {
    const startedAt = now()
    let changedHash: string | null = null
    for (;;) {
      if (signal?.aborted) {
        return { kind: 'aborted' }
      }
      const current = await probe()
      if (current.signIn) {
        return { kind: 'sign-in' }
      }
      if (current.errorText !== null && current.errorText !== baseline.errorText) {
        return { kind: 'error', message: current.errorText }
      }
      // Why: a result region that changed twice in a row to the same value has finished rendering.
      if (current.hash !== baseline.hash && current.hash === changedHash) {
        return { kind: 'completed', partial: current.partial }
      }
      changedHash = current.hash !== baseline.hash ? current.hash : null
      if (now() - startedAt >= timeoutMs) {
        return { kind: 'timeout', timeoutMs }
      }
      await sleep(pollIntervalMs)
    }
  }

  async function runQuery(sql: string, signal?: AbortSignal): Promise<ConsoleRunOutcome> {
    try {
      if (!located) {
        const result = await locate()
        if (!result.ok) {
          return result.reason === 'tab-closed'
            ? { kind: 'tab-closed' }
            : { kind: 'locate-failed', locate: result }
        }
      }
      if (!located) {
        return { kind: 'error', message: 'The console controls are not located.' }
      }
      const baseline = await probe()
      if (baseline.signIn) {
        return { kind: 'sign-in' }
      }
      await enterAndSubmit(located, sql)
      return await waitForOutcome(baseline, signal)
    } catch (error) {
      located = null
      return isTabOpen() ? { kind: 'error', message: messageOf(error) } : { kind: 'tab-closed' }
    }
  }

  async function readResult(maskText: (text: string) => string): Promise<ConsoleResultText> {
    try {
      const parsed = consoleResultSchema.parse(
        await evaluateValue(buildReadResultScript(hints?.resultSelector))
      )
      const text = parsed.rows.map((row) => row.map(maskText).join('\t')).join('\n')
      return { ok: true, found: parsed.found, text }
    } catch (error) {
      return { ok: false, message: messageOf(error) }
    }
  }

  async function restoreOverlays(): Promise<boolean> {
    try {
      parseRestoreReport(await evaluateValue(RESTORE_REDACTION_SCRIPT))
      return true
    } catch {
      return false
    }
  }

  async function captureBlurred(
    sensitiveValues: readonly string[]
  ): Promise<ConsoleScreenshotBody> {
    let blurredCount = 0
    if (sensitiveValues.length > 0) {
      const report = parseRedactionReport(
        await evaluateValue(
          buildRedactionScript({ sensitiveValues, resultSelector: hints?.resultSelector })
        )
      )
      blurredCount = report.covered
      const blocked = redactionBlocksScreenshot(report)
      if (blocked) {
        return { kind: 'withheld', reason: blocked, blurredCount }
      }
    }
    const shot = await bridge.screenshot('png', worktreeId, browserPageId)
    return { kind: 'captured', data: shot.data, format: shot.format, blurredCount }
  }

  async function captureScreenshot(
    sensitiveValues: readonly string[]
  ): Promise<ConsoleScreenshotOutcome> {
    let outcome: ConsoleScreenshotBody
    try {
      outcome = await captureBlurred(sensitiveValues)
    } catch (error) {
      outcome = { kind: 'failed', message: messageOf(error) }
    } finally {
      // Why: the page must be left as the user had it even when capture throws.
      overlaysRestored = sensitiveValues.length === 0 ? true : await restoreOverlays()
    }
    return { ...outcome, overlaysRestored }
  }

  return { locate, isTabOpen, runQuery, readResult, captureScreenshot }
}
