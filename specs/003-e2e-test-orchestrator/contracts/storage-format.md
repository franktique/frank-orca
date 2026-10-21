# Contract: Storage Format (Orca data, outside the repository)

All files live inside feature 001's per-worktree directory. Deleting a worktree or folder workspace, the tombstone drain, and startup orphan GC already remove them, so no new deletion hook is needed (FR-003b). Writes use `writeJsonFile` (`writeFileDurable`). Reads use `readJsonFile`, which moves an invalid file to `corrupt/` and loads as if it were missing.

```
userData/api-client/<hashWorktreeId(worktreeId)>/
├── … (feature 001 files)
├── test-maps/<safeStem(collectionId)>.json
├── test-plans/<safeStem(collectionId)>.json
├── test-captures/<safeStem(collectionId)>.json
└── test-runs/<safeStem(collectionId)>.json
```

`safeStem` is the existing `toSafeFileStem`. Paths are added to `ApiClientWorktreePaths` (`testMapFile`, `testPlanFile`, `testCapturesFile`, `testRunFile`).

| File                   | Schema                      | Content                                                                                                                                                                                                                           |
| ---------------------- | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `test-maps/*.json`     | `StoredTestMapSchema`       | `{ schemaVersion: 1, map: TestMap }`. `TestMap` is from data-model.md, with the original `ref` and the resolved `link` for each entry                                                                                             |
| `test-plans/*.json`    | `StoredPlanSettingsSchema`  | `{ schemaVersion: 1, settings: PlanSettings }`. `secretInputs` values are `sealSecretValue` ciphers. When `getSecretProtection()` reports `memory-only`, secrets are not written and the UI shows the 001 protection notice       |
| `test-captures/*.json` | `StoredCaptureLedgerSchema` | `{ schemaVersion: 1, ledger: CaptureLedger }`. Values whose variable name is sensitive (R9) are sealed                                                                                                                            |
| `test-runs/*.json`     | `StoredTestRunSchema`       | `{ schemaVersion: 1, run: TestRun }`. Response bodies are capped with the 001 `capDetailBodies`, the file is capped at 50 MB with `enforceRunSizeCap`, and there are no images. Each test run replaces the previous one (FR-005d) |

**Downgrade safety**: these files are new, so an older Orca ignores them. A newer `schemaVersion` is treated like 001's `readOnly`: the data is shown, and saving and starting runs are refused with a message.

**Re-import**: when a collection is replaced by import, `test-maps/<id>.json` is matched again from its stored references (R4), and the warning is shown in the import result. A re-import that keeps the old collection id leaves the ledger and plan settings in place. A new id starts with none.
