/**
 * Agent explanations: Next/Previous walk every item in label order, opening each file
 * automatically (SC-003).
 */

import type { ElectronApplication, Page } from '@stablyai/playwright-test'
import { test, expect } from '../helpers/orca-app'
import { waitForSessionReady } from '../helpers/store'
import { attachRepoAndOpenTerminal, createRestartSession } from '../helpers/orca-restart'
import {
  createExplanationRepo,
  runOrcaCli,
  type ExplanationRepo
} from '../helpers/explanation-fixture'

const walkthroughPayload = JSON.stringify({
  version: 1,
  agent: 'e2e-agent',
  changes: [
    {
      title: 'First change',
      summary: '',
      files: [
        {
          path: 'src/a.ts',
          items: [
            { startLine: 3, text: 'A1.1 text' },
            { startLine: 8, text: 'A1.2 text' }
          ]
        },
        { path: 'src/b.ts', items: [{ startLine: 4, text: 'A2.1 text' }] }
      ]
    },
    {
      title: 'Second change',
      summary: '',
      files: [
        { path: 'src/new-name.ts', items: [{ startLine: 1, text: 'B1.1 text' }] },
        { path: 'src/a.ts', items: [{ startLine: 10, text: 'B2.1 text' }] }
      ]
    }
  ]
})

const position = (page: Page) => page.getByTestId('explanation-nav-position')
const modifier = process.platform === 'darwin' ? 'Meta' : 'Control'

test('Next walks every item across files and changes without opening a file by hand', async (// oxlint-disable-next-line no-empty-pattern -- Playwright's second fixture arg is testInfo; the first must be an object destructure to opt out of the default fixture set.
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

    const published = await runOrcaCli(
      session.userDataDir,
      ['explain', 'publish', '--input-stdin', '--worktree', `id:${worktreeId}`, '--json'],
      walkthroughPayload
    )
    expect(published.code).toBe(0)

    await page.getByRole('button', { name: 'Explanations', exact: true }).click()
    await page.locator('[data-explanation-path="src/a.ts"]').click()
    await page
      .getByTestId('explanation-marker')
      .filter({ hasText: 'A1.1' })
      .click({ timeout: 20_000 })
    await expect(position(page)).toHaveText('A1.1 · 1 of 5')

    const next = page.getByTestId('explanation-nav-next')
    for (const expected of ['A1.2 · 2 of 5', 'A2.1 · 3 of 5', 'B1.1 · 4 of 5', 'B2.1 · 5 of 5']) {
      await next.click()
      await expect(position(page)).toHaveText(expected, { timeout: 20_000 })
    }
    await expect(next).toBeDisabled()
    await page.screenshot({ path: testInfo.outputPath('reading-order-last.png') })

    // The last step opened a.ts again, and the shortcut walks backwards too.
    await page.keyboard.press(`${modifier}+Alt+Comma`)
    await expect(position(page)).toHaveText('B1.1 · 4 of 5', { timeout: 20_000 })
    await page.keyboard.press(`${modifier}+Alt+Period`)
    await expect(position(page)).toHaveText('B2.1 · 5 of 5', { timeout: 20_000 })
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
