# Bug Verification: Evidence screenshots grouped and named by test case

- **Slug**: evidence-per-test-case-folder
- **Tested**: 2026-10-23
- **Assessment**: ./assessment.md
- **Fix**: ./fix.md
- **Result**: partial

## Summary

The automated checks pass and a direct exercise of the real evidence writer produces the requested layout (`03-SC-1/SC-1-request.png`, case preserved, one folder per case). The assessment's reproduction (a full run of a real Postman collection with a test map) was not performed, so the result is `partial` rather than `verified`.

## Checks Performed

| Check | Command / Action | Result | Notes |
|-------|------------------|--------|-------|
| Reproduction (post-fix), writer-level | Temporary vitest calling `createEvidenceWriter().writeImage` for `S-1`, `SC-1` (request/before/after), `../x:y` (concurrent), then listing the run folder; test file removed afterwards | pass | Folders `01-S-1`, `03-SC-1`, `04-x-y`; no `images/` dir; links match files on disk |
| Reproduction (post-fix), end-to-end | Run a real Postman collection with a test map and inspect `evidencias/<plan>/<ts>/` | not-run | Needs the Electron app and a live collection; left as a follow-up from fix.md |
| New / updated tests | `npx vitest run src/main/test-orchestrator src/shared/test-orchestrator` | pass | 34 files passed, 1 skipped; 293 tests passed, 4 skipped |
| Type-check (node) | `npx tsc --noEmit -p config/tsconfig.node.json` | pass | Clean |
| Type-check (web) | `npx tsc --noEmit -p config/tsconfig.tc.web.json` | pass | Clean (the fix run had skipped this) |
| Lint | `npx oxlint src/main/test-orchestrator src/shared/test-orchestrator` | pass | Exit 0 |
| Leftover `images/` references | `grep -rn "images/" src` (non-test `.ts`/`.tsx`) | pass | Only the comment in `evidence-markdown-text.ts:55` about legacy links |
| `check:code-quality:changed` | n/a | not-run | `pnpm` not on PATH; the script was not run |

## Output Excerpts

```
Test Files  34 passed | 1 skipped (35)
     Tests  293 passed | 4 skipped (297)
```

Writer exercise, links returned:

```
01-S-1/S-1-request.png
03-SC-1/SC-1-request.png
03-SC-1/SC-1-before-1.png
03-SC-1/SC-1-after-1.png
04-x-y/x-y-request-2.png      (stepId "../x:y" sanitized, no traversal)
05-NUL-case/NUL-case-request.png   (Windows reserved name guarded)
```

## Residual Risks

- No end-to-end run against a real collection and test map; the callers that pass `(step.index + 1, step.stepId, role, png)` are covered only by their unit tests.
- Folder layout was checked on macOS only; the Windows reserved-name and case-insensitive behavior is covered by unit tests, not by a Windows run.
- `report.md` rendering of the new links was verified through fixtures and tests, not by opening a generated report in the app.
- `pnpm run check:code-quality:changed` (CI gate) was not run.

## Recommendation

Hold, with a leaning to close. Run one real collection with a test map, confirm the folders in Finder and that `report.md` images render, and run `pnpm run check:code-quality:changed`. Once those pass, the bug can be closed as verified.
