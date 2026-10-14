/**
 * E2E test for recording the browser tab as a GIF.
 *
 * User Prompt:
 * - A toolbar button records the browser tab as a .gif; while recording it shows elapsed seconds,
 *   can pause, and Stop asks where to save the file.
 */

import { readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test, expect } from './helpers/orca-app'
import {
  ensureTerminalVisible,
  getActiveWorktreeId,
  waitForActiveWorktree,
  waitForSessionReady
} from './helpers/store'

async function startTickingPageServer(): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    response.end(`<!doctype html><html><body style="font:48px sans-serif">
      <div id="tick">0</div>
      <script>let n = 0; setInterval(() => { document.getElementById('tick').textContent = ++n }, 50)</script>
    </body></html>`)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('tick server has no TCP address')
  }
  return {
    url: `http://127.0.0.1:${address.port}/`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve()))
  }
}

test.describe('Browser tab GIF recorder', () => {
  test.beforeEach(async ({ orcaPage }) => {
    await waitForSessionReady(orcaPage)
    await waitForActiveWorktree(orcaPage)
    await ensureTerminalVisible(orcaPage)
  })

  test('records, shows elapsed time, pauses, and saves a GIF', async ({
    orcaPage,
    electronApp
  }) => {
    const server = await startTickingPageServer()
    const savePath = path.join(tmpdir(), `orca-gif-e2e-${Date.now()}.gif`)
    try {
      // Why: the native save dialog cannot be driven headlessly, so answer it from the main process.
      await electronApp.evaluate(({ dialog }, filePath) => {
        dialog.showSaveDialog = async () => ({ canceled: false, filePath })
      }, savePath)

      const worktreeId = (await getActiveWorktreeId(orcaPage))!
      await orcaPage.evaluate(
        ({ targetWorktreeId, url }) => {
          window.__store?.getState().createBrowserTab(targetWorktreeId, url, {
            title: 'GIF',
            activate: true
          })
        },
        { targetWorktreeId: worktreeId, url: server.url }
      )

      const recordButton = orcaPage.getByRole('button', { name: 'Record GIF' }).first()
      await expect(recordButton).toBeEnabled({ timeout: 15_000 })
      await recordButton.click()

      const group = orcaPage.getByRole('group', { name: 'Recording GIF' })
      await expect(group).toBeVisible()
      await expect(group).toContainText('0:01', { timeout: 5_000 })

      await group.getByRole('button', { name: 'Pause recording' }).click()
      const pausedGroup = orcaPage.getByRole('group', { name: 'Recording paused' })
      await expect(pausedGroup).toBeVisible()
      const frozen = await pausedGroup.textContent()
      await orcaPage.waitForTimeout(1_500)
      await expect(pausedGroup).toHaveText(frozen ?? '')

      await pausedGroup.getByRole('button', { name: 'Resume recording' }).click()
      await expect(group).toBeVisible()
      await group.getByRole('button', { name: 'Stop and save GIF' }).click()

      await expect(recordButton).toBeVisible({ timeout: 15_000 })
      await expect
        .poll(async () => (await readFile(savePath).catch(() => Buffer.alloc(0))).length, {
          timeout: 15_000
        })
        .toBeGreaterThan(0)
      const bytes = await readFile(savePath)
      expect(bytes.subarray(0, 6).toString('latin1')).toBe('GIF89a')
      expect(bytes.at(-1)).toBe(0x3b)
    } finally {
      await server.close()
      await rm(savePath, { force: true })
    }
  })
})
