/**
 * Wide result grid stays virtualized and responsive (SC-003), and the SQL tab renders in both
 * themes (FR-010). Screenshots land in the test output directory.
 */

import { existsSync, readFileSync } from 'node:fs'
import type { ElectronApplication } from '@stablyai/playwright-test'
import { test, expect } from '../helpers/orca-app'
import { waitForSessionReady } from '../helpers/store'
import { attachRepoAndOpenTerminal, createRestartSession } from '../helpers/orca-restart'
import { TEST_REPO_PATH_FILE } from '../global-setup'
import { createScratchDatabase } from './scratch-database'

const COLUMNS = Array.from({ length: 40 }, (_, i) => `repeat('v', 12) || g as c${i}`).join(', ')
const WIDE_QUERY = `select ${COLUMNS} from generate_series(1, 1000) g`

test('1000x40 result renders virtualized and both themes render the SQL tab', async (// oxlint-disable-next-line no-empty-pattern -- Playwright's second fixture arg is testInfo; the first must be an object destructure to opt out of the default fixture set.
{}, testInfo) => {
  test.setTimeout(240_000)
  test.skip(!process.env.ORCA_TEST_PG_URL, 'ORCA_TEST_PG_URL is not set')
  const repoPath = existsSync(TEST_REPO_PATH_FILE)
    ? readFileSync(TEST_REPO_PATH_FILE, 'utf-8').trim()
    : ''
  test.skip(!repoPath || !existsSync(repoPath), 'Global setup did not produce a seeded test repo')

  const db = await createScratchDatabase()
  const session = createRestartSession(testInfo)
  let app: ElectronApplication | null = null
  try {
    const launched = await session.launch()
    app = launched.app
    const page = launched.page
    await waitForSessionReady(page)
    const worktreeId = await attachRepoAndOpenTerminal(page, repoPath)

    await page.evaluate(
      async ({ id, d }) => {
        const created = await window.api.sqlClient.createConnection({
          worktreeId: id,
          input: { name: 'Wide DB', sslMode: 'disable', ...d }
        })
        if (!created.ok) {
          throw new Error('createConnection failed')
        }
        await window.__store?.getState().loadSqlSnapshot(id)
      },
      {
        id: worktreeId,
        d: {
          host: db.host,
          port: db.port,
          user: db.user,
          database: db.database,
          password: db.password
        }
      }
    )
    await page.getByRole('button', { name: 'New tab', exact: true }).first().click()
    await page.getByRole('menuitem', { name: 'New SQL' }).click()
    await expect(page.locator('[data-sql-sidebar]')).toBeVisible()
    await page.evaluate((query) => {
      const state = window.__store?.getState()
      const tab = state && Object.values(state.sqlTabsById)[0]
      const connection = state && Object.values(state.sqlSnapshotsByProject)[0]?.connections[0]
      if (!state || !tab || !connection) {
        throw new Error('missing SQL state')
      }
      state.updateSqlTab(tab.tabId, { draftText: query, connectionId: connection.id })
    }, WIDE_QUERY)

    const started = Date.now()
    await expect(page.getByRole('button', { name: 'Run' })).toBeEnabled({ timeout: 10_000 })
    await page.getByRole('button', { name: 'Run' }).click()
    await expect(page.getByText('1000 rows', { exact: true })).toBeVisible({ timeout: 30_000 })
    const renderMs = Date.now() - started
    testInfo.annotations.push({ type: 'render-ms', description: String(renderMs) })

    const grid = page.getByRole('grid', { name: 'Query results' })
    const mounted = async (): Promise<number> => grid.getByRole('row').count()
    expect(await mounted()).toBeLessThan(120)
    const frames = await grid.evaluate(async (el) => {
      const times: number[] = []
      let last = performance.now()
      for (let step = 0; step < 40; step += 1) {
        el.scrollTop = (el.scrollHeight / 40) * step
        el.scrollLeft = step % 2 === 0 ? 0 : el.scrollWidth
        await new Promise((resolve) => requestAnimationFrame(resolve))
        const now = performance.now()
        times.push(now - last)
        last = now
      }
      return Math.max(...times)
    })
    expect(frames).toBeLessThan(250)
    expect(await mounted()).toBeLessThan(120)
    await grid.evaluate((el) => {
      el.scrollTop = el.scrollHeight
    })
    await expect(grid.getByRole('rowheader', { name: '1000', exact: true })).toBeVisible()

    for (const theme of ['light', 'dark'] as const) {
      await page.evaluate(
        (value) => window.__store?.getState().updateSettingsOrThrow({ theme: value }),
        theme
      )
      await expect
        .poll(() => page.evaluate(() => document.documentElement.classList.contains('dark')))
        .toBe(theme === 'dark')
      await page.screenshot({ path: testInfo.outputPath(`sql-tab-${theme}.png`) })
      await page.getByRole('button', { name: 'Add connection' }).click()
      await expect(page.getByRole('dialog')).toBeVisible()
      await page.screenshot({ path: testInfo.outputPath(`sql-dialog-${theme}.png`) })
      await page.keyboard.press('Escape')
      await expect(page.getByRole('dialog')).toBeHidden()
    }
    testInfo.annotations.push({ type: 'max-frame-ms', description: String(Math.round(frames)) })
  } finally {
    if (app) {
      try {
        await session.close(app)
      } catch {
        // best-effort cleanup
      }
    }
    await session.dispose()
    await db.drop()
  }
})
