/**
 * Selection run, cancel, and grid copy (quickstart scenarios 5, 8, 10; FR-011, FR-013, FR-019).
 */

import { existsSync } from 'node:fs'
import type { ElectronApplication } from '@stablyai/playwright-test'
import { test, expect } from '../helpers/orca-app'
import { waitForSessionReady } from '../helpers/store'
import { attachRepoAndOpenTerminal, createRestartSession } from '../helpers/orca-restart'
import { createScratchDatabase } from './scratch-database'
import {
  openSqlTab,
  readSeedRepoPath,
  readSqlTabDraft,
  seedConnection,
  setSqlTab,
  sqlTabIds
} from './sql-e2e-setup'

const IS_MAC = process.platform === 'darwin'
const MOD = IS_MAC ? 'Meta' : 'Control'

test('selection runs alone, Cancel ends a long query, and ranges copy as TSV', async (// oxlint-disable-next-line no-empty-pattern -- Playwright's second fixture arg is testInfo; the first must be an object destructure to opt out of the default fixture set.
{}, testInfo) => {
  test.setTimeout(300_000)
  test.skip(!process.env.ORCA_TEST_PG_URL, 'ORCA_TEST_PG_URL is not set')
  const repoPath = readSeedRepoPath()
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
    const connectionId = await seedConnection(page, worktreeId, db, 'Controls DB')
    const runTabId = await openSqlTab(page, {
      connectionId,
      draftText: "select 'first_only' as pick;\nselect 'second_only' as pick;"
    })

    // Scenario 5: select the first statement in the editor, press F5; only it runs.
    await page.locator('.monaco-editor').first().click()
    await page.keyboard.press(`${MOD}+a`)
    await page.keyboard.press('ArrowUp')
    await page.keyboard.press('Home')
    await page.keyboard.press('Shift+End')
    await page.keyboard.press('F5')
    await expect(page.getByRole('gridcell', { name: 'first_only' })).toBeVisible({
      timeout: 15_000
    })
    await expect(page.getByRole('gridcell', { name: 'second_only' })).toHaveCount(0)

    // Scenario 10: range, row and column copies are TSV with a header row.
    await setSqlTab(page, runTabId, {
      draftText: "select g as n, 'row' || g as label from generate_series(1, 3) g"
    })
    await page.getByRole('button', { name: 'Run', exact: true }).click()
    await expect(page.getByRole('gridcell', { name: 'row3' })).toBeVisible({
      timeout: 15_000
    })
    const clipboard = (): Promise<string> =>
      app!.evaluate(({ clipboard: board }) => board.readText())

    await page.getByRole('gridcell', { name: '1', exact: true }).first().click()
    await page.getByRole('gridcell', { name: 'row2' }).click({ modifiers: ['Shift'] })
    await page.keyboard.press(`${MOD}+c`)
    await expect.poll(clipboard).toBe('n\tlabel\n1\trow1\n2\trow2')

    await page.getByRole('rowheader', { name: '3', exact: true }).click()
    await page.keyboard.press(`${MOD}+c`)
    await expect.poll(clipboard).toBe('n\tlabel\n3\trow3')

    await page.getByRole('columnheader', { name: /^label/ }).click()
    await page.keyboard.press(`${MOD}+c`)
    await expect.poll(clipboard).toBe('label\nrow1\nrow2\nrow3')

    // Scenario 8: Cancel ends pg_sleep(60) as "cancelled"; another SQL tab stays responsive.
    await setSqlTab(page, runTabId, { draftText: 'select pg_sleep(60)' })
    await page.getByRole('button', { name: 'Run', exact: true }).click()
    const otherTabId = await openSqlTab(page, { connectionId })
    expect(await sqlTabIds(page)).toContain(otherTabId)
    await setSqlTab(page, otherTabId, { draftText: 'select 1' })
    await expect.poll(() => readSqlTabDraft(page, otherTabId)).toBe('select 1')

    await page.evaluate((id) => window.__store?.getState().activateTab(id), runTabId)
    const cancel = page.getByRole('button', { name: 'Cancel', exact: true }).first()
    await expect(cancel).toBeVisible({ timeout: 10_000 })
    const cancelledAt = Date.now()
    await cancel.click()
    await expect(page.getByText('Query cancelled')).toBeVisible({
      timeout: 5_000
    })
    expect(Date.now() - cancelledAt).toBeLessThan(5_000)
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
