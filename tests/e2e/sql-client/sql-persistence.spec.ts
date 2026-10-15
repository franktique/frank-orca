/**
 * Project-scoped SQL data across worktrees and projects (quickstart scenarios 18-19; FR-029,
 * FR-031, US5-4..US5-6): worktrees of one repo share connections and queries, another project
 * does not, closing a tab drops its draft, and removing a worktree keeps `sql-client/` data.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, realpathSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ElectronApplication, Page } from '@stablyai/playwright-test'
import { test, expect } from '../helpers/orca-app'
import { waitForSessionReady } from '../helpers/store'
import { attachRepoAndOpenTerminal, createRestartSession } from '../helpers/orca-restart'
import { createScratchDatabase } from './scratch-database'
import {
  openSqlTab,
  readSeedRepoPath,
  readSqlTabDraft,
  seedConnection,
  sqlTabIds
} from './sql-e2e-setup'

type Snapshot = {
  connections: { name: string }[]
  queries: { name: string }[]
}

function snapshotOf(page: Page, worktreeId: string): Promise<Snapshot | null> {
  return page.evaluate(async (id) => {
    const result = await window.api.sqlClient.getSnapshot({ worktreeId: id })
    return result.ok ? { connections: result.connections, queries: result.queries } : null
  }, worktreeId)
}

function createGitRepo(): string {
  const dir = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'orca-e2e-sql-other-')))
  const git = (...args: string[]): void => {
    execFileSync('git', args, { cwd: dir, stdio: 'ignore' })
  }
  git('init', '-b', 'main')
  git('config', 'user.email', 'e2e@example.com')
  git('config', 'user.name', 'e2e')
  writeFileSync(path.join(dir, 'README.md'), 'other\n')
  git('add', '.')
  git('commit', '-m', 'init')
  return dir
}

test('SQL data follows the project, not the worktree or the tab', async (// oxlint-disable-next-line no-empty-pattern -- Playwright's second fixture arg is testInfo; the first must be an object destructure to opt out of the default fixture set.
{}, testInfo) => {
  test.setTimeout(300_000)
  test.skip(!process.env.ORCA_TEST_PG_URL, 'ORCA_TEST_PG_URL is not set')
  const repoPath = readSeedRepoPath()
  test.skip(!repoPath || !existsSync(repoPath), 'Global setup did not produce a seeded test repo')

  const db = await createScratchDatabase()
  const session = createRestartSession(testInfo)
  const otherRepo = createGitRepo()
  let app: ElectronApplication | null = null
  try {
    const launched = await session.launch()
    app = launched.app
    const page = launched.page
    await waitForSessionReady(page)
    const firstWorktreeId = await attachRepoAndOpenTerminal(page, repoPath)
    const connectionId = await seedConnection(page, firstWorktreeId, db, 'Shared DB')
    await page.evaluate(
      ({ id, connection }) =>
        window.api.sqlClient.saveQuery({
          worktreeId: id,
          connectionId: connection,
          collectionId: null,
          name: 'Saved one',
          sql: 'select 1'
        }),
      { id: firstWorktreeId, connection: connectionId }
    )

    // Scenario 18: a second worktree of the same repo sees the same data.
    const secondWorktreeId = await page.evaluate(async (firstId) => {
      const state = window.__store?.getState()
      const first = state?.getKnownWorktreeById(firstId)
      if (!state || !first) {
        throw new Error('first worktree unknown')
      }
      const created = await state.createWorktree(first.repoId, `sql-e2e-${Date.now()}`)
      await state.fetchWorktrees(first.repoId)
      return created.worktree.id
    }, firstWorktreeId)
    const second = await snapshotOf(page, secondWorktreeId)
    expect(second?.connections.map((c) => c.name)).toEqual(['Shared DB'])
    expect(second?.queries.map((q) => q.name)).toEqual(['Saved one'])

    // ...while another project sees none of it.
    const otherWorktreeId = await page.evaluate(async (otherPath) => {
      const added = await window.api.repos.add({ path: otherPath })
      if ('error' in added) {
        throw new Error(added.error)
      }
      const state = window.__store?.getState()
      await state?.fetchRepos()
      await state?.fetchWorktrees(added.repo.id)
      const worktree = window.__store?.getState().worktreesByRepo[added.repo.id]?.[0]
      if (!worktree) {
        throw new Error('other repo has no worktree')
      }
      return worktree.id
    }, otherRepo)
    const other = await snapshotOf(page, otherWorktreeId)
    expect(other).toMatchObject({ connections: [], queries: [] })

    // FR-029: switching branches in a worktree keeps its SQL tab drafts.
    await page.evaluate((id) => window.__store?.getState().setActiveWorktree(id), secondWorktreeId)
    const draftTabId = await openSqlTab(page, {
      connectionId,
      draftText: 'select 42 -- keep me'
    })
    const secondPath = await page.evaluate(
      (id) => window.__store?.getState().getKnownWorktreeById(id)?.path ?? '',
      secondWorktreeId
    )
    execFileSync('git', ['checkout', '-b', 'sql-e2e-branch'], {
      cwd: secondPath,
      stdio: 'ignore'
    })
    await page.evaluate(async (id) => {
      const state = window.__store?.getState()
      const repoId = state?.getKnownWorktreeById(id)?.repoId
      if (repoId) {
        await state?.fetchWorktrees(repoId)
      }
    }, secondWorktreeId)
    expect(await readSqlTabDraft(page, draftTabId)).toBe('select 42 -- keep me')

    // Scenario 19: closing a tab drops its draft; the saved query stays.
    await page.evaluate((id) => window.__store?.getState().closeUnifiedTab(id), draftTabId)
    await expect.poll(async () => (await sqlTabIds(page)).includes(draftTabId)).toBe(false)
    const reopenedId = await openSqlTab(page, { connectionId })
    expect(await readSqlTabDraft(page, reopenedId)).toBe('')
    expect((await snapshotOf(page, secondWorktreeId))?.queries.map((q) => q.name)).toEqual([
      'Saved one'
    ])

    // US5-6: removing one worktree drops only its tab drafts; project data stays on disk.
    await setDraft(page, reopenedId, 'select 7 -- second worktree only')
    await page.evaluate((id) => window.__store?.getState().setActiveWorktree(id), firstWorktreeId)
    const firstTabId = await openSqlTab(page, {
      connectionId,
      draftText: 'select 8 -- first'
    })
    const removed = await page.evaluate(async (id) => {
      const state = window.__store?.getState()
      return state?.removeWorktree(
        { id, executionHostId: state.getKnownWorktreeById(id)?.hostId ?? null },
        true
      )
    }, secondWorktreeId)
    expect(removed?.ok).toBe(true)
    await expect.poll(async () => (await sqlTabIds(page)).includes(reopenedId)).toBe(false)
    expect(await readSqlTabDraft(page, firstTabId)).toBe('select 8 -- first')
    expect((await snapshotOf(page, firstWorktreeId))?.connections.map((c) => c.name)).toEqual([
      'Shared DB'
    ])
    const sqlRoot = path.join(session.userDataDir, 'sql-client')
    expect(readdirSync(sqlRoot).filter((entry) => !entry.startsWith('.'))).not.toHaveLength(0)
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

function setDraft(page: Page, tabId: string, draftText: string): Promise<void> {
  return page.evaluate(
    ({ id, value }) => window.__store?.getState().updateSqlTab(id, { draftText: value }),
    { id: tabId, value: draftText }
  )
}
