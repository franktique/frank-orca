/**
 * API Client: a self-signed HTTPS server is refused with a message that points to the SSL
 * switch, then reached once verification is off app-wide and, separately, for one request.
 *
 * Covers quickstart row 5 (FR-017a, US2/AC5).
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ElectronApplication, Page } from '@stablyai/playwright-test'
import { test, expect } from '../helpers/orca-app'
import { waitForSessionReady } from '../helpers/store'
import { attachRepoAndOpenTerminal, createRestartSession } from '../helpers/orca-restart'
import { TEST_REPO_PATH_FILE } from '../global-setup'
import { startLocalSelfSignedHttpsServer } from '../../../src/main/api-client/test-support/local-self-signed-https-server'

type Outcome =
  | { kind: 'response'; status: number }
  | { kind: 'error'; code: string; message: string }

async function sendAndRead(
  page: Page,
  worktreeId: string,
  draft?: { settings: { sslVerification: boolean } }
): Promise<Outcome> {
  // Results persist per request, so a new one is told apart by its start time.
  const previousStart = await page.evaluate(async (worktreeId) => {
    const result = await window.api.apiClient.getLatestResult({ worktreeId, requestId: 'tls-r1' })
    return result.ok && result.result ? result.result.startedAt : 0
  }, worktreeId)
  const sent = await page.evaluate(
    async ([worktreeId, draft]) => {
      const snapshot = await window.api.apiClient.getSnapshot({ worktreeId })
      const stored = snapshot.ok ? snapshot.data.collections[0]?.items[0] : undefined
      if (!stored || stored.kind !== 'request') {
        throw new Error('the imported request is missing')
      }
      return window.api.apiClient.send({
        worktreeId,
        requestId: stored.id,
        ...(draft
          ? { draft: { ...stored, settings: { ...stored.settings, ...draft.settings } } }
          : {})
      })
    },
    [worktreeId, draft] as const
  )
  expect(sent).toMatchObject({ ok: true })
  const read = (): Promise<Outcome | null> =>
    page.evaluate(
      async ([worktreeId, previousStart]) => {
        const result = await window.api.apiClient.getLatestResult({
          worktreeId,
          requestId: 'tls-r1'
        })
        if (!result.ok || !result.result || result.result.startedAt <= previousStart) {
          return null
        }
        const { outcome } = result.result
        return outcome.kind === 'response'
          ? ({ kind: 'response', status: outcome.response.status } as const)
          : ({ kind: 'error', code: outcome.code, message: outcome.message } as const)
      },
      [worktreeId, previousStart] as const
    )
  await expect.poll(async () => (await read()) !== null, { timeout: 20_000 }).toBe(true)
  const outcome = await read()
  if (!outcome) {
    throw new Error('no result')
  }
  return outcome
}

test('a self-signed server is refused, then reached with SSL verification off', async (// oxlint-disable-next-line no-empty-pattern -- Playwright's second fixture arg is testInfo; the first must be an object destructure to opt out of the default fixture set.
{}, testInfo) => {
  test.setTimeout(240_000)
  const repoPath = existsSync(TEST_REPO_PATH_FILE)
    ? readFileSync(TEST_REPO_PATH_FILE, 'utf-8').trim()
    : ''
  test.skip(!repoPath || !existsSync(repoPath), 'Global setup did not produce a seeded test repo')

  const https = await startLocalSelfSignedHttpsServer()
  const fixtureDir = mkdtempSync(path.join(os.tmpdir(), 'orca-e2e-api-client-tls-'))
  const collectionFile = path.join(fixtureDir, 'tls.postman_collection.json')
  writeFileSync(
    collectionFile,
    JSON.stringify({
      info: {
        _postman_id: 'tls-collection',
        name: 'TLS',
        schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json'
      },
      item: [
        { id: 'tls-r1', name: 'Secure', request: { method: 'GET', url: { raw: https.baseUrl } } }
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
    const worktreeId = await attachRepoAndOpenTerminal(page, repoPath)
    const imported = await page.evaluate(
      ([worktreeId, filePath]) => window.api.apiClient.importFile({ worktreeId, filePath }),
      [worktreeId, collectionFile]
    )
    expect(imported).toMatchObject({ ok: true })

    const refused = await sendAndRead(page, worktreeId)
    expect(refused).toMatchObject({ kind: 'error', code: 'certificate' })
    expect(refused.kind === 'error' && refused.message).toContain('SSL certificate verification')

    // Per request: the draft turns verification off for this send only.
    const perRequest = await sendAndRead(page, worktreeId, { settings: { sslVerification: false } })
    expect(perRequest).toEqual({ kind: 'response', status: 200 })
    expect(await sendAndRead(page, worktreeId)).toMatchObject({
      kind: 'error',
      code: 'certificate'
    })

    // App-wide: the Settings switch.
    await page.evaluate(() => window.api.settings.set({ apiClientSslVerification: false }))
    expect(await sendAndRead(page, worktreeId)).toEqual({ kind: 'response', status: 200 })
    await page.evaluate(() => window.api.settings.set({ apiClientSslVerification: true }))
  } finally {
    if (app) {
      try {
        await session.close(app)
      } catch {
        // best-effort cleanup
      }
    }
    await session.dispose()
    await https.close()
    rmSync(fixtureDir, { recursive: true, force: true })
  }
})
