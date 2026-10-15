/**
 * Deleting a connection used by two SQL tabs (quickstart scenario 20, FR-009): its saved queries
 * and collections go away, and both tabs fall back to "No connection" with their text kept.
 */

import { existsSync, readFileSync } from 'node:fs'
import type { ElectronApplication } from '@stablyai/playwright-test'
import { test, expect } from '../helpers/orca-app'
import { waitForSessionReady } from '../helpers/store'
import { attachRepoAndOpenTerminal, createRestartSession } from '../helpers/orca-restart'
import { TEST_REPO_PATH_FILE } from '../global-setup'
import { createScratchDatabase } from './scratch-database'

test('deleting a shared connection clears its queries and detaches both tabs', async (// oxlint-disable-next-line no-empty-pattern -- Playwright's second fixture arg is testInfo; the first must be an object destructure to opt out of the default fixture set.
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

    const connectionId = await page.evaluate(
      async ({ worktreeId: id, db: d }) => {
        const api = window.api.sqlClient
        const created = await api.createConnection({
          worktreeId: id,
          input: {
            name: 'Shared DB',
            host: d.host,
            port: d.port,
            user: d.user,
            database: d.database,
            sslMode: 'disable',
            password: d.password
          }
        })
        if (!created.ok) {
          throw new Error('createConnection failed')
        }
        const connection = created.connection.id
        const collection = await api.createCollection({
          worktreeId: id,
          connectionId: connection,
          name: 'Reports'
        })
        if (!collection.ok) {
          throw new Error('createCollection failed')
        }
        for (const [name, collectionId] of [
          ['Q one', collection.collection.id],
          ['Q two', null]
        ] as const) {
          await api.saveQuery({
            worktreeId: id,
            connectionId: connection,
            collectionId,
            name,
            sql: 'select 1'
          })
        }
        return connection
      },
      {
        worktreeId,
        db: {
          host: db.host,
          port: db.port,
          user: db.user,
          database: db.database,
          password: db.password
        }
      }
    )

    for (const text of ['select 11', 'select 22']) {
      await page.getByRole('button', { name: 'New tab', exact: true }).first().click()
      await page.getByRole('menuitem', { name: 'New SQL' }).click()
      await expect(page.locator('[data-sql-sidebar]')).toBeVisible()
      await page.evaluate(
        ({ id, value, target }) => {
          const state = window.__store?.getState()
          if (!state) {
            throw new Error('no store')
          }
          const tabs = Object.values(state.sqlTabsById)
          const tab = tabs.find((t) => t.draftText === '' && t.connectionId === null) ?? tabs[0]
          state.updateSqlTab(tab.tabId, { draftText: value, connectionId: target })
          return id
        },
        { id: worktreeId, value: text, target: connectionId }
      )
    }
    await page.evaluate((id) => window.__store?.getState().loadSqlSnapshot(id), worktreeId)

    const sidebar = page.locator('[data-sql-sidebar]')
    await sidebar.getByText('Shared DB').hover()
    await sidebar.getByRole('button', { name: 'Delete' }).first().click({ force: true })
    await expect(page.getByRole('dialog')).toContainText('2 saved queries and 1 collections')
    await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click()

    await expect(sidebar.getByText('No connections yet.')).toBeVisible({ timeout: 10_000 })
    const tabs = await page.evaluate(() =>
      Object.values(window.__store?.getState().sqlTabsById ?? {}).map((t) => ({
        connectionId: t.connectionId,
        draftText: t.draftText
      }))
    )
    expect(tabs.length).toBeGreaterThanOrEqual(2)
    expect(tabs.map((t) => t.connectionId)).toEqual(tabs.map(() => null))
    expect(tabs.map((t) => t.draftText).sort()).toEqual(['select 11', 'select 22'])
    const snapshot = await page.evaluate(
      (id) => window.api.sqlClient.getSnapshot({ worktreeId: id }),
      worktreeId
    )
    expect(snapshot).toMatchObject({ ok: true, connections: [], queries: [], collections: [] })
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
