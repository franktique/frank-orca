# Bug Assessment: Copilot usage chip stuck at 100% after monthly reset

- **Slug**: copilot-usage
- **Created**: 2026-10-14
- **Source**: pasted text
- **Verdict**: valid
- **Severity**: medium

## Report (verbatim or summarized)

> el indicador de uso de github copilot llego a 100% al cabaar el mes y no se reinicio, sigue en 100, da los dias restantes para el reset bien, peor no esta tomando el porcentaje de uso real, el cual al dia d ehoy esta en 0%, auque si se han usado 20.9 creditos

Summary: the Copilot usage indicator hit 100% at month end and never reset. The days-until-reset value is correct, but the percentage is wrong: real usage today is ~0% (20.9 credits used).

## Symptom

The status-bar Copilot chip shows 100% used in the new billing period. The real Copilot Business quota is 20.9 / 6,726 credits used (0.4%, which rounds to ~0%). The chip should show the Business account's usage.

## Reproduction

Reproduced against the real cache file on this machine, `~/Library/Caches/copilot/copilot-user-cache.json` (retrieved 2026-10-14T18:00Z). It holds **two** account entries:

| entry | retrievedAt | plan | premium_interactions |
|---|---|---|---|
| `v1:c8f…` | 18:00:21.154Z | business | entitlement 6726, quota_remaining 6705.1, percent_remaining 99.6, has_quota true |
| `v1:bce…` | 18:00:23.175Z | individual | entitlement 0, quota_remaining 0, **percent_remaining 0**, **has_quota false** |

1. Log in to the Copilot CLI with two GitHub accounts: one with Copilot Business, and one personal account with no premium quota.
2. Run `copilot`. It refreshes both entries, and the individual one is written about 2s later.
3. Open Orca. The chip shows **100%**. The reset date is correct (both entries share `quota_reset_date_utc: 2026-11-01`). The tooltip has no `x / y` credit amount because entitlement is 0.

[NEEDS CLARIFICATION: why the chip seemed correct before the month rolled over. It may have been genuinely near 100% on the Business account at month end, or the second account may have been added around then. It doesn't change the fix.]

## Suspected Code Paths

- `src/main/rate-limits/copilot-usage-fetch.ts:readCopilotUsageCache()` picks the entry with the newest `retrievedAt` across all accounts. Here that is the individual account with no quota, because the CLI writes it last.
- `src/main/rate-limits/copilot-usage-fetch.ts:mapMonthlyUsage()` only skips `unlimited === true`. A snapshot with `has_quota: false`, `entitlement: 0`, `percent_remaining: 0` is turned into `usedPercent = 100 - 0 = 100`, so "no quota" shows as "quota exhausted".
- `src/main/rate-limits/copilot-usage-fetch.test.ts` ("prefers the freshest cache entry across accounts") locks in the freshest-wins rule. It has no case where the freshest entry has no quota.

## Root Cause Hypothesis

**Confidence: high.** The cache holds one entry per signed-in account. Orca picks the freshest one, which is the personal account with no premium quota. Its snapshot reports `percent_remaining: 0` with `has_quota: false`, and `mapMonthlyUsage` treats that as 100% used. The reset countdown looks right only because both accounts share the same reset date. The 20.9 credits the user sees elsewhere match the Business entry exactly (6726 − 6705.1 = 20.9). That confirms the right data is in the file but Orca reads the wrong entry.

## Proposed Remediation

**Preferred**: make the reader pick an account that actually has a premium quota.
1. Add a helper such as `hasUsablePremiumQuota(response)`. It returns true when the `premium_interactions` snapshot exists and either `unlimited === true`, or `has_quota !== false` with `entitlement > 0`.
2. In `readCopilotUsageCache`, sort by `retrievedAt` as today, then choose the freshest entry that passes the helper. If none pass, fall back to the freshest entry overall, so a no-quota-only setup still shows the existing "did not report a credits quota" state.
3. In `mapMonthlyUsage`, return `null` when `has_quota === false` or `entitlement === 0`. A no-quota account must never show as 100% used, even if it is the only entry. Add `has_quota?: boolean` to `CopilotQuotaSnapshot`.

**Alternatives**:
- Prefer the account the Copilot CLI is currently logged in as, read from `~/.copilot/config.json`. This is more "correct" for users with two quota-bearing accounts, but it adds a second file and format to depend on. That format is undocumented and cross-platform paths are unverified. It could be a follow-up.
- Show every account, or the one with the highest usage. This needs UI changes, which is out of scope for a bug fix.

**Files likely to change**:
- `src/main/rate-limits/copilot-usage-fetch.ts`
- `src/main/rate-limits/copilot-usage-fetch.test.ts`

**Tests to add or update**:
- Two entries where the freshest is a no-quota account (`has_quota: false`, entitlement 0, percent_remaining 0) and the older one is Business. Expect usedPercent ≈ 0.4 and usageAmount `{ used: 20.9, total: 6726 }`.
- Only a no-quota entry. Expect `status: 'unavailable'`, not 100%.
- Keep the existing "freshest wins" test, valid when both entries have a quota.

## Risks & Considerations

- If two accounts both have real quotas, "freshest with quota" may still flip between them as the CLI refreshes in a different order. The alternative above handles that.
- No wire, IPC or schema change: `ProviderRateLimits` keeps its shape. Remote/SSH clients are not affected.
- `has_quota` is an observed field, not a documented one. Treating a missing value as "has quota" keeps older cache shapes working.

## Open Questions

- [NEEDS CLARIFICATION: Is the personal account signed in on purpose? If so, should the chip ever show it, or only quota-bearing accounts?]
