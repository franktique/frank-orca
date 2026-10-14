# Bug Verification: Copilot usage chip stuck at 100% after monthly reset

- **Slug**: copilot-usage
- **Tested**: 2026-10-14
- **Assessment**: ./assessment.md
- **Fix**: ./fix.md
- **Result**: verified

## Summary

Reproduced the bug with the original code and confirmed the fix, using the real Copilot CLI cache on this machine (one Business account plus one personal no-quota account). The original code reports `individual` at 100% used. The fixed code reports `business` at 0.4% (20.9 / 6726). No regressions in the rate-limit or status-bar suites.

## Checks Performed

| Check | Command / Action | Result | Notes |
|-------|------------------|--------|-------|
| Reproduction (pre-fix) | `fetchCopilotRateLimits()` from `HEAD`, bundled with esbuild in the scratchpad and run on the real `~/Library/Caches/copilot/copilot-user-cache.json` | pass (bug reproduces) | `plan: individual`, `usedPercent: 100`, no `usageAmount` |
| Reproduction (post-fix) | Same harness with the working-tree `copilot-usage-fetch.ts` | pass | `plan: business`, `usedPercent: 0.4`, `usageAmount: 20.9 / 6726`, reset date unchanged |
| New / updated tests | `pnpm test src/main/rate-limits/copilot-usage-fetch.test.ts` (run during fix, then again in the suite below) | pass | 9/9. The 2 new tests fail against `HEAD` (checked during `/speckit-bug-fix`) |
| Regression suite | `pnpm test src/main/rate-limits src/renderer/src/components/status-bar` | pass | 103 files, 893 tests |
| Type-check | `pnpm tc:node` | pass | exit 0 |
| Lint / quality gate | `pnpm run check:code-quality:changed` | pass | 0 new findings on 2 changed files |
| Format | `oxfmt --check` on both changed files | pass | |
| Live status bar in Orca | Launch Orca and look at the Copilot chip | not-run | No Electron UI validation skill in this workspace. The renderer is unchanged and only formats the `monthly` window checked above |

## Output Excerpts

```
--- fixed:
{"status":"ok","plan":"business","monthly":{"usedPercent":0.40…,"resetsAt":1793491200000,"usageAmount":{"used":20.89…,"total":6726}}}
--- original (HEAD):
{"status":"ok","plan":"individual","monthly":{"usedPercent":100,"resetsAt":1793491200000}}
```

```
Test Files  103 passed (103)
     Tests  893 passed (893)
Changed-code quality gate passed since 989d7b1d5b8b.
```

## Residual Risks

- The status-bar pixels were not looked at. The check stops at the `ProviderRateLimits` value the main process sends to the renderer.
- If two accounts both have real quotas, the chip can still switch between them depending on which the CLI refreshed last (follow-up in `fix.md`).
- Only the macOS cache path is verified. Linux and Windows paths remain best guesses (unchanged by this fix).

## Recommendation

Close the bug. It was reproduced and shown fixed with the real data that caused it. Optionally, glance at the Copilot chip after the next 30s poll in a running Orca build to confirm it shows ~0% with "20.9 / 6,726".
