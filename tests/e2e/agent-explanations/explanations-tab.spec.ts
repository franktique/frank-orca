/**
 * Agent explanations: the Explanations tab, legend, file labels, diff markers and cards.
 * Covers quickstart rows US1-1..US1-6 and the binary file-level edge case.
 */

import type { ElectronApplication, Page } from '@stablyai/playwright-test'
import { test, expect } from '../helpers/orca-app'
import { waitForSessionReady } from '../helpers/store'
import { attachRepoAndOpenTerminal, createRestartSession } from '../helpers/orca-restart'
import {
  createExplanationRepo,
  runOrcaCli,
  twoChangePayload,
  type ExplanationRepo
} from '../helpers/explanation-fixture'

const explanationsTab = (page: Page) =>
  page.getByRole('button', { name: 'Explanations', exact: true })

test('publishing shows the tab, labels, markers and inline cards', async (// oxlint-disable-next-line no-empty-pattern -- Playwright's second fixture arg is testInfo; the first must be an object destructure to opt out of the default fixture set.
{}, testInfo) => {
  test.setTimeout(240_000)
  const repo: ExplanationRepo = createExplanationRepo()
  const session = createRestartSession(testInfo)
  let app: ElectronApplication | null = null
  try {
    const launched = await session.launch()
    app = launched.app
    const page = launched.page
    await waitForSessionReady(page)
    const worktreeId = await attachRepoAndOpenTerminal(page, repo.repoPath)
    await page.evaluate(() => window.__store?.getState().setRightSidebarOpen(true))
    const selector = ['--worktree', `id:${worktreeId}`]

    // US1-1: nothing published yet, so no tab.
    await expect(explanationsTab(page)).toHaveCount(0)

    const changes = await runOrcaCli(session.userDataDir, [
      'explain',
      'changes',
      ...selector,
      '--json'
    ])
    expect(changes.code).toBe(0)
    expect(changes.stdout).toContain('src/new-name.ts')

    // US1-2: publish; the tab appears without a reload.
    const published = await runOrcaCli(
      session.userDataDir,
      ['explain', 'publish', '--input-stdin', ...selector, '--json'],
      twoChangePayload()
    )
    expect(published.code).toBe(0)
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: shape is asserted by the expectations that follow.
    const result = JSON.parse(published.stdout).result as {
      published: boolean
      rejected: { code: string }[]
    }
    expect(result.published).toBe(true)
    expect(result.rejected.map((issue) => issue.code).sort()).toEqual([
      'file_not_in_change_set',
      'line_out_of_range'
    ])
    await expect(explanationsTab(page)).toBeVisible({ timeout: 2_000 })
    await explanationsTab(page).click()

    const panel = page.getByTestId('explanations-panel')
    await expect(panel).toBeVisible()
    await expect(panel).toContainText('e2e-agent')
    const legend = panel.getByTestId('explanation-legend-row')
    await expect(legend).toHaveCount(2)
    await expect(legend.nth(0)).toContainText('Retry policy')
    await expect(legend.nth(1)).toContainText('Settings toggle')

    // US1-3: src/a.ts carries both labels; changed files nobody explained sit under Unexplained.
    const aRow = panel.locator('[data-explanation-path="src/a.ts"]')
    await expect(aRow.getByTestId('explanation-file-label')).toHaveText(['A1', 'B1'])
    await expect(panel.getByTestId('explanation-unexplained-header')).toBeVisible()
    await expect(panel.locator('[data-explanation-path="src/c.ts"]')).toHaveCount(0)
    await expect(panel.locator('[data-explanation-path="src/new-name.ts"]')).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('explanations-panel.png') })

    // US1-6: focusing change B lists only B's files.
    await legend.nth(1).click()
    await expect(panel.getByTestId('explanation-file-row')).toHaveCount(1)
    await expect(aRow.getByTestId('explanation-file-label')).toHaveText(['B1'])
    await legend.nth(1).click()
    await expect(aRow.getByTestId('explanation-file-label')).toHaveText(['A1', 'B1'])

    // US1-4/5: the diff shows the circles; a click opens the card with rendered markdown.
    await aRow.click()
    const markerA = page.getByTestId('explanation-marker').filter({ hasText: 'A1.1' })
    const markerB = page.getByTestId('explanation-marker').filter({ hasText: 'B1.1' })
    await expect(markerA).toBeVisible({ timeout: 20_000 })
    await expect(markerB).toBeVisible()
    await markerA.click()
    const card = page.getByTestId('explanation-card')
    await expect(card).toContainText('Why')
    await expect(card.locator('strong')).toHaveText('A1.1')
    await page.screenshot({ path: testInfo.outputPath('explanation-card.png') })
    await markerA.click()
    await expect(card).toHaveCount(0)

    // Edge: a binary file's item has no line to point at, so it is listed without circles.
    await panel.locator('[data-explanation-path="assets/logo.bin"]').click()
    await expect(page.getByTestId('explanation-detached-list')).toContainText(
      'The logo was regenerated.'
    )
    await expect(page.getByTestId('explanation-marker')).toHaveCount(0)
  } finally {
    if (app) {
      try {
        await session.close(app)
      } catch {
        // best-effort cleanup
      }
    }
    await session.dispose()
    repo.dispose()
  }
})
