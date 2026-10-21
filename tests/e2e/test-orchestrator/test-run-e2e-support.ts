/**
 * Shared setup for the test-orchestrator specs: fixture import, a run driver over the preload
 * API, and a main-process monitor proving no window was shown or focused (SC-008).
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import type { ElectronApplication, Page } from '@stablyai/playwright-test'
import type { TestRun } from '../../../src/shared/test-orchestrator/test-orchestrator-types'

export const TOKEN = 'tok-secret-e2e-9f3a'
// Why: specs run from the repo root, and `import.meta` is unavailable in the CJS test loader.
export const FIXTURES_DIR = path.join(
  process.cwd(),
  'src',
  'shared',
  'test-orchestrator',
  '__fixtures__'
)
export const fixturePath = (name: string): string => path.join(FIXTURES_DIR, name)

export type ImportedPlan = { collectionId: string; environmentId: string }

/** Imports the smoke-plan collection and environment, returning their stored ids. */
export async function importSmokePlan(page: Page, worktreeId: string): Promise<ImportedPlan> {
  for (const name of [
    'smoke-plan.postman_collection.json',
    'smoke-plan.postman_environment.json'
  ]) {
    const imported = await page.evaluate(
      ([worktreeId, filePath]) => window.api.apiClient.importFile({ worktreeId, filePath }),
      [worktreeId, fixturePath(name)]
    )
    if (!imported.ok) {
      throw new Error(`Import of ${name} failed`)
    }
  }
  const snapshot = await page.evaluate(
    (worktreeId) => window.api.apiClient.getSnapshot({ worktreeId }),
    worktreeId
  )
  if (!snapshot.ok) {
    throw new Error('API Client snapshot failed')
  }
  const collection = snapshot.data.collections.find((c) => c.name === 'smoke-plan')
  const environment = snapshot.data.environments.find((e) => e.name === 'smoke-plan')
  if (!collection || !environment) {
    throw new Error('Imported smoke-plan collection or environment is missing')
  }
  return { collectionId: collection.id, environmentId: environment.id }
}

/** Starts a full run through the preload API and waits for it to finish. */
export async function runToFinish(
  page: Page,
  options: {
    worktreeId: string
    plan: ImportedPlan
    baseUrl: string
    database: { mode: 'manual' } | { mode: 'browser'; origin: string }
    browserPageId?: string
  }
): Promise<TestRun> {
  const { worktreeId, plan } = options
  const started = await page.evaluate(
    (args) =>
      window.api.testRun.start({
        worktreeId: args.worktreeId,
        collectionId: args.plan.collectionId,
        environmentId: args.plan.environmentId,
        kind: 'full',
        inputs: { host: args.baseUrl, tenantId: 'tenant-1', userToken: args.token },
        remember: { inputs: false, secrets: false },
        database: args.database,
        browserPageId: args.browserPageId,
        confirmedHosts: [new URL(args.baseUrl).hostname],
        approvedDataChanges: []
      }),
    {
      worktreeId,
      plan,
      baseUrl: options.baseUrl,
      token: TOKEN,
      database: options.database,
      browserPageId: options.browserPageId
    }
  )
  if (!started.ok) {
    throw new Error(`Run did not start: ${started.message}`)
  }
  const deadline = Date.now() + 120_000
  for (;;) {
    const run = await page.evaluate(
      (args) =>
        window.api.testRun.getRun({
          worktreeId: args.worktreeId,
          collectionId: args.plan.collectionId
        }),
      { worktreeId, plan }
    )
    if (run?.state === 'finished') {
      return run
    }
    if (Date.now() > deadline) {
      throw new Error(
        `Run did not finish in time (state=${run?.state}, pause=${run?.pause?.kind}/${run?.pause && 'problem' in run.pause ? run.pause.problem : ''}, step=${run?.currentStepIndex})`
      )
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
}

export const readReport = (run: TestRun): string => {
  if (!run.evidence) {
    throw new Error('Run has no evidence')
  }
  return readFileSync(run.evidence.reportPath, 'utf8')
}

/** Records every window show/focus in the main process from now on. */
export async function startWindowMonitor(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ app: electronApp, BrowserWindow }) => {
    const seen: string[] = []
    const watch = (window: Electron.BrowserWindow): void => {
      window.on('show', () => seen.push(`${window.id}:show`))
      window.on('focus', () => seen.push(`${window.id}:focus`))
    }
    BrowserWindow.getAllWindows().forEach(watch)
    electronApp.on('browser-window-created', (_event, window) => {
      watch(window)
      window.once('ready-to-show', () => {
        if (window.isVisible()) {
          seen.push(`${window.id}:visible-on-create`)
        }
      })
    })
    // Why: the page cannot read main-process state, so the events live on a global read back later.
    Object.assign(globalThis, { __orcaTestRunWindowEvents: seen })
  })
}

/** Every show/focus/visible-on-create event seen since `startWindowMonitor`. */
export async function readWindowMonitor(app: ElectronApplication): Promise<string[]> {
  return app.evaluate(() => {
    const events: unknown = Reflect.get(globalThis, '__orcaTestRunWindowEvents')
    return Array.isArray(events) ? events.map(String) : []
  })
}
