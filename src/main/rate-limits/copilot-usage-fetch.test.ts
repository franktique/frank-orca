import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ProviderRateLimits } from '../../shared/rate-limit-types'

const CACHE_PATH = '/tmp/copilot-user-cache.json'

function cacheFile(response: unknown, retrievedAt = '2026-09-17T15:48:47.854Z'): string {
  return JSON.stringify({ copilotUserCache: { 'v1:hash': { retrievedAt, response } } })
}

async function fetchWith(fileContents: string | null): Promise<ProviderRateLimits> {
  // Why: re-mocking node:fs only lands on a fresh import of the module graph.
  vi.resetModules()
  vi.doMock('node:fs', () => ({
    existsSync: vi.fn(() => fileContents !== null),
    readFileSync: vi.fn(() => {
      if (fileContents === null) {
        throw new Error('EACCES: permission denied, open /Users/someone/private/cache.json')
      }
      return fileContents
    })
  }))
  const { fetchCopilotRateLimits } = await import('./copilot-usage-fetch')
  return fetchCopilotRateLimits({ cachePath: CACHE_PATH })
}

const BUSINESS_RESPONSE = {
  login: 'someuser',
  copilot_plan: 'business',
  quota_reset_date_utc: '2026-10-01T00:00:00.000Z',
  quota_snapshots: {
    chat: { percent_remaining: 100, unlimited: true },
    premium_interactions: {
      entitlement: 6726,
      percent_remaining: 49.8,
      quota_remaining: 3353.2,
      unlimited: false
    }
  }
}

describe('fetchCopilotRateLimits', () => {
  afterEach(() => {
    vi.resetModules()
    vi.doUnmock('node:fs')
  })

  it('reports unavailable when the cache file is absent', async () => {
    expect(await fetchWith(null)).toMatchObject({
      provider: 'copilot',
      status: 'unavailable',
      session: null,
      weekly: null
    })
  })

  it('maps premium_interactions to a monthly window with raw credit amounts', async () => {
    const result = await fetchWith(cacheFile(BUSINESS_RESPONSE))

    expect(result.status).toBe('ok')
    expect(result.monthly).toEqual({
      usedPercent: 50.2,
      windowMinutes: 43_200,
      resetsAt: Date.parse('2026-10-01T00:00:00.000Z'),
      resetDescription: expect.any(String),
      usageAmount: { used: 3372.8, total: 6726 }
    })
    expect(result.planType).toBe('business')
    expect(result.usageMetadata).toMatchObject({ source: 'cli', authProvenance: 'someuser' })
  })

  it('prefers the freshest cache entry across accounts', async () => {
    const fileContents = JSON.stringify({
      copilotUserCache: {
        'v1:stale': { retrievedAt: '2026-09-01T00:00:00.000Z', response: BUSINESS_RESPONSE },
        'v1:fresh': {
          retrievedAt: '2026-09-17T15:48:47.854Z',
          response: {
            ...BUSINESS_RESPONSE,
            quota_snapshots: { premium_interactions: { percent_remaining: 10 } }
          }
        }
      }
    })

    // Why: the fresh entry's percent_remaining 10 maps to 90% used, while the
    // stale entry would read 50.2% — so 90 proves the freshest one won.
    const result = await fetchWith(fileContents)
    expect(result.monthly?.usedPercent).toBe(90)
  })

  it('treats an unlimited premium quota as unavailable, not an error', async () => {
    const unlimited = {
      ...BUSINESS_RESPONSE,
      quota_snapshots: { premium_interactions: { percent_remaining: 100, unlimited: true } }
    }
    expect(await fetchWith(cacheFile(unlimited))).toMatchObject({ status: 'unavailable' })
  })

  it('reports malformed cache JSON as an error without throwing', async () => {
    expect(await fetchWith('{"copilotUserCache": {')).toMatchObject({
      provider: 'copilot',
      status: 'error',
      error: 'Copilot usage cache is invalid'
    })
  })

  it('redacts filesystem paths from cache read failures', async () => {
    vi.doMock('node:fs', () => ({
      existsSync: vi.fn(() => true),
      readFileSync: vi.fn(() => {
        throw new Error('EACCES: permission denied, open /Users/someone/private/cache.json')
      })
    }))
    const { fetchCopilotRateLimits } = await import('./copilot-usage-fetch')
    const result = await fetchCopilotRateLimits({ cachePath: CACHE_PATH })
    expect(result.status).toBe('error')
    expect(result.error).toBe('Unable to read Copilot usage cache')
    expect(result.error).not.toContain(CACHE_PATH)
  })

  it('treats an empty cache map as no data yet', async () => {
    expect(await fetchWith('{}')).toMatchObject({ status: 'unavailable' })
  })
})
