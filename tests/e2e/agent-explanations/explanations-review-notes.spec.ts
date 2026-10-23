/**
 * Agent explanations: a review note added in the explanation diff joins the workspace's
 * notes and shows on the same line in the Source Control diff, without explanation markers.
 */

import type { ElectronApplication, Page } from '@stablyai/playwright-test'
import { test, expect } from '../helpers/orca-app'
import { waitForSessionReady } from '../helpers/store'
import { attachRepoAndOpenTerminal, createRestartSession } from '../helpers/orca-restart'
import { createExplanationRepo, runOrcaCli } from '../helpers/explanation-fixture'

const payload = JSON.stringify({
  version: 1,
  changes: [
    {
      title: 'Change',
      summary: '',
      files: [{ path: 'src/a.ts', items: [{ startLine: 8, text: 'Explained line.' }] }]
    }
  ]
})

async function gutterPoint(page: Page, lineNumber: number): Promise<{ x: number; y: number }> {
  let point: { x: number; y: number } | null = null
  await expect
    .poll(async () => {
      point = await page.evaluate((target) => {
        const editor = document.querySelector('.monaco-editor.modified-in-monaco-diff-editor')
        for (const cell of editor?.querySelectorAll('.margin .line-numbers') ?? []) {
          if (Number.parseInt(cell.textContent?.trim() ?? '', 10) === target) {
            const rect = cell.getBoundingClientRect()
            return {
              x: Math.round(rect.x + rect.width / 2),
              y: Math.round(rect.y + rect.height / 2)
            }
          }
        }
        return null
      }, lineNumber)
      return point
    })
    .not.toBeNull()
  if (!point) {
    throw new Error('gutter line not rendered')
  }
  return point
}

test('a note added in the explanation diff shows in Source Control without markers', async (// oxlint-disable-next-line no-empty-pattern -- Playwright's second fixture arg is testInfo; the first must be an object destructure to opt out of the default fixture set.
{}, testInfo) => {
  test.setTimeout(240_000)
  const repo = createExplanationRepo()
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
      payload
    )
    expect(published.code).toBe(0)

    await page.getByRole('button', { name: 'Explanations', exact: true }).click()
    await page.locator('[data-explanation-path="src/a.ts"]').click()
    await expect(page.getByTestId('explanation-marker')).toHaveCount(1, { timeout: 20_000 })

    const line = await gutterPoint(page, 5)
    await page.mouse.move(line.x + 260, line.y)
    const add = page.locator('.orca-diff-comment-add-btn')
    await expect(add).toBeVisible()
    await add.click()
    await page.locator('.orca-diff-comment-popover-textarea').fill('review note from explanation')
    await page.keyboard.press('Enter')
    await expect(page.locator('.orca-diff-comment-card')).toContainText(
      'review note from explanation'
    )
    await expect
      .poll(() =>
        page.evaluate((id) => {
          const worktree = Object.values(window.__store?.getState().worktreesByRepo ?? {})
            .flat()
            .find((entry) => entry.id === id)
          return (worktree?.diffComments ?? []).map((c) => [c.filePath, c.lineNumber, c.scope])
        }, worktreeId)
      )
      .toEqual([['src/a.ts', 5, 'unstaged']])

    // The same file from Source Control: the note is there, the explanation circles are not.
    await page.evaluate(async (id) => {
      const state = window.__store?.getState()
      const worktree = Object.values(state?.worktreesByRepo ?? {})
        .flat()
        .find((entry) => entry.id === id)
      if (!state || !worktree) {
        throw new Error('worktree missing')
      }
      state.openDiff(id, `${worktree.path}/src/a.ts`, 'src/a.ts', 'typescript', false)
    }, worktreeId)
    await expect(page.locator('.orca-diff-comment-card')).toContainText(
      'review note from explanation'
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
