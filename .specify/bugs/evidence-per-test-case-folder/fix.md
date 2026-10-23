# Bug Fix: Evidence screenshots grouped and named by test case

- **Slug**: evidence-per-test-case-folder
- **Fixed**: 2026-10-23
- **Assessment**: ./assessment.md
- **Status**: applied

## Summary

Screenshots now go into one folder per test case (`<run>/03-SC-1/SC-1-request.png`) instead of a flat lowercased `images/` folder. The case sigla keeps its casing in both folder and file names, and `report.md` links point at the new paths.

## Changes

| File | Change | Notes |
|------|--------|-------|
| `src/main/test-orchestrator/evidence-names.ts` | modified | Added `safeCaseName` (case-preserving, sanitized, 60-char cap, Windows reserved-name guard). `evidenceImageName` now returns `NN-<case>/<case>-<role>[-n].png`. |
| `src/main/test-orchestrator/evidence-writer.ts` | modified | `writeImage` creates the case folder and returns the relative link; `images/` dir removed. |
| `src/shared/test-orchestrator/evidence-markdown-text.ts` | modified | `toRelativeImageLink` no longer forces an `images/` prefix; legacy `images/…` input passes through. |
| `src/main/test-orchestrator/evidence-writer.test.ts` | updated tests | New naming, folder layout, traversal/reserved-name cases. |
| `src/main/test-orchestrator/run-evidence-session.test.ts` | updated test | Expects `01-S-1/S-1-request.png`. |
| `src/shared/test-orchestrator/evidence-markdown-text.test.ts` | added test | Per-case and legacy link handling. |
| `src/shared/test-orchestrator/evidence-markdown*.test.ts`, `__fixtures__/evidence/*.md` | updated | Screenshot paths moved to `03-SC-1/SC-1-…`. |
| `specs/003-e2e-test-orchestrator/contracts/evidence-bundle-format.md`, `research.md`, `quickstart.md` | modified | Layout and naming docs updated. |

## Tests Added or Updated

- `evidence-writer.test.ts::safeCaseName` — keeps `SC-1` casing, strips `\ : / ..`, falls back to `step`, guards `NUL`/`com1`.
- `evidence-writer.test.ts::evidenceImageName` — folder/file format; ids differing only by case land in distinct folders.
- `evidence-writer.test.ts::createEvidenceWriter` — files written under `<run>/03-SC-1/`, no `images/` dir, links stay inside the run folder.
- `evidence-markdown-text.test.ts` — per-case links and legacy `images/…` links.

## Local Verification

- `vitest run src/main/test-orchestrator src/shared/test-orchestrator` → 33 files passed, 291 tests passed (4 skipped, pre-existing).
- `tsc --noEmit -p config/tsconfig.node.json` → clean.
- `oxlint` on both test-orchestrator folders → clean.
- `pnpm` is not on PATH in this session, so the local binaries in `node_modules/.bin` were used. `tc:web` and `check:code-quality:changed` were not run.

## Deviations from Assessment

- No writer-level case-insensitive collision suffix. The zero-padded plan-order prefix on the folder is already unique per step, so ids that differ only by case (`sc-1` / `SC-1`) cannot share a folder. A test pins this.
- `evidenceImageName` returns the full relative path (`folder/file`) rather than a bare file name, so the writer and the report link share one value.

## Follow-ups

- Run once against a real Postman collection with a test map and confirm the folders in Finder.
- `[NEEDS CLARIFICATION]` from the assessment: `report.md` stays at the run root (assumed, implemented).
