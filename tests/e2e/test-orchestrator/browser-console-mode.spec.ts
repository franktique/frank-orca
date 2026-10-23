/**
 * Test orchestrator: Browser database mode against a fake web console open in an Orca tab.
 *
 * Covers quickstart scenarios 11-13: queries typed and run in the tab, screenshots in the
 * evidence, sensitive values blurred (or the screenshot withheld for canvas output), and no
 * window ever shown or focused (SC-008).
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { createServer } from 'node:http'
import path from 'node:path'
import type { Page } from '@stablyai/playwright-test'
import { expect, test } from '../helpers/orca-app'
import { attachRepoAndOpenTerminal } from '../helpers/orca-restart'
import { waitForSessionReady } from '../helpers/store'
import { startPlanEchoServer } from '../../../src/main/test-orchestrator/test-support/plan-echo-routes'
import {
  TOKEN,
  fixturePath,
  importSmokePlan,
  readReport,
  readWindowMonitor,
  runToFinish,
  startWindowMonitor
} from './test-run-e2e-support'
import { TEST_REPO_PATH_FILE } from '../global-setup'

const CONSOLE_HTML = path.join(
  process.cwd(),
  'tests',
  'e2e',
  'test-orchestrator',
  'fixtures',
  'fake-db-console.html'
)

async function serveConsole(): Promise<{ origin: string; close: () => Promise<void> }> {
  const html = readFileSync(CONSOLE_HTML)
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    response.end(html)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') {
    throw new Error('server did not report a TCP address')
  }
  const { port } = address
  return {
    origin: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      )
  }
}

async function openConsoleTab(page: Page, worktreeId: string, url: string): Promise<string> {
  const pageId = await page.evaluate(
    ({ worktreeId, url }) =>
      window.__store?.getState().createBrowserTab(worktreeId, url, {
        title: 'Fake DB console',
        activate: true
      })?.activePageId ?? null,
    { worktreeId, url }
  )
  if (!pageId) {
    throw new Error('Failed to open the console tab')
  }
  return pageId
}

for (const variant of [
  { name: 'blurs the token row', query: `token=${TOKEN}`, withheld: false },
  { name: 'withholds canvas output', query: `token=${TOKEN}&canvas=1`, withheld: true }
]) {
  test(`browser mode ${variant.name}`, async ({ electronApp, orcaPage }) => {
    test.setTimeout(240_000)
    const repoPath = existsSync(TEST_REPO_PATH_FILE)
      ? readFileSync(TEST_REPO_PATH_FILE, 'utf-8').trim()
      : ''
    test.skip(!repoPath || !existsSync(repoPath), 'Global setup did not produce a seeded test repo')

    const echo = await startPlanEchoServer()
    const consoleServer = await serveConsole()
    try {
      await waitForSessionReady(orcaPage)
      const worktreeId = await attachRepoAndOpenTerminal(orcaPage, repoPath)
      const plan = await importSmokePlan(orcaPage, worktreeId)
      const loaded = await orcaPage.evaluate((args) => window.api.testRun.loadTestMap(args), {
        worktreeId,
        collectionId: plan.collectionId,
        filePath: fixturePath('smoke-plan.test-map.json')
      })
      expect(loaded).toMatchObject({ ok: true })

      const browserPageId = await openConsoleTab(
        orcaPage,
        worktreeId,
        `${consoleServer.origin}/?${variant.query}`
      )
      await startWindowMonitor(electronApp)
      const run = await runToFinish(orcaPage, {
        worktreeId,
        plan,
        baseUrl: echo.baseUrl,
        database: { mode: 'browser', origin: consoleServer.origin },
        browserPageId
      })
      expect(run.databaseMode).toMatchObject({ mode: 'browser' })

      const report = readReport(run)
      expect(report).toContain('run in browser console')
      expect(report).not.toContain(TOKEN)
      if (variant.withheld) {
        expect(report).toContain('Screenshot withheld')
      } else {
        expect(report).toMatch(/\d+ sensitive values? blurred/)
        const images = readdirSync(path.join(run.evidence?.folder ?? '', 'images'))
        expect(images.some((name) => /(before|after)-\d+\.png$/.test(name))).toBe(true)
      }
      expect(await readWindowMonitor(electronApp)).toEqual([])
    } finally {
      await consoleServer.close()
      await echo.close()
    }
  })
}
