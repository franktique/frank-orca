/**
 * Test orchestrator: load a test map, run it, and read the evidence bundle.
 *
 * Covers quickstart scenarios 1-8 end to end through the real main process. The run is driven
 * through the preload API; the DOM proves the loaded map is visible. Per SC-008, no window may
 * be shown or focused while the run captures its evidence screenshots.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
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

test('loads a test map, runs it in the background, and writes token-free evidence', async ({
  electronApp,
  orcaPage
}) => {
  test.setTimeout(240_000)
  const repoPath = existsSync(TEST_REPO_PATH_FILE)
    ? readFileSync(TEST_REPO_PATH_FILE, 'utf-8').trim()
    : ''
  test.skip(!repoPath || !existsSync(repoPath), 'Global setup did not produce a seeded test repo')

  const server = await startPlanEchoServer()
  try {
    await waitForSessionReady(orcaPage)
    const worktreeId = await attachRepoAndOpenTerminal(orcaPage, repoPath)
    const plan = await importSmokePlan(orcaPage, worktreeId)

    const loaded = await orcaPage.evaluate((args) => window.api.testRun.loadTestMap(args), {
      worktreeId,
      collectionId: plan.collectionId,
      filePath: fixturePath('smoke-plan.no-db.test-map.json')
    })
    expect(loaded).toMatchObject({ ok: true })

    await startWindowMonitor(electronApp)
    const run = await runToFinish(orcaPage, {
      worktreeId,
      plan,
      baseUrl: server.baseUrl,
      database: { mode: 'manual' }
    })
    expect(run.ending).toBe('passed')

    // Evidence: report.md exists, images sit beside it, and no token text leaked.
    const report = readReport(run)
    expect(report).toContain('SC-1')
    expect(report).not.toContain(TOKEN)
    const images = readdirSync(path.join(run.evidence?.folder ?? '', 'images'))
    expect(images.length).toBeGreaterThan(0)
    expect(images.every((name) => name.endsWith('.png'))).toBe(true)

    // SC-008: the snapshot window never appeared or took focus.
    expect(await readWindowMonitor(electronApp)).toEqual([])
  } finally {
    await server.close()
  }
})
