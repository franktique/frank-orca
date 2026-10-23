# Bug Assessment: Evidence screenshots not grouped/named by test case

- **Slug**: evidence-per-test-case-folder
- **Created**: 2026-10-23
- **Source**: pasted text
- **Verdict**: valid (enhancement-style defect against the requested behavior)
- **Severity**: low

## Report (verbatim or summarized)

> En los cambios actuales de esta rama, para la generación de las evidencias al correr la postman collection tests, usando el test map, me gustaría que los archivos de evidencias queden en una carpeta en esa ruta, nombrados con el nombre o sigla del test case, por ejemplo 'SC-1, SC-2', S1, etc

## Symptom

A run writes every screenshot flat into `<run>/images/` with names like `03-sc-1-request.png`: the case id is lowercased and slugified, prefixed by a run-order number, and no per-case grouping exists. Expected: each test case (test-map `stepId`, e.g. `SC-1`, `S-1`) gets its own folder under the run folder, and its files carry the case's sigla.

Decision (user-confirmed): **one folder per case**, e.g. `<run>/03-SC-1/SC-1-request.png`, `SC-1-before-1.png`, `SC-1-after-1.png`.

## Reproduction

1. Run a collection with a test map (entries with `stepId` such as `SC-1`).
2. Open `evidencias/<plan-slug>/<timestamp>/`.
3. Observe `images/03-sc-1-request.png` etc. — flat, lowercased, order-prefixed, no per-case folder.

## Suspected Code Paths

- `src/main/test-orchestrator/evidence-names.ts:35` — `evidenceImageName` builds `NN-<slug>-<role>.png`; `slugifyForEvidence` lowercases `SC-1` to `sc-1`.
- `src/main/test-orchestrator/evidence-writer.ts:106` — `writeImage` writes into `images/` and returns `images/<name>`.
- `src/shared/test-orchestrator/evidence-markdown-text.ts:58` — `toRelativeImageLink` forces an `images/` prefix on report links.
- Callers passing `(step.index + 1, step.stepId, role, png)`: `test-run-step-executor.ts:180`, `database-modes/query-step-hooks.ts:93`, `database-modes/browser-query-runner.ts:88`, `run-evidence-session.ts:41`, `late-evidence-capture.ts:15`.
- `specs/003-e2e-test-orchestrator/contracts/evidence-bundle-format.md` — documents the `images/` layout and naming (public format; must be updated).
- Fixtures `src/shared/test-orchestrator/__fixtures__/evidence/*.md` and tests `evidence-writer.test.ts`, `evidence-markdown*.test.ts` assert the old paths.
- Auto-assigned ids come from `plan-steps.ts:14` (`P-`, `S-`, `SC-`, `C-` + counter), so every step has a stepId — including unmapped requests.

## Root Cause Hypothesis

Not a malfunction: the bundle format was designed (FR-021 contract) as a flat `images/` directory with Windows-safe lowercase slugs, so the feature simply doesn't group or name by case sigla. Confidence: high.

## Proposed Remediation

**Preferred**: Change `writeImage` to write to `<run>/<case-folder>/<case-name>-<role>[-n].png`, where `<case-folder>` is a filesystem-safe form of `stepId` that **preserves case** (`SC-1`, `S-1`). Add a `safeCaseName(stepId)` in `evidence-names.ts` (strip non-`[A-Za-z0-9._-]` chars, collapse, cap length, keep the Windows reserved-name guard such as `CON`/`NUL`). Keep the zero-padded plan-order prefix on the **folder** (`01-S-1/`, `03-SC-1/`) so Finder/`ls` list cases in plan order (setup first, then scenarios, each in Postman collection order, as `buildPlanSteps` already orders them); files inside are named by the sigla only (`SC-1-request.png`). Have `writeImage` return `<case-folder>/<file>` and make `toRelativeImageLink` stop forcing `images/` (keep accepting legacy `images/…` input so old stored runs still render). Collision handling: two distinct stepIds that sanitize to the same name (case-insensitive on macOS/Windows, e.g. `sc-1` vs `SC-1`) must get a disambiguating suffix. Concurrent groups keep `-<n>` suffix.

**Alternatives**:
- Single flat folder with `SC-1-request.png` (no per-case subfolder): simpler, but rejected by the user.
- Keep `images/` as the parent of per-case folders (`images/SC-1/…`): minimal link changes, but not what was asked ("una carpeta" per case in that path).

**Files likely to change**:
- `src/main/test-orchestrator/evidence-names.ts`
- `src/main/test-orchestrator/evidence-writer.ts`
- `src/shared/test-orchestrator/evidence-markdown-text.ts`
- `src/main/test-orchestrator/evidence-writer.test.ts`, `src/shared/test-orchestrator/evidence-markdown*.test.ts`, fixtures under `__fixtures__/evidence/`
- `specs/003-e2e-test-orchestrator/contracts/evidence-bundle-format.md` (and any quickstart/spec text mentioning `images/`)

**Tests to add or update**:
- `evidenceImageName`/folder name keeps `SC-1` case, sanitizes unsafe chars, guards Windows reserved names.
- Writer places files under `<run>/SC-1/…` and returns the matching relative link; the report links resolve.
- Case-insensitive collision between two stepIds is disambiguated.
- Legacy `images/…` links still render.

## Risks & Considerations

- Public output format change: update the contract doc and fixtures together; old evidence folders keep `images/` and must still open (SC-004 readability).
- macOS (APFS default) is case-insensitive: `sc-1` vs `SC-1` would collide, but stepIds are unique per map, so this only guards against ids differing by case; dedupe case-insensitively. Also on Windows: `sc-1` and `SC-1` collide; user-defined stepIds may contain `/`, `\`, `:` — must be sanitized (path traversal risk if stepId is used unsanitized).
- Folder workspaces and SSH: writing happens locally in the worktree root as today; no change in execution-host boundary.
- Mixed pre/post-change run folders for the same plan are fine (each run is its own timestamp folder).

## Open Questions

- [NEEDS CLARIFICATION: should `report.md` itself also move/stay at the run root? Assumed it stays at the run root.]
