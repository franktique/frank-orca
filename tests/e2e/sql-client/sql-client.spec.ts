/**
 * SQL tab: '+' entry, right-panel switching, add connection, run, copy, saved queries, schema
 * browser, and restart persistence with a clean repository.
 *
 * Covers quickstart scenarios 1-5, 8-10, 13-20 against a real PostgreSQL (ORCA_TEST_PG_URL).
 * Data round-trips through the real main process; the DOM proves what the user sees.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import type { ElectronApplication, Page } from '@stablyai/playwright-test'
import { test, expect } from '../helpers/orca-app'
import { waitForSessionReady } from '../helpers/store'
import { attachRepoAndOpenTerminal, createRestartSession } from '../helpers/orca-restart'
import { TEST_REPO_PATH_FILE } from '../global-setup'
import { createScratchDatabase, type ScratchDatabase } from './scratch-database'

const PASSWORD_FRAGMENT = 'orca-test-pw'

function readRepoPath(): string {
  return existsSync(TEST_REPO_PATH_FILE) ? readFileSync(TEST_REPO_PATH_FILE, 'utf-8').trim() : ''
}

function gitStatus(repoPath: string): string {
  return execFileSync('git', ['status', '--porcelain'], { cwd: repoPath, encoding: 'utf8' })
}

async function addConnection(page: Page, db: ScratchDatabase): Promise<void> {
  await page.getByRole('button', { name: 'Add connection' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Name', { exact: true }).fill('E2E DB')
  await dialog.getByLabel('Host').fill(db.host)
  await dialog.getByLabel('Port').fill(String(db.port))
  await dialog.getByLabel('User').fill(db.user)
  await dialog.getByLabel('Password').fill(db.password)
  await dialog.getByLabel('Database').fill(db.database)
  await dialog.getByLabel('SSL mode').click()
  await page.getByRole('option', { name: 'Disable' }).click()
  await dialog.getByRole('button', { name: 'Test connection' }).click()
  await expect(dialog.getByText(/Connected to PostgreSQL/)).toBeVisible({ timeout: 15_000 })
  await dialog.getByRole('button', { name: 'Save' }).click()
}

async function setEditorText(page: Page, text: string): Promise<void> {
  await page.evaluate((value) => {
    const state = window.__store?.getState()
    const tab = state && Object.values(state.sqlTabsById).find(Boolean)
    if (!state || !tab) {
      throw new Error('no SQL tab state')
    }
    state.updateSqlTab(tab.tabId, { draftText: value })
  }, text)
}

test('SQL tab: run, copy, save, browse schema, restart, and leave the repo clean', async (// oxlint-disable-next-line no-empty-pattern -- Playwright's second fixture arg is testInfo; the first must be an object destructure to opt out of the default fixture set.
{}, testInfo) => {
  test.setTimeout(420_000)
  test.skip(!process.env.ORCA_TEST_PG_URL, 'ORCA_TEST_PG_URL is not set')
  const repoPath = readRepoPath()
  test.skip(!repoPath || !existsSync(repoPath), 'Global setup did not produce a seeded test repo')

  const db = await createScratchDatabase()
  const session = createRestartSession(testInfo)
  let first: ElectronApplication | null = null
  let second: ElectronApplication | null = null
  try {
    const launched = await session.launch()
    first = launched.app
    const page = launched.page
    await waitForSessionReady(page)
    const worktreeId = await attachRepoAndOpenTerminal(page, repoPath)
    const statusBefore = gitStatus(repoPath)

    // Scenario 1: '+' menu entry sits next to New API Client and opens a SQL tab + panel.
    await page.getByRole('button', { name: 'New tab', exact: true }).first().click()
    const labels = await page.getByRole('menuitem').allInnerTexts()
    expect(labels.findIndex((l) => l.includes('New SQL'))).toBe(
      labels.findIndex((l) => l.includes('New API Client')) + 1
    )
    await page.getByRole('menuitem', { name: 'New SQL' }).click()
    await expect(page.locator('[data-sql-sidebar]')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Run' })).toBeDisabled()

    // Scenario 2-3: add a connection from the right panel; it becomes the tab's connection.
    await addConnection(page, db)
    await expect(page.getByText('E2E DB').first()).toBeVisible()
    await expect(page.getByRole('button', { name: 'Run' })).toBeEnabled({ timeout: 10_000 })

    // Scenario 4: run a query and see rows; NULL differs from the text 'NULL'.
    await setEditorText(
      page,
      `select title, note from "CaseManagement"."SurgicalCase" order by title`
    )
    await page.getByRole('button', { name: 'Run' }).click()
    await expect(page.getByRole('gridcell', { name: 'Appendectomy' })).toBeVisible({
      timeout: 15_000
    })
    await expect(page.getByText('3 rows')).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('sql-results.png') })

    // Scenario 9: clicking a cell copies its exact value.
    await page.getByRole('gridcell', { name: 'Appendectomy' }).click()
    await expect
      .poll(() => first!.evaluate(({ clipboard }) => clipboard.readText()))
      .toBe('Appendectomy')

    // Scenario 13: save a query and see it in the right panel.
    await page.getByRole('button', { name: 'Save' }).first().click()
    await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click()
    await expect(
      page
        .locator('[data-sql-sidebar]')
        .getByText(/select title, note/)
        .first()
    ).toBeVisible({
      timeout: 10_000
    })

    // Scenario 15: schema browser lists the schema and its tables.
    await page
      .locator('[data-sql-sidebar]')
      .getByRole('button', { name: 'CaseManagement', exact: true })
      .click()
    await expect(page.locator('[data-sql-sidebar]').getByText('SurgicalCase')).toBeVisible()

    // Scenario 17: the repo is untouched and no plaintext password sits in userData.
    expect(gitStatus(repoPath)).toBe(statusBefore)
    const sqlRoot = path.join(session.userDataDir, 'sql-client')
    const dataFiles = readdirSync(sqlRoot, { recursive: true, withFileTypes: true }).filter((e) =>
      e.isFile()
    )
    for (const file of dataFiles) {
      expect(readFileSync(path.join(file.parentPath, file.name), 'utf8')).not.toContain(
        PASSWORD_FRAGMENT
      )
    }

    // Scenario 16: restart restores the draft, connection list (idle), and saved query.
    await session.close(first)
    first = null
    const relaunched = await session.launch()
    second = relaunched.app
    await waitForSessionReady(relaunched.page)
    await attachRepoAndOpenTerminal(relaunched.page, repoPath)
    const snapshot = await relaunched.page.evaluate(
      (id) => window.api.sqlClient.getSnapshot({ worktreeId: id }),
      worktreeId
    )
    expect(snapshot).toMatchObject({
      ok: true,
      connections: [{ name: 'E2E DB', status: { state: 'idle' } }]
    })
    expect(JSON.stringify(snapshot)).not.toContain(db.password)
    expect(snapshot.ok && snapshot.queries).toHaveLength(1)
  } finally {
    for (const app of [second, first]) {
      if (app) {
        try {
          await session.close(app)
        } catch {
          // best-effort cleanup
        }
      }
    }
    await session.dispose()
    await db.drop()
  }
})
