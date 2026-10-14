/**
 * E2E tests for recording the browser tab as GIF, MP4, or WebM.
 *
 * User Prompt:
 * - A toolbar button records the browser tab as a .gif; while recording it shows elapsed seconds,
 *   can pause, and Stop asks where to save the file.
 * - A menu next to the button picks the output format (GIF / MP4 / WebM).
 */

import { readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { ElectronApplication, Page } from '@stablyai/playwright-test'
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

type SavedRecording = { bytes: Buffer; cleanup: () => Promise<void> }

async function openTickingTab(orcaPage: Page, url: string): Promise<void> {
  const worktreeId = (await getActiveWorktreeId(orcaPage))!
  await orcaPage.evaluate(
    ({ targetWorktreeId, targetUrl }) => {
      window.__store?.getState().createBrowserTab(targetWorktreeId, targetUrl, {
        title: 'Recording',
        activate: true
      })
    },
    { targetWorktreeId: worktreeId, targetUrl: url }
  )
}

async function answerSaveDialog(electronApp: ElectronApplication, extension: string) {
  const savePath = path.join(tmpdir(), `orca-recording-e2e-${Date.now()}.${extension}`)
  // Why: the native save dialog cannot be driven headlessly, so answer it from the main process.
  await electronApp.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath })
  }, savePath)
  return savePath
}

async function chooseFormat(orcaPage: Page, formatName: string): Promise<void> {
  await orcaPage
    .getByRole('button', { name: 'Recording format' })
    .filter({ visible: true })
    .first()
    .click()
  await orcaPage.getByRole('menuitemradio', { name: new RegExp(`^${formatName}`) }).click()
}

async function recordAndSave(
  orcaPage: Page,
  electronApp: ElectronApplication,
  formatName: string,
  extension: string
): Promise<SavedRecording> {
  const savePath = await answerSaveDialog(electronApp, extension)
  await chooseFormat(orcaPage, formatName)
  const recordButton = orcaPage
    .getByRole('button', { name: `Record ${formatName}` })
    .filter({ visible: true })
    .first()
  await expect(recordButton).toBeEnabled({ timeout: 15_000 })
  await recordButton.click()

  const group = orcaPage.getByRole('group', { name: `Recording ${formatName}` })
  await expect(group).toContainText(/0:0[1-9]/, { timeout: 5_000 })
  await group.getByRole('button', { name: `Stop and save ${formatName}` }).click()

  await expect(recordButton).toBeVisible({ timeout: 15_000 })
  await expect
    .poll(async () => (await readFile(savePath).catch(() => Buffer.alloc(0))).length, {
      timeout: 15_000
    })
    .toBeGreaterThan(0)
  return { bytes: await readFile(savePath), cleanup: () => rm(savePath, { force: true }) }
}

test.describe('Browser tab recorder', () => {
  let server: Awaited<ReturnType<typeof startTickingPageServer>>

  test.beforeEach(async ({ orcaPage }) => {
    await waitForSessionReady(orcaPage)
    await waitForActiveWorktree(orcaPage)
    await ensureTerminalVisible(orcaPage)
    server = await startTickingPageServer()
    await openTickingTab(orcaPage, server.url)
  })

  test.afterEach(async () => {
    await server.close()
  })

  test('records, shows elapsed time, pauses, and saves a GIF', async ({
    orcaPage,
    electronApp
  }) => {
    const savePath = await answerSaveDialog(electronApp, 'gif')
    try {
      await chooseFormat(orcaPage, 'GIF')
      const recordButton = orcaPage
        .getByRole('button', { name: 'Record GIF' })
        .filter({ visible: true })
        .first()
      await expect(recordButton).toBeEnabled({ timeout: 15_000 })
      await recordButton.click()

      const group = orcaPage.getByRole('group', { name: 'Recording GIF' })
      await expect(group).toBeVisible()
      await expect(group).toContainText(/0:0[1-9]/, { timeout: 5_000 })

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
      await rm(savePath, { force: true })
    }
  })

  test('saves an MP4 when MP4 is picked in the format menu', async ({ orcaPage, electronApp }) => {
    const saved = await recordAndSave(orcaPage, electronApp, 'MP4', 'mp4')
    try {
      // Every MP4 opens with a box whose type, at bytes 4-8, is "ftyp".
      expect(saved.bytes.subarray(4, 8).toString('latin1')).toBe('ftyp')
    } finally {
      await saved.cleanup()
    }
  })

  test('saves a WebM when WebM is picked in the format menu', async ({ orcaPage, electronApp }) => {
    const saved = await recordAndSave(orcaPage, electronApp, 'WebM', 'webm')
    try {
      expect([...saved.bytes.subarray(0, 4)]).toEqual([0x1a, 0x45, 0xdf, 0xa3])
    } finally {
      await saved.cleanup()
    }
  })
})
