/**
 * Agent explanations: republish replaces, clear hides the tab, moved/deleted anchors are
 * flagged, and a default-branch workspace falls back to "uncommitted changes only".
 */

import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
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

const tab = (page: Page) => page.getByRole('button', { name: 'Explanations', exact: true })

const singleChangePayload = JSON.stringify({
  version: 1,
  agent: 'second-agent',
  changes: [
    {
      title: 'Only change',
      summary: '',
      files: [{ path: 'src/a.ts', items: [{ startLine: 8, text: 'Anchored on the edited line.' }] }]
    }
  ]
})

async function withApp(
  testInfo: Parameters<typeof createRestartSession>[0],
  repo: ExplanationRepo,
  run: (ctx: { page: Page; userDataDir: string; selector: string[] }) => Promise<void>
): Promise<void> {
  const session = createRestartSession(testInfo)
  let app: ElectronApplication | null = null
  try {
    const launched = await session.launch()
    app = launched.app
    await waitForSessionReady(launched.page)
    const worktreeId = await attachRepoAndOpenTerminal(launched.page, repo.repoPath)
    await launched.page.evaluate(() => window.__store?.getState().setRightSidebarOpen(true))
    await run({
      page: launched.page,
      userDataDir: session.userDataDir,
      selector: ['--worktree', `id:${worktreeId}`]
    })
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
}

test('republish replaces, and Clear removes the explanation and hides the tab', async (// oxlint-disable-next-line no-empty-pattern -- Playwright's second fixture arg is testInfo; the first must be an object destructure to opt out of the default fixture set.
{}, testInfo) => {
  test.setTimeout(240_000)
  await withApp(testInfo, createExplanationRepo(), async ({ page, userDataDir, selector }) => {
    const publish = (payload: string) =>
      runOrcaCli(
        userDataDir,
        ['explain', 'publish', '--input-stdin', ...selector, '--json'],
        payload
      )
    expect((await publish(twoChangePayload())).code).toBe(0)
    await tab(page).click()
    await expect(page.getByTestId('explanation-legend-row')).toHaveCount(2)

    // US5-1: a second publish fully replaces the first.
    expect((await publish(singleChangePayload)).code).toBe(0)
    await expect(page.getByTestId('explanation-legend-row')).toHaveCount(1)
    await expect(page.getByTestId('explanations-panel')).toContainText('second-agent')

    // US5-2: Clear from the header.
    await page.getByTestId('explanations-clear').click()
    await page.getByRole('button', { name: 'Clear', exact: true }).click()
    await expect(tab(page)).toHaveCount(0)
    const shown = await runOrcaCli(userDataDir, ['explain', 'show', ...selector, '--json'])
    expect(JSON.parse(shown.stdout).result.explanation).toBeNull()
  })
})

test('edited anchors are flagged outdated and deleted ones are listed as detached', async (// oxlint-disable-next-line no-empty-pattern -- Playwright's second fixture arg is testInfo; the first must be an object destructure to opt out of the default fixture set.
{}, testInfo) => {
  test.setTimeout(240_000)
  const repo = createExplanationRepo()
  await withApp(testInfo, repo, async ({ page, userDataDir, selector }) => {
    const published = await runOrcaCli(
      userDataDir,
      ['explain', 'publish', '--input-stdin', ...selector, '--json'],
      singleChangePayload
    )
    expect(published.code).toBe(0)
    await tab(page).click()
    const row = page.locator('[data-explanation-path="src/a.ts"]')
    await row.click()
    const marker = page.getByTestId('explanation-marker').filter({ hasText: 'A1.1' })
    await expect(marker).toBeVisible({ timeout: 20_000 })
    await expect(marker).toHaveAttribute('data-state', 'fresh')

    // US5-3: push the anchored line down, then reopen.
    const file = path.join(repo.repoPath, 'src', 'a.ts')
    const original = readFileSync(file, 'utf8')
    writeFileSync(file, `inserted one\ninserted two\n${original}`)
    await row.click()
    await expect(
      page.locator('.modified-in-monaco-diff-editor .view-line', { hasText: 'inserted one' })
    ).toHaveCount(1, { timeout: 20_000 })
    await expect(marker).toHaveAttribute('data-state', 'outdated', { timeout: 20_000 })

    // Delete the anchored code: no marker, a Detached list instead.
    writeFileSync(file, original.replace('a line 9 (uncommitted edit)\n', ''))
    await row.click()
    await expect(page.getByTestId('explanation-detached-heading')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByTestId('explanation-marker')).toHaveCount(0)
  })
})

test('a workspace on the default branch publishes against uncommitted changes only', async (// oxlint-disable-next-line no-empty-pattern -- Playwright's second fixture arg is testInfo; the first must be an object destructure to opt out of the default fixture set.
{}, testInfo) => {
  test.setTimeout(240_000)
  await withApp(
    testInfo,
    createExplanationRepo({ onDefaultBranch: true }),
    async ({ page, userDataDir, selector }) => {
      const published = await runOrcaCli(
        userDataDir,
        ['explain', 'publish', '--input-stdin', ...selector, '--json'],
        singleChangePayload
      )
      expect(published.code).toBe(0)
      expect(JSON.parse(published.stdout).result.changeSetBase.kind).toBe('uncommitted-only')
      await tab(page).click()
      await expect(page.getByTestId('explanations-panel')).toContainText('uncommitted changes only')
    }
  )
})
