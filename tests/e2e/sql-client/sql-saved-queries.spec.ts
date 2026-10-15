/**
 * Rename, move and delete saved queries, and delete a collection with its count shown
 * (quickstart scenario 14; US3-3, US3-4).
 */

import { existsSync } from 'node:fs'
import type { ElectronApplication } from '@stablyai/playwright-test'
import { test, expect } from '../helpers/orca-app'
import { waitForSessionReady } from '../helpers/store'
import { attachRepoAndOpenTerminal, createRestartSession } from '../helpers/orca-restart'
import { createScratchDatabase } from './scratch-database'
import { openSqlTab, readSeedRepoPath, seedConnection } from './sql-e2e-setup'

test('rename, move and delete saved queries and a collection', async (// oxlint-disable-next-line no-empty-pattern -- Playwright's second fixture arg is testInfo; the first must be an object destructure to opt out of the default fixture set.
{}, testInfo) => {
  test.setTimeout(240_000)
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
    const connectionId = await seedConnection(page, worktreeId, db, 'Queries DB')
    await page.evaluate(
      async ({ id, connection }) => {
        const api = window.api.sqlClient
        const made = await api.createCollection({
          worktreeId: id,
          connectionId: connection,
          name: 'Cleanup'
        })
        if (!made.ok) {
          throw new Error('createCollection failed')
        }
        for (const [name, collectionId] of [
          ['Alpha', null],
          ['Beta', made.collection.id]
        ] as const) {
          await api.saveQuery({
            worktreeId: id,
            connectionId: connection,
            collectionId,
            name,
            sql: `select '${name}'`
          })
        }
        await window.__store?.getState().loadSqlSnapshot(id)
      },
      { id: worktreeId, connection: connectionId }
    )
    await openSqlTab(page, { connectionId })
    const sidebar = page.locator('[data-sql-sidebar]')
    await expect(sidebar.getByText('Alpha', { exact: true })).toBeVisible({
      timeout: 10_000
    })

    const rowMenu = async (name: string, action: string): Promise<void> => {
      const row = sidebar.getByRole('listitem').filter({ hasText: name }).first()
      await row.hover()
      await row.getByRole('button', { name: 'Query actions' }).click({ force: true })
      await page.getByRole('menuitem', { name: action }).click()
    }

    // Rename.
    await rowMenu('Alpha', 'Rename')
    const renameDialog = page.getByRole('dialog')
    await renameDialog.getByLabel('Name').fill('Alpha renamed')
    await renameDialog.getByRole('button', { name: 'Rename' }).click()
    await expect(sidebar.getByText('Alpha renamed', { exact: true })).toBeVisible({
      timeout: 10_000
    })

    // Move into the collection.
    await rowMenu('Alpha renamed', 'Move to collection…')
    await page.getByRole('dialog').getByRole('combobox', { name: 'Collection' }).click()
    await page.getByRole('option', { name: 'Cleanup' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Move' }).click()
    await expect(sidebar.getByText('Cleanup').locator('..')).toContainText('2', {
      timeout: 10_000
    })

    // Delete one query after confirming.
    await rowMenu('Beta', 'Delete')
    await expect(page.getByRole('dialog')).toContainText('"Beta" will be deleted.')
    await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click()
    await expect(sidebar.getByText('Beta', { exact: true })).toHaveCount(0, {
      timeout: 10_000
    })

    // Delete the collection: the confirmation states its remaining query count.
    const collectionRow = sidebar.getByText('Cleanup').locator('xpath=ancestor::div[1]')
    await collectionRow.hover()
    await collectionRow.getByRole('button', { name: 'Collection actions' }).click({ force: true })
    await page.getByRole('menuitem', { name: 'Delete' }).click()
    await expect(page.getByRole('dialog')).toContainText('holds 1 saved queries')
    await page.getByRole('dialog').getByRole('button', { name: 'Delete queries too' }).click()
    await expect(sidebar.getByText('No saved queries yet.')).toBeVisible({
      timeout: 10_000
    })

    const snapshot = await page.evaluate(
      (id) => window.api.sqlClient.getSnapshot({ worktreeId: id }),
      worktreeId
    )
    expect(snapshot).toMatchObject({ ok: true, queries: [], collections: [] })
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
