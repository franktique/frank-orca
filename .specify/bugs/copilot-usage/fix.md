# Bug Fix: Copilot usage chip stuck at 100% after monthly reset

- **Slug**: copilot-usage
- **Fixed**: 2026-10-14
- **Assessment**: ./assessment.md
- **Status**: applied

## Summary

The Copilot reader now ignores signed-in accounts that have no premium quota. Before, a personal account the CLI cached about 2s after the Business one won the "freshest entry" pick. Its `percent_remaining: 0` then showed as 100% used. The chip now shows the freshest account that has a quota. An account with no quota is never shown as usage.

## Changes

| File | Change | Notes |
|------|--------|-------|
| `src/main/rate-limits/copilot-usage-fetch.ts` | modified | Adds `has_quota` to the snapshot type and a `hasPremiumQuota()` check, used both to choose the cache entry and in `mapMonthlyUsage` |
| `src/main/rate-limits/copilot-usage-fetch.test.ts` | added tests | `NO_QUOTA` fixture plus 2 regression tests |

## Diff Highlights

```ts
function hasPremiumQuota(response: CopilotUserResponse): boolean {
  const snapshot = response.quota_snapshots?.premium_interactions
  return Boolean(snapshot) && snapshot?.has_quota !== false && snapshot?.entitlement !== 0
}

// readCopilotUsageCache
const freshest = byFreshness.find((entry) => hasPremiumQuota(entry.response)) ?? byFreshness[0]
```

An account is excluded only when it says outright that it has no quota (`has_quota: false` or `entitlement: 0`). Cache entries that omit those fields still count as having a quota, so older cache formats keep working.

## Tests Added or Updated

- `copilot-usage-fetch.test.ts › skips a fresher signed-in account that has no premium quota`: uses the real two-account layout and expects `business`, ~0.4% used, 20.9 / 6726.
- `copilot-usage-fetch.test.ts › reports a no-quota account as unavailable instead of 100% used`: a cache with only a no-quota account gives `unavailable` and no monthly window.
- The existing `prefers the freshest cache entry across accounts` test still passes unchanged.

## Local Verification

- `pnpm test src/main/rate-limits/copilot-usage-fetch.test.ts` → 9/9 pass.
- Same tests against the original `copilot-usage-fetch.ts` → both new tests fail, confirming they catch the bug.
- One-off run against the real `~/Library/Caches/copilot/copilot-user-cache.json` → `status: ok, plan: business, usedPercent: 0.4, usageAmount: 20.9 / 6726`. The throwaway test file was deleted afterwards.
- `pnpm tc:node` → clean. `oxlint` on both files → exit 0. `oxfmt --write` applied to both files.
- Not done: checking the running Orca app's status bar.

## Deviations from Assessment

- The open question is resolved by the user: the personal account must never appear in the indicator. When only no-quota accounts exist, the result is `unavailable` ("did not report a credits quota") rather than any percentage.
- Named the check `hasPremiumQuota` instead of `hasUsablePremiumQuota`. Unlimited accounts count as having a quota, so they can still be selected, and `mapMonthlyUsage` keeps reporting them as unavailable, as before.

## Follow-ups

- If two accounts both have real quotas, the chip can still switch between them depending on which the CLI refreshed last. Preferring the CLI's active login from `~/.copilot/config.json` would fix that.
- `resetDescription` shows only a weekday and time (e.g. "Sat 7:00 PM") even when the reset is weeks away. This existed before and the user says the days-remaining display is correct, so it was left alone.
