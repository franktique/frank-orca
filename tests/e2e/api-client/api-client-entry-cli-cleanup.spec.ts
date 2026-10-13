/**
 * API Client tab: the '+' menu entry, the `orca api` CLI against a worktree that is not on
 * screen, and removal of a worktree's data when the worktree is deleted.
 *
 * Covers quickstart scenarios 1, 11 and 13.
 */

import { execFile } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import type { ElectronApplication } from '@stablyai/playwright-test'
import { test, expect } from '../helpers/orca-app'
import { getStoreState, waitForSessionReady } from '../helpers/store'
import { attachRepoAndOpenTerminal, createRestartSession } from '../helpers/orca-restart'
import { TEST_REPO_PATH_FILE } from '../global-setup'
import { getApiClientWorktreePaths } from '../../../src/main/api-client/api-client-storage-paths'

const execFileAsync = promisify(execFile)
const SECRET = 'cli-secret-token'

function readRepoPath(): string {
  return existsSync(TEST_REPO_PATH_FILE) ? readFileSync(TEST_REPO_PATH_FILE, 'utf-8').trim() : ''
}

async function runCli(
  userDataDir: string,
  args: string[]
): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const result = await execFileAsync(
      process.execPath,
      [path.join(process.cwd(), 'config', 'scripts', 'orca-dev.mjs'), ...args],
      { cwd: process.cwd(), env: { ...process.env, ORCA_DEV_USER_DATA_PATH: userDataDir } }
    )
    return { code: 0, stdout: result.stdout, stderr: result.stderr }
  } catch (error) {
    if (typeof error !== 'object' || error === null) {
      throw error
    }
    const code = 'code' in error && typeof error.code === 'number' ? error.code : 1
    const stdout = 'stdout' in error ? String(error.stdout) : ''
    const stderr = 'stderr' in error ? String(error.stderr) : ''
    return { code, stdout, stderr }
  }
}

test('the + menu lists API Client for a local worktree and disables it for a remote one', async (// oxlint-disable-next-line no-empty-pattern -- Playwright's second fixture arg is testInfo; the first must be an object destructure to opt out of the default fixture set.
{}, testInfo) => {
  test.setTimeout(180_000)
  const repoPath = readRepoPath()
  test.skip(!repoPath || !existsSync(repoPath), 'Global setup did not produce a seeded test repo')

  const session = createRestartSession(testInfo)
  let app: ElectronApplication | null = null
  try {
    const launched = await session.launch()
    app = launched.app
    const page = launched.page
    await waitForSessionReady(page)
    await attachRepoAndOpenTerminal(page, repoPath)

    const openMenu = async (): Promise<void> => {
      await page.getByRole('button', { name: 'New tab', exact: true }).first().click()
    }
    const menuLabels = async (): Promise<string[]> => page.getByRole('menuitem').allInnerTexts()

    await openMenu()
    const apiItem = page.getByRole('menuitem', { name: 'New API Client' })
    await expect(apiItem).toBeVisible()
    await expect(apiItem).not.toHaveAttribute('data-disabled')
    const labels = await menuLabels()
    const apiIndex = labels.findIndex((label) => label.includes('New API Client'))
    const agentIndex = labels.findIndex((label) => /agent/i.test(label))
    if (agentIndex !== -1) {
      expect(apiIndex).toBeLessThan(agentIndex)
    }
    await page.screenshot({ path: testInfo.outputPath('plus-menu-local.png') })
    await page.keyboard.press('Escape')
    await expect(apiItem).toBeHidden()

    // A workspace owned by an SSH host is "remote" for the API Client.
    const previousHost = await page.evaluate(() => {
      const previous = window.__store?.getState().activeWorkspaceExecutionHostId ?? null
      window.__store?.setState({ activeWorkspaceExecutionHostId: 'ssh:e2e-ssh-target' })
      return previous
    })
    try {
      await openMenu()
      const disabled = page.getByRole('menuitem', { name: 'New API Client' })
      await expect(disabled).toHaveAttribute('data-disabled', '')
      await page.locator('[data-slot="tooltip-trigger"]', { hasText: 'New API Client' }).hover()
      await expect(page.getByText('Local worktrees only')).toBeVisible()
      await page.screenshot({ path: testInfo.outputPath('plus-menu-remote.png') })
      await page.keyboard.press('Escape')
    } finally {
      await page.evaluate((previous) => {
        window.__store?.setState({ activeWorkspaceExecutionHostId: previous })
      }, previousHost)
    }
  } finally {
    if (app) {
      try {
        await session.close(app)
      } catch {
        // best-effort cleanup
      }
    }
    await session.dispose()
  }
})

test('orca api works on a worktree that is not on screen, and deleting it removes its data', async (// oxlint-disable-next-line no-empty-pattern -- Playwright's second fixture arg is testInfo; the first must be an object destructure to opt out of the default fixture set.
{}, testInfo) => {
  test.setTimeout(300_000)
  const repoPath = readRepoPath()
  test.skip(!repoPath || !existsSync(repoPath), 'Global setup did not produce a seeded test repo')

  const server: Server = createServer((req, res) => {
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ path: req.url, authorization: req.headers.authorization }))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') {
    throw new Error('server did not report a TCP address')
  }
  const baseUrl = `http://127.0.0.1:${address.port}`
  const fixtureDir = mkdtempSync(path.join(os.tmpdir(), 'orca-e2e-api-client-cli-'))
  const request = (id: string, route: string, expectedStatus: number) => ({
    id,
    name: id,
    request: {
      method: 'GET',
      header: [{ key: 'Authorization', value: 'Bearer {{token}}' }],
      url: { raw: `{{baseUrl}}${route}` }
    },
    event: [
      {
        listen: 'test',
        script: {
          exec: [
            `pm.test('status is ${expectedStatus}', function () { pm.response.to.have.status(${expectedStatus}) })`
          ]
        }
      }
    ]
  })
  const collectionFile = path.join(fixtureDir, 'cli.postman_collection.json')
  writeFileSync(
    collectionFile,
    JSON.stringify({
      info: {
        _postman_id: 'cli-collection',
        name: 'CLI Collection',
        schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json'
      },
      item: [
        {
          id: 'cli-folder',
          name: 'MAIN',
          item: [request('cli-pass', '/ok', 200), request('cli-fail', '/nope', 404)]
        }
      ]
    })
  )
  const environmentFile = path.join(fixtureDir, 'cli.postman_environment.json')
  writeFileSync(
    environmentFile,
    JSON.stringify({
      id: 'cli-env',
      name: 'CLI Env',
      values: [
        { key: 'baseUrl', value: baseUrl, type: 'default', enabled: true },
        { key: 'token', value: SECRET, type: 'secret', enabled: true }
      ]
    })
  )

  const session = createRestartSession(testInfo)
  let app: ElectronApplication | null = null
  try {
    const launched = await session.launch()
    app = launched.app
    const page = launched.page
    await waitForSessionReady(page)
    const activeWorktreeId = await attachRepoAndOpenTerminal(page, repoPath)

    // A second worktree that is never shown.
    const targetId = await page.evaluate(async (activeWorktreeId) => {
      const state = window.__store?.getState()
      const repoId = Object.values(state?.worktreesByRepo ?? {})
        .flat()
        .find((worktree) => worktree.id === activeWorktreeId)?.repoId
      if (!state || !repoId) {
        throw new Error('no active repo')
      }
      const result = await state.createWorktree(
        repoId,
        `e2e-api-cli-${Date.now()}`,
        undefined,
        'skip'
      )
      await state.fetchWorktrees(repoId)
      return result.worktree.id
    }, activeWorktreeId)

    for (const filePath of [collectionFile, environmentFile]) {
      const imported = await page.evaluate(
        ([worktreeId, filePath]) => window.api.apiClient.importFile({ worktreeId, filePath }),
        [targetId, filePath]
      )
      expect(imported).toMatchObject({ ok: true })
    }
    await page.evaluate(
      (worktreeId) =>
        window.api.apiClient.setActiveEnvironment({ worktreeId, environmentId: 'cli-env' }),
      targetId
    )
    const selector = ['--worktree', `id:${targetId}`]

    // Scenario 11: list, run (exit code 1 on a failing test, secrets masked), show.
    const listed = await runCli(session.userDataDir, ['api', 'list', ...selector, '--json'])
    expect(listed.code).toBe(0)
    expect(listed.stdout).toContain('cli-folder')
    expect(listed.stdout).toContain('cli-pass')

    const ran = await runCli(session.userDataDir, [
      'api',
      'run',
      'cli-folder',
      ...selector,
      '--json'
    ])
    expect(ran.code).toBe(1)
    expect(ran.stdout).not.toContain(SECRET)
    expect(ran.stdout).toContain('cli-fail')

    const shown = await runCli(session.userDataDir, ['api', 'show', 'cli-pass', ...selector])
    expect(shown.code).toBe(0)
    expect(await getStoreState<string | null>(page, 'activeWorktreeId')).toBe(activeWorktreeId)

    // Scenario 13: deleting the worktree removes its data directory.
    const dataDir = getApiClientWorktreePaths(
      targetId,
      path.join(session.userDataDir, 'api-client')
    ).dir
    expect(existsSync(dataDir)).toBe(true)
    const removal = await page.evaluate(async (id) => {
      try {
        const result = await window.__store
          ?.getState()
          .removeWorktree({ id, executionHostId: null }, true)
        return result?.ok ? 'ok' : JSON.stringify(result)
      } catch (error) {
        return String(error)
      }
    }, targetId)
    expect(removal).toBe('ok')
    await expect.poll(() => existsSync(dataDir), { timeout: 30_000 }).toBe(false)
  } finally {
    if (app) {
      try {
        await session.close(app)
      } catch {
        // best-effort cleanup
      }
    }
    await session.dispose()
    server.close()
    rmSync(fixtureDir, { recursive: true, force: true })
  }
})
