/**
 * Agent explanations: follow-up questions keep their draft and show as sent once delivered.
 * Prompt content is covered by unit tests; delivery to a live agent needs a real agent pane.
 */

import type { ElectronApplication } from '@stablyai/playwright-test'
import { test, expect } from '../helpers/orca-app'
import { waitForSessionReady } from '../helpers/store'
import { attachRepoAndOpenTerminal, createRestartSession } from '../helpers/orca-restart'
import { createExplanationRepo, runOrcaCli } from '../helpers/explanation-fixture'

const payload = JSON.stringify({
  version: 1,
  agent: 'e2e-agent',
  changes: [
    {
      title: 'Change',
      summary: '',
      files: [{ path: 'src/a.ts', items: [{ startLine: 8, text: 'Explained line.' }] }]
    }
  ]
})

test('a question draft survives without an agent and later shows as sent', async (// oxlint-disable-next-line no-empty-pattern -- Playwright's second fixture arg is testInfo; the first must be an object destructure to opt out of the default fixture set.
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
    await page.getByTestId('explanation-marker').filter({ hasText: 'A1.1' }).click({
      timeout: 20_000
    })
    await page.getByTestId('explanation-ask').click()
    await page.getByTestId('explanation-question-input').fill('Why this line?')
    // Blur saves the draft on the host.
    await page.getByTestId('explanation-card').click({ position: { x: 4, y: 4 } })
    await expect
      .poll(async () => {
        const shown = await runOrcaCli(session.userDataDir, [
          'explain',
          'show',
          '--worktree',
          `id:${worktreeId}`,
          '--json'
        ])
        // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: shape is asserted by the expectations that follow.
        const questions = JSON.parse(shown.stdout).result.explanation.questions as {
          body: string
          state: string
        }[]
        return questions.map((q) => `${q.state}:${q.body}`)
      })
      .toEqual(['draft:Why this line?'])
    await page.screenshot({ path: testInfo.outputPath('question-draft.png') })

    // Delivery marks it sent (what the send menu does once an agent receives the prompt).
    await page.evaluate(async (id) => {
      const state = window.__store?.getState()
      const question = state?.explanationsByWorkspace[id]?.explanation?.questions[0]
      if (!state || !question) {
        throw new Error('draft missing')
      }
      await state.markExplanationQuestionsSent(id, [question.id], { label: 'Claude' })
    }, worktreeId)
    await expect(page.getByTestId('explanation-question-sent')).toContainText('Sent to Claude')
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
