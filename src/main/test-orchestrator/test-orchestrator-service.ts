import { readFile, writeFile } from 'node:fs/promises'
import { basename } from 'node:path'
import type { z } from 'zod'
import type { ApiNodeId, Collection } from '../../shared/api-client/api-client-types'
import { serializeTestMap, findRequestPath } from '../../shared/test-orchestrator/test-map-export'
import {
  linkTestMapEntries,
  linkTestMapFile,
  rematchTestMap,
  type LinkWarnings
} from '../../shared/test-orchestrator/test-map-linking'
import { parseTestMapFile } from '../../shared/test-orchestrator/test-map-schema'
import type {
  answerPauseParamsSchema,
  clearRememberedSecretsParamsSchema,
  exportTestMapParamsSchema,
  forgetCapturesParamsSchema,
  getRunParamsSchema,
  getStepDetailParamsSchema,
  getTestMapParamsSchema,
  listConsoleTabsParamsSchema,
  loadTestMapParamsSchema,
  prepareParamsSchema,
  removeTestMapParamsSchema,
  resolveTargetsParamsSchema,
  saveQueriesParamsSchema,
  startRunParamsSchema,
  stopRunParamsSchema,
  testDatabaseParamsSchema,
  TestRunErrorCode
} from '../../shared/test-orchestrator/test-orchestrator-ipc-schemas'
import type {
  TestMap,
  TestMapEntry,
  TestMapIssue,
  TestMapRef
} from '../../shared/test-orchestrator/test-orchestrator-types'
import type { TestMapStore } from './test-map-store'
import type { PlanApiState } from './test-run-plan-context'
import { TestRunService } from './test-run-service'
import type { TestRunRuntime } from './test-run-service-types'

export type { QueryHooksRequest, QueryHooksResult, TestRunRuntime } from './test-run-service-types'

export type TestRunFailure = {
  ok: false
  code: TestRunErrorCode
  message: string
  issues?: TestMapIssue[]
  screenshot?: string
}

export type TestMapWarnings = {
  unmatched: TestMapRef[]
  ambiguous: LinkWarnings['ambiguous']
  unknownFields: string[]
}

export type LoadTestMapResult =
  | { ok: true; map: TestMap; warnings: TestMapWarnings }
  | TestRunFailure
export type SaveQueriesResult = { ok: true; map: TestMap } | TestRunFailure
export type SimpleResult = { ok: true } | TestRunFailure
export type ConsoleTab = { browserPageId: string; title: string; url: string }
export type ListConsoleTabsResult = { ok: true; tabs: ConsoleTab[] } | TestRunFailure

export type TestOrchestratorServiceDeps = {
  store: TestMapStore
  apiClient: {
    store: { getState(worktreeId: string): Promise<PlanApiState> }
  }
  browserBridge: {
    tabList(worktreeId?: string): { tabs: { browserPageId: string; title: string; url: string }[] }
  }
  emitTestMapChanged: (worktreeId: string, collectionId: ApiNodeId) => void
  /** Absent in contexts that never run tests (the run methods then throw). */
  runtime?: TestRunRuntime
}

const failure = (
  code: TestRunErrorCode,
  message: string,
  issues?: TestMapIssue[]
): TestRunFailure => ({ ok: false, code, message, ...(issues ? { issues } : {}) })

function refLabel(ref: TestMapRef): string {
  return 'path' in ref ? ref.path.join(' / ') : ref.id
}

/** One line per problem, for the API Client import warnings. */
export function formatLinkWarnings(warnings: LinkWarnings): string[] {
  return [
    ...warnings.unmatched.map((ref) => `Test map: no request matches ${refLabel(ref)}.`),
    ...warnings.ambiguous.map(
      ({ ref }) => `Test map: more than one request matches ${refLabel(ref)}.`
    ),
    ...warnings.broken.map(({ ref }) => `Test map: the request for ${refLabel(ref)} was removed.`)
  ]
}

async function readTestMapJson(
  filePath: string
): Promise<{ ok: true; json: unknown } | TestRunFailure> {
  try {
    return { ok: true, json: JSON.parse(await readFile(filePath, 'utf8')) }
  } catch (error) {
    const reason = error instanceof SyntaxError ? 'is not valid JSON' : 'could not be read'
    return failure('invalid-test-map', `The test map file ${reason}.`, [
      { path: '', message: `The file ${reason}.` }
    ])
  }
}

export class TestOrchestratorService {
  constructor(private readonly deps: TestOrchestratorServiceDeps) {
    this.runs = new TestRunService({
      store: deps.store,
      apiClient: deps.apiClient,
      getTestMap: (worktreeId, collectionId) => this.getTestMap({ worktreeId, collectionId }),
      runtime: deps.runtime
    })
  }

  private async getCollection(worktreeId: string, collectionId: ApiNodeId) {
    const state = await this.deps.apiClient.store.getState(worktreeId)
    return state.collections.get(collectionId) ?? null
  }

  async loadTestMap(params: z.output<typeof loadTestMapParamsSchema>): Promise<LoadTestMapResult> {
    const { worktreeId, collectionId } = params
    const collection = await this.getCollection(worktreeId, collectionId)
    if (!collection) {
      return failure('not-found', 'The collection no longer exists.')
    }
    const raw = await readTestMapJson(params.filePath)
    if (!raw.ok) {
      return raw
    }
    const parsed = parseTestMapFile(raw.json)
    if (!parsed.ok) {
      return failure('invalid-test-map', 'The test map file is not valid.', parsed.issues)
    }
    const existing = await this.deps.store.getMap(worktreeId, collectionId)
    if (existing.value && !params.replace) {
      return failure('conflict', 'A test map is already loaded for this collection.')
    }
    const { file } = parsed
    const { entries, warnings } = linkTestMapFile(file, collection)
    const map: TestMap = {
      orcaTestMap: 1,
      collectionId,
      ...(file.guide !== undefined ? { guidePath: file.guide } : {}),
      ...(file.allowedHosts !== undefined ? { allowedHosts: file.allowedHosts } : {}),
      ...(file.databaseConsole !== undefined ? { databaseConsole: file.databaseConsole } : {}),
      entries,
      loadedAt: Date.now(),
      sourceFileName: basename(params.filePath)
    }
    await this.deps.store.saveMap(worktreeId, collectionId, map)
    this.deps.emitTestMapChanged(worktreeId, collectionId)
    return {
      ok: true,
      map,
      warnings: {
        unmatched: warnings.unmatched,
        ambiguous: warnings.ambiguous,
        unknownFields: parsed.unknownFields
      }
    }
  }

  /** Link states are refreshed against the live collection but not persisted. */
  async getTestMap(params: z.output<typeof getTestMapParamsSchema>): Promise<TestMap | null> {
    const { worktreeId, collectionId } = params
    const stored = await this.deps.store.getMap(worktreeId, collectionId)
    if (!stored.value) {
      return null
    }
    const collection = await this.getCollection(worktreeId, collectionId)
    return collection
      ? { ...stored.value, entries: linkTestMapEntries(stored.value.entries, collection).entries }
      : stored.value
  }

  async saveQueries(params: z.output<typeof saveQueriesParamsSchema>): Promise<SaveQueriesResult> {
    const { worktreeId, collectionId, requestId } = params
    const collection = await this.getCollection(worktreeId, collectionId)
    if (!collection) {
      return failure('not-found', 'The collection no longer exists.')
    }
    const path = findRequestPath(collection.items, requestId, [])
    if (!path) {
      return failure('not-found', 'The request no longer exists.')
    }
    const stored = (await this.deps.store.getMap(worktreeId, collectionId)).value
    if (stored && stored.loadedAt !== params.baseLoadedAt) {
      return failure('conflict', 'The test map was replaced since it was opened.')
    }
    const map: TestMap = stored ?? {
      orcaTestMap: 1,
      collectionId,
      entries: [],
      loadedAt: Date.now()
    }
    const queries = { before: params.before, after: params.after }
    const hasEntry = map.entries.some(
      (entry) => entry.link.state === 'linked' && entry.link.requestId === requestId
    )
    const created: TestMapEntry = {
      ref: { path },
      link: { state: 'linked', requestId },
      ...queries
    }
    const next: TestMap = {
      ...map,
      entries: hasEntry
        ? map.entries.map((entry) =>
            entry.link.state === 'linked' && entry.link.requestId === requestId
              ? { ...entry, ...queries }
              : entry
          )
        : [...map.entries, created]
    }
    await this.deps.store.saveMap(worktreeId, collectionId, next)
    this.deps.emitTestMapChanged(worktreeId, collectionId)
    return { ok: true, map: next }
  }

  async exportTestMap(params: z.output<typeof exportTestMapParamsSchema>): Promise<SimpleResult> {
    const map = await this.getTestMap(params)
    const collection = await this.getCollection(params.worktreeId, params.collectionId)
    if (!map || !collection) {
      return failure('not-found', 'There is no test map to export for this collection.')
    }
    await writeFile(params.filePath, serializeTestMap(map, collection), 'utf8')
    return { ok: true }
  }

  async removeTestMap(params: z.output<typeof removeTestMapParamsSchema>): Promise<SimpleResult> {
    await this.deps.store.removeMap(params.worktreeId, params.collectionId)
    this.deps.emitTestMapChanged(params.worktreeId, params.collectionId)
    return { ok: true }
  }

  /** Re-links a stored map after its collection was replaced by an import; returns warning lines. */
  async rematchAfterImport(worktreeId: string, collection: Collection): Promise<string[]> {
    const stored = await this.deps.store.getMap(worktreeId, collection.id)
    if (!stored.value || stored.readOnly) {
      return []
    }
    const { map, warnings } = rematchTestMap(stored.value, collection)
    await this.deps.store.saveMap(worktreeId, collection.id, map)
    this.deps.emitTestMapChanged(worktreeId, collection.id)
    return formatLinkWarnings(warnings)
  }

  listConsoleTabs(params: z.output<typeof listConsoleTabsParamsSchema>): ListConsoleTabsResult {
    const { tabs } = this.deps.browserBridge.tabList(params.worktreeId)
    return {
      ok: true,
      tabs: tabs.map(({ browserPageId, title, url }) => ({ browserPageId, title, url }))
    }
  }

  // ─── Run orchestration ───

  private readonly runs: TestRunService

  prepare(params: z.output<typeof prepareParamsSchema>) {
    return this.runs.prepare(params)
  }
  resolveTargets(params: z.output<typeof resolveTargetsParamsSchema>) {
    return this.runs.resolveTargets(params)
  }
  clearRememberedSecrets(params: z.output<typeof clearRememberedSecretsParamsSchema>) {
    return this.runs.clearRememberedSecrets(params)
  }
  start(params: z.output<typeof startRunParamsSchema>) {
    return this.runs.start(params)
  }
  stop(params: z.output<typeof stopRunParamsSchema>) {
    return this.runs.stop(params)
  }
  answerPause(params: z.output<typeof answerPauseParamsSchema>) {
    return this.runs.answerPause(params)
  }
  getRun(params: z.output<typeof getRunParamsSchema>) {
    return this.runs.getRun(params)
  }
  getStepDetail(params: z.output<typeof getStepDetailParamsSchema>) {
    return this.runs.getStepDetail(params)
  }

  testDatabase(params: z.output<typeof testDatabaseParamsSchema>) {
    return this.runs.testDatabase(params)
  }
  forgetCaptures(params: z.output<typeof forgetCapturesParamsSchema>) {
    return this.runs.forgetCaptures(params)
  }
}

let service: TestOrchestratorService | null = null

export function initTestOrchestratorService(
  deps: TestOrchestratorServiceDeps
): TestOrchestratorService {
  service ??= new TestOrchestratorService(deps)
  return service
}

export function getTestOrchestratorService(): TestOrchestratorService {
  if (!service) {
    throw new Error('Test orchestrator service is not initialized')
  }
  return service
}

/** Test-only. */
export function resetTestOrchestratorServiceForTests(): void {
  service = null
}
