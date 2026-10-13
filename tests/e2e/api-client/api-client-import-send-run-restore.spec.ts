/**
 * API Client tab: import, send, run, leave the repo untouched, and survive a restart.
 *
 * Covers quickstart scenarios 2, 3, 7, 8 and 9. The data round-trips through the real main
 * process (IPC, secret store, file storage); the DOM proves the tab renders what was imported.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server } from 'node:http'
import os from 'node:os'
import path from 'node:path'
import type { ElectronApplication, Page } from '@stablyai/playwright-test'
import { test, expect } from '../helpers/orca-app'
import { getStoreState, waitForSessionReady } from '../helpers/store'
import { attachRepoAndOpenTerminal, createRestartSession } from '../helpers/orca-restart'
import { TEST_REPO_PATH_FILE } from '../global-setup'

const SECRET = 'e2e-secret-token'

type SeenRequest = { url: string; headers: IncomingMessage['headers'] }

function listenPort(server: Server): number {
  const address = server.address()
  if (address === null || typeof address === 'string') {
    throw new Error('server did not report a TCP address')
  }
  return address.port
}

async function startEchoServer(seen: SeenRequest[]): Promise<{ server: Server; baseUrl: string }> {
  const server = createServer((req, res) => {
    seen.push({ url: req.url ?? '', headers: req.headers })
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ path: req.url, tenant: req.headers['x-tenant'] }))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = listenPort(server)
  return { server, baseUrl: `http://127.0.0.1:${port}` }
}

function writeFixtures(dir: string, baseUrl: string): { collection: string; environment: string } {
  const request = (id: string, name: string, route: string) => ({
    id,
    name,
    request: {
      method: 'GET',
      header: [
        { key: 'X-Tenant', value: '{{tenantId}}' },
        { key: 'Authorization', value: 'Bearer {{token}}' }
      ],
      url: { raw: `{{baseUrl}}${route}` }
    },
    event: [
      {
        listen: 'test',
        script: {
          exec: ["pm.test('status is 200', function () { pm.response.to.have.status(200) })"]
        }
      }
    ]
  })
  const collection = path.join(dir, 'e2e.postman_collection.json')
  writeFileSync(
    collection,
    JSON.stringify({
      info: {
        _postman_id: 'e2e-collection',
        name: 'E2E Collection',
        schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json'
      },
      item: [
        {
          id: 'e2e-folder',
          name: 'MAIN',
          item: [request('e2e-r1', 'First', '/one'), request('e2e-r2', 'Second', '/two')]
        }
      ]
    })
  )
  const environment = path.join(dir, 'e2e.postman_environment.json')
  writeFileSync(
    environment,
    JSON.stringify({
      id: 'e2e-env',
      name: 'E2E Env',
      values: [
        { key: 'baseUrl', value: baseUrl, type: 'default', enabled: true },
        { key: 'tenantId', value: 't-42', type: 'default', enabled: true },
        { key: 'token', value: SECRET, type: 'secret', enabled: true }
      ]
    })
  )
  return { collection, environment }
}

async function openApiClientTab(page: Page, worktreeId: string): Promise<void> {
  await page.evaluate((worktreeId) => {
    const store = window.__store?.getState()
    if (!store) {
      throw new Error('window.__store is not available')
    }
    const tab = store.createUnifiedTab(worktreeId, 'api-client', {
      label: 'API Client',
      activate: true
    })
    store.ensureApiClientTabState(tab.id, worktreeId)
    store.setActiveTabType('api-client')
  }, worktreeId)
}

function gitStatus(repoPath: string): string {
  return execFileSync('git', ['status', '--porcelain'], { cwd: repoPath, encoding: 'utf8' })
}

test('imports, sends, runs, leaves git clean, and restores after a restart', async (// oxlint-disable-next-line no-empty-pattern -- Playwright's second fixture arg is testInfo; the first must be an object destructure to opt out of the default fixture set.
{}, testInfo) => {
  test.setTimeout(300_000)
  const repoPath = existsSync(TEST_REPO_PATH_FILE)
    ? readFileSync(TEST_REPO_PATH_FILE, 'utf-8').trim()
    : ''
  test.skip(!repoPath || !existsSync(repoPath), 'Global setup did not produce a seeded test repo')

  const seen: SeenRequest[] = []
  const { server, baseUrl } = await startEchoServer(seen)
  const fixtureDir = mkdtempSync(path.join(os.tmpdir(), 'orca-e2e-api-client-'))
  const files = writeFixtures(fixtureDir, baseUrl)
  const session = createRestartSession(testInfo)
  let firstApp: ElectronApplication | null = null
  let secondApp: ElectronApplication | null = null
  try {
    const first = await session.launch()
    firstApp = first.app
    const page = first.page
    await waitForSessionReady(page)
    const worktreeId = await attachRepoAndOpenTerminal(page, repoPath)
    const statusBefore = gitStatus(repoPath)

    // Scenario 2: import both files.
    for (const filePath of [files.collection, files.environment]) {
      const imported = await page.evaluate(
        ([worktreeId, filePath]) => window.api.apiClient.importFile({ worktreeId, filePath }),
        [worktreeId, filePath]
      )
      expect(imported).toMatchObject({ ok: true })
    }
    await page.evaluate(
      (worktreeId) =>
        window.api.apiClient.setActiveEnvironment({ worktreeId, environmentId: 'e2e-env' }),
      worktreeId
    )

    // The tab shows the imported tree (user-observable proof, not store state).
    await openApiClientTab(page, worktreeId)
    await expect(page.getByText('E2E Collection')).toBeVisible({ timeout: 15_000 })

    // Scenario 3: send one request; the server sees the resolved header values.
    const sent = await page.evaluate(
      (worktreeId) => window.api.apiClient.send({ worktreeId, requestId: 'e2e-r1' }),
      worktreeId
    )
    expect(sent).toMatchObject({ ok: true })
    await expect
      .poll(
        () =>
          page.evaluate(async (worktreeId) => {
            const result = await window.api.apiClient.getLatestResult({
              worktreeId,
              requestId: 'e2e-r1'
            })
            return result.ok && result.result !== null
          }, worktreeId),
        { timeout: 15_000 }
      )
      .toBe(true)
    const latest = await page.evaluate(
      (worktreeId) => window.api.apiClient.getLatestResult({ worktreeId, requestId: 'e2e-r1' }),
      worktreeId
    )
    expect(JSON.stringify(latest)).not.toContain(SECRET)
    expect(JSON.stringify(latest)).toMatch(/"status":\s*200/)
    const first1 = seen.find((entry) => entry.url === '/one')
    expect(first1?.headers['x-tenant']).toBe('t-42')
    expect(first1?.headers.authorization).toBe(`Bearer ${SECRET}`)

    // Scenario 7: run the MAIN folder.
    const started = await page.evaluate(
      (worktreeId) =>
        window.api.apiClient.startRun({
          worktreeId,
          scope: { collectionId: 'e2e-collection', folderId: 'e2e-folder' },
          environmentId: 'e2e-env',
          options: {
            iterations: 1,
            delayMs: 0,
            stopOnFailure: false,
            includedRequestIds: ['e2e-r1', 'e2e-r2']
          }
        }),
      worktreeId
    )
    expect(started).toMatchObject({ ok: true })
    await expect
      .poll(
        () =>
          page.evaluate(async (worktreeId) => {
            const result = await window.api.apiClient.getLatestRun({
              worktreeId,
              scopeId: 'e2e-folder'
            })
            return result.ok ? (result.run?.state ?? null) : null
          }, worktreeId),
        { timeout: 30_000 }
      )
      .toBe('completed')
    expect(seen.filter((entry) => entry.url === '/two').length).toBeGreaterThanOrEqual(1)

    // Scenario 8: nothing was written into the repository.
    expect(gitStatus(repoPath)).toBe(statusBefore)

    await session.close(first.app)
    firstApp = null

    // Scenario 9: relaunch against the same profile restores the data.
    const second = await session.launch()
    secondApp = second.app
    await waitForSessionReady(second.page)
    await attachRepoAndOpenTerminal(second.page, repoPath)
    const restored = await second.page.evaluate(
      (worktreeId) => window.api.apiClient.getSnapshot({ worktreeId }),
      worktreeId
    )
    expect(restored).toMatchObject({
      ok: true,
      data: {
        activeEnvironmentId: 'e2e-env',
        collections: [{ id: 'e2e-collection', name: 'E2E Collection' }],
        environments: [{ id: 'e2e-env', name: 'E2E Env' }]
      }
    })
    expect(JSON.stringify(restored)).not.toContain(SECRET)
    const restoredRun = await second.page.evaluate(
      (worktreeId) => window.api.apiClient.getLatestRun({ worktreeId, scopeId: 'e2e-folder' }),
      worktreeId
    )
    expect(restoredRun).toMatchObject({ ok: true, run: { state: 'completed' } })
    expect(await getStoreState<string | null>(second.page, 'activeWorktreeId')).toBe(worktreeId)
  } finally {
    for (const app of [secondApp, firstApp]) {
      if (!app) {
        continue
      }
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

test('two tabs stay in sync and a git branch switch leaves the data alone', async (// oxlint-disable-next-line no-empty-pattern -- Playwright's second fixture arg is testInfo; the first must be an object destructure to opt out of the default fixture set.
{}, testInfo) => {
  test.setTimeout(300_000)
  const repoPath = existsSync(TEST_REPO_PATH_FILE)
    ? readFileSync(TEST_REPO_PATH_FILE, 'utf-8').trim()
    : ''
  test.skip(!repoPath || !existsSync(repoPath), 'Global setup did not produce a seeded test repo')

  const fixtureDir = mkdtempSync(path.join(os.tmpdir(), 'orca-e2e-api-client-sync-'))
  const files = writeFixtures(fixtureDir, 'http://127.0.0.1:9')
  const session = createRestartSession(testInfo)
  let app: ElectronApplication | null = null
  try {
    const launched = await session.launch()
    app = launched.app
    const page = launched.page
    await waitForSessionReady(page)
    const worktreeId = await attachRepoAndOpenTerminal(page, repoPath)
    const imported = await page.evaluate(
      ([worktreeId, filePath]) => window.api.apiClient.importFile({ worktreeId, filePath }),
      [worktreeId, files.collection]
    )
    expect(imported).toMatchObject({ ok: true })

    // Two tabs on the same worktree: the second one is created on top of the first.
    await openApiClientTab(page, worktreeId)
    await openApiClientTab(page, worktreeId)
    await expect(page.getByText('E2E Collection')).toBeVisible({ timeout: 15_000 })

    // A rename made through the main process reaches the visible tree without a reload.
    const renamed = await page.evaluate(
      (worktreeId) =>
        window.api.apiClient.treeOp({
          worktreeId,
          op: 'rename',
          target: { collectionId: 'e2e-collection' },
          name: 'Renamed Collection'
        }),
      worktreeId
    )
    expect(renamed).toMatchObject({ ok: true })
    await expect(page.getByText('Renamed Collection')).toBeVisible({ timeout: 15_000 })

    // Switching branches in the worktree changes nothing about the stored data.
    const statusBefore = gitStatus(repoPath)
    execFileSync('git', ['switch', '-c', 'api-client-tmp-branch'], { cwd: repoPath })
    execFileSync('git', ['switch', '-'], { cwd: repoPath })
    const snapshot = await page.evaluate(
      (worktreeId) => window.api.apiClient.getSnapshot({ worktreeId }),
      worktreeId
    )
    expect(snapshot).toMatchObject({
      ok: true,
      data: { collections: [{ name: 'Renamed Collection' }] }
    })
    expect(gitStatus(repoPath)).toBe(statusBefore)
    execFileSync('git', ['branch', '-D', 'api-client-tmp-branch'], { cwd: repoPath })
  } finally {
    if (app) {
      try {
        await session.close(app)
      } catch {
        // best-effort cleanup
      }
    }
    await session.dispose()
    rmSync(fixtureDir, { recursive: true, force: true })
  }
})

test('handles a 5 MB response and a 120-request run within budget', async (// oxlint-disable-next-line no-empty-pattern -- Playwright's second fixture arg is testInfo; the first must be an object destructure to opt out of the default fixture set.
{}, testInfo) => {
  test.setTimeout(300_000)
  const repoPath = existsSync(TEST_REPO_PATH_FILE)
    ? readFileSync(TEST_REPO_PATH_FILE, 'utf-8').trim()
    : ''
  test.skip(!repoPath || !existsSync(repoPath), 'Global setup did not produce a seeded test repo')

  const bigBody = JSON.stringify({ rows: 'x'.repeat(5 * 1024 * 1024) })
  const server = createServer((req, res) => {
    res.setHeader('content-type', 'application/json')
    res.end(req.url === '/big' ? bigBody : '{"ok":true}')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const baseUrl = `http://127.0.0.1:${listenPort(server)}`
  const fixtureDir = mkdtempSync(path.join(os.tmpdir(), 'orca-e2e-api-client-perf-'))
  const requestItem = (id: string, route: string) => ({
    id,
    name: id,
    request: { method: 'GET', url: { raw: `${baseUrl}${route}` } }
  })
  const ids = Array.from({ length: 120 }, (_, index) => `perf-${index}`)
  const collectionFile = path.join(fixtureDir, 'perf.postman_collection.json')
  writeFileSync(
    collectionFile,
    JSON.stringify({
      info: {
        _postman_id: 'perf-collection',
        name: 'Perf',
        schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json'
      },
      item: [requestItem('perf-big', '/big'), ...ids.map((id) => requestItem(id, '/ping'))]
    })
  )
  const session = createRestartSession(testInfo)
  let app: ElectronApplication | null = null
  try {
    const launched = await session.launch()
    app = launched.app
    const page = launched.page
    await waitForSessionReady(page)
    const worktreeId = await attachRepoAndOpenTerminal(page, repoPath)
    await page.evaluate(
      ([worktreeId, filePath]) => window.api.apiClient.importFile({ worktreeId, filePath }),
      [worktreeId, collectionFile]
    )

    const bigStart = Date.now()
    await page.evaluate(
      (worktreeId) => window.api.apiClient.send({ worktreeId, requestId: 'perf-big' }),
      worktreeId
    )
    await expect
      .poll(
        () =>
          page.evaluate(async (worktreeId) => {
            const result = await window.api.apiClient.getLatestResult({
              worktreeId,
              requestId: 'perf-big'
            })
            return result.ok && result.result !== null
          }, worktreeId),
        { timeout: 30_000 }
      )
      .toBe(true)
    expect(Date.now() - bigStart).toBeLessThan(15_000)

    const runStart = Date.now()
    await page.evaluate(
      ([worktreeId, ids]) =>
        window.api.apiClient.startRun({
          worktreeId,
          scope: { collectionId: 'perf-collection' },
          environmentId: null,
          options: { iterations: 1, delayMs: 0, stopOnFailure: false, includedRequestIds: ids }
        }),
      [worktreeId, ids] as const
    )
    await expect
      .poll(
        () =>
          page.evaluate(async (worktreeId) => {
            const result = await window.api.apiClient.getLatestRun({
              worktreeId,
              scopeId: 'perf-collection'
            })
            return result.ok ? (result.run?.state ?? null) : null
          }, worktreeId),
        { timeout: 120_000 }
      )
      .toBe('completed')
    expect(Date.now() - runStart).toBeLessThan(60_000)
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
