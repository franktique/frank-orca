import { existsSync, readFileSync } from 'node:fs'
import { parse as parseJsonc, type ParseError } from 'jsonc-parser'
import type {
  ProviderRateLimits,
  RateLimitWindow,
  UsageRateLimitMetadata
} from '../../shared/rate-limit-types'
import { resolveCopilotUsageCachePath } from './copilot-usage-cache-path'

const MONTHLY_WINDOW_MINUTES = 43_200

// Why: the cache is the Copilot CLI's own snapshot of the same endpoint VS
// Code reads (`copilot_internal/user`), so the field names mirror that API.
type CopilotQuotaSnapshot = {
  entitlement?: number
  percent_remaining?: number
  quota_remaining?: number
  unlimited?: boolean
}

type CopilotUserResponse = {
  login?: string
  copilot_plan?: string
  quota_reset_date_utc?: string
  quota_reset_date?: string
  quota_snapshots?: Record<string, CopilotQuotaSnapshot | undefined>
}

type CopilotCacheEntry = {
  retrievedAt?: string
  response?: CopilotUserResponse
}

export type CopilotUsageCacheReadResult =
  | { status: 'missing' }
  | { status: 'error'; error: string }
  | { status: 'ok'; response: CopilotUserResponse }

function result(
  status: ProviderRateLimits['status'],
  error: string | null,
  usageMetadata?: UsageRateLimitMetadata
): ProviderRateLimits {
  return {
    provider: 'copilot',
    session: null,
    weekly: null,
    updatedAt: Date.now(),
    error,
    status,
    ...(usageMetadata ? { usageMetadata } : {})
  }
}

function parseResetDescription(isoString: string | undefined): string | null {
  if (!isoString) {
    return null
  }
  const date = new Date(isoString)
  if (Number.isNaN(date.getTime())) {
    return null
  }
  const isToday = date.toDateString() === new Date().toDateString()
  return isToday
    ? date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    : date.toLocaleDateString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })
}

// Why: the snapshot's own quota_reset_at is 0/unset for this cache shape; the
// reset date lives on the top-level response instead.
function parseResetMs(response: CopilotUserResponse): number | null {
  const iso = response.quota_reset_date_utc ?? response.quota_reset_date
  if (!iso) {
    return null
  }
  const ms = Date.parse(iso)
  return Number.isFinite(ms) ? ms : null
}

function mapMonthlyUsage(response: CopilotUserResponse): RateLimitWindow | null {
  const snapshot = response.quota_snapshots?.premium_interactions
  // Why: unlimited or absent premium credits means "no monthly quota to show"
  // (like Grok's no-config billing response), not an error state.
  if (!snapshot || snapshot.unlimited === true) {
    return null
  }
  const percentRemaining = snapshot.percent_remaining
  if (typeof percentRemaining !== 'number' || !Number.isFinite(percentRemaining)) {
    return null
  }
  const resetsAt = parseResetMs(response)
  const entitlement = snapshot.entitlement
  const quotaRemaining = snapshot.quota_remaining
  // Why: VS Code's hover line ("3,627.1 / 6,726 used") is entitlement minus
  // quota_remaining; the rounded `remaining` sibling loses the decimal.
  const usageAmount =
    typeof entitlement === 'number' &&
    Number.isFinite(entitlement) &&
    entitlement > 0 &&
    typeof quotaRemaining === 'number' &&
    Number.isFinite(quotaRemaining)
      ? { used: entitlement - quotaRemaining, total: entitlement }
      : undefined
  return {
    usedPercent: Math.min(100, Math.max(0, 100 - percentRemaining)),
    windowMinutes: MONTHLY_WINDOW_MINUTES,
    resetsAt,
    resetDescription: parseResetDescription(response.quota_reset_date_utc),
    ...(usageAmount ? { usageAmount } : {})
  }
}

function isCacheEntry(value: unknown): value is CopilotCacheEntry {
  return typeof value === 'object' && value !== null && 'response' in value
}

function hasResponse(
  entry: CopilotCacheEntry
): entry is CopilotCacheEntry & { response: CopilotUserResponse } {
  return typeof entry.response === 'object' && entry.response !== null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function parseCacheEntries(text: string): CopilotCacheEntry[] | null {
  const errors: ParseError[] = []
  const parsed: unknown = parseJsonc(text, errors)
  if (errors.length > 0 || !isRecord(parsed)) {
    return null
  }
  const cacheMap = parsed['copilotUserCache']
  if (!isRecord(cacheMap)) {
    return []
  }
  return Object.values(cacheMap).filter(isCacheEntry)
}

export function readCopilotUsageCache(path: string): CopilotUsageCacheReadResult {
  if (!existsSync(path)) {
    return { status: 'missing' }
  }
  let entries: CopilotCacheEntry[] | null
  try {
    entries = parseCacheEntries(readFileSync(path, 'utf-8'))
  } catch {
    // Why: filesystem errors often include the full cache path; keep it out of UI copy.
    return { status: 'error', error: 'Unable to read Copilot usage cache' }
  }
  if (entries === null) {
    return { status: 'error', error: 'Copilot usage cache is invalid' }
  }
  const freshest = entries.filter(hasResponse).sort((left, right) => {
    const leftMs = left.retrievedAt ? Date.parse(left.retrievedAt) : Number.NaN
    const rightMs = right.retrievedAt ? Date.parse(right.retrievedAt) : Number.NaN
    // Why: entries without a parseable retrievedAt sink; NaN comparisons are false.
    return (Number.isFinite(rightMs) ? rightMs : 0) - (Number.isFinite(leftMs) ? leftMs : 0)
  })[0]
  if (!freshest) {
    return { status: 'missing' }
  }
  return { status: 'ok', response: freshest.response }
}

// Why: Orca never runs copilot auth; it only reads the cache file the CLI
// updates, so there is no token or network handling here.
export async function fetchCopilotRateLimits(
  options: { cachePath?: string } = {}
): Promise<ProviderRateLimits> {
  const readResult = readCopilotUsageCache(options.cachePath ?? resolveCopilotUsageCachePath())
  if (readResult.status === 'missing') {
    return result('unavailable', 'No Copilot usage data yet — run copilot once')
  }
  if (readResult.status === 'error') {
    return result('error', readResult.error)
  }
  const response = readResult.response
  const monthly = mapMonthlyUsage(response)
  if (!monthly) {
    return result('unavailable', 'Copilot did not report a credits quota for this account')
  }
  const login = response.login?.trim()
  return {
    provider: 'copilot',
    session: null,
    weekly: null,
    monthly,
    ...(response.copilot_plan ? { planType: response.copilot_plan } : {}),
    updatedAt: Date.now(),
    error: null,
    status: 'ok',
    usageMetadata: {
      source: 'cli',
      ...(login ? { authProvenance: login } : {})
    }
  }
}
