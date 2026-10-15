import { existsSync, readFileSync } from 'node:fs'
import type { Page } from '@stablyai/playwright-test'
import { expect } from '../helpers/orca-app'
import { TEST_REPO_PATH_FILE } from '../global-setup'
import type { ScratchDatabase } from './scratch-database'

export function readSeedRepoPath(): string {
  return existsSync(TEST_REPO_PATH_FILE) ? readFileSync(TEST_REPO_PATH_FILE, 'utf-8').trim() : ''
}

/** Creates a connection through the real IPC and returns its id. */
export async function seedConnection(
  page: Page,
  worktreeId: string,
  db: ScratchDatabase,
  name: string
): Promise<string> {
  return page.evaluate(
    async ({ id, name: connectionName, d }) => {
      const created = await window.api.sqlClient.createConnection({
        worktreeId: id,
        input: { name: connectionName, sslMode: 'disable', ...d }
      })
      if (!created.ok) {
        throw new Error('createConnection failed')
      }
      await window.__store?.getState().loadSqlSnapshot(id)
      return created.connection.id
    },
    {
      id: worktreeId,
      name,
      d: {
        host: db.host,
        port: db.port,
        user: db.user,
        database: db.database,
        password: db.password
      }
    }
  )
}

/** Opens a new SQL tab from '+', optionally bound to a connection with a draft; returns its id. */
export async function openSqlTab(
  page: Page,
  options: { connectionId?: string; draftText?: string } = {}
): Promise<string> {
  const before = await sqlTabIds(page)
  await page.getByRole('button', { name: 'New tab', exact: true }).first().click()
  await page.getByRole('menuitem', { name: 'New SQL' }).click()
  await expect(page.locator('[data-sql-sidebar]')).toBeVisible()
  await expect.poll(async () => (await sqlTabIds(page)).length).toBe(before.length + 1)
  const tabId = (await sqlTabIds(page)).find((id) => !before.includes(id))
  if (!tabId) {
    throw new Error('new SQL tab did not register')
  }
  await setSqlTab(page, tabId, options)
  return tabId
}

export function sqlTabIds(page: Page): Promise<string[]> {
  return page.evaluate(() => Object.keys(window.__store?.getState().sqlTabsById ?? {}))
}

export async function setSqlTab(
  page: Page,
  tabId: string,
  patch: { connectionId?: string; draftText?: string }
): Promise<void> {
  await page.evaluate(({ id, value }) => window.__store?.getState().updateSqlTab(id, value), {
    id: tabId,
    value: patch
  })
}

export async function readSqlTabDraft(page: Page, tabId: string): Promise<string | null> {
  return page.evaluate((id) => window.__store?.getState().sqlTabsById[id]?.draftText ?? null, tabId)
}
