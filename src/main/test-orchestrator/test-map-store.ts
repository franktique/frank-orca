import { z } from 'zod'
import type { SecretStore } from '../../shared/secret-store'
import { getSecretStore } from '../../shared/secret-store'
import { API_CLIENT_LIMITS } from '../../shared/api-client/api-client-types'
import type { RunRequestResult } from '../../shared/api-client/api-client-types'
import {
  StoredPlanSettingsSchema,
  StoredTestMapSchema,
  StoredTestRunSchema
} from '../../shared/test-orchestrator/test-orchestrator-schemas'
import type {
  PlanSettings,
  TestMap,
  TestRun
} from '../../shared/test-orchestrator/test-orchestrator-types'
import { removeFileIfPresent } from '../api-client/api-client-store-files'
import { getApiClientWorktreePaths } from '../api-client/api-client-storage-paths'
import { capDetailBodies, enforceRunSizeCap } from '../api-client/collection-runner'
import {
  UNSEALED_CIPHER,
  getSecretProtection,
  openSecretCipher,
  sealSecretValue
} from '../secret-value-codec'
import { CaptureLedgerStore } from './capture-ledger-store'
import {
  readStoredFile,
  STORED_SCHEMA_VERSION,
  type StoredRead,
  writeStoredFile
} from './stored-test-file'

export { StoredFileReadOnlyError } from './stored-test-file'
export type { StoredRead } from './stored-test-file'

const looseTestMapSchema = StoredTestMapSchema.extend({ schemaVersion: z.number() })
const loosePlanSchema = StoredPlanSettingsSchema.extend({ schemaVersion: z.number() })
const looseRunSchema = StoredTestRunSchema.extend({ schemaVersion: z.number() })

export type PlanSettingsRead = StoredRead<PlanSettings> & {
  /** Secret inputs that were not saved or cannot be decrypted and must be re-entered. */
  unavailableSecretInputs: string[]
}

const SIZE_CAP_MESSAGE = 'Details were dropped to keep the run file within the size limit.'

/** Caps response bodies, then drops the oldest exchange details until the run fits 50 MB. */
export function capTestRun(run: TestRun): TestRun {
  const capped: TestRun = {
    ...run,
    steps: run.steps.map((step) => ({
      ...step,
      exchanges: step.exchanges.map((exchange) => ({
        ...exchange,
        outcome: capDetailBodies(exchange.outcome)
      }))
    }))
  }
  const exchanges = capped.steps.flatMap((step) => step.exchanges)
  const results: RunRequestResult[] = exchanges.map((exchange) => ({
    iteration: 0,
    requestId: exchange.requestId,
    requestName: '',
    folderPath: [],
    durationMs: 0,
    tests: [],
    detail: { resolvedRequest: exchange.resolvedRequest, outcome: exchange.outcome, scriptLogs: [] }
  }))
  enforceRunSizeCap(results, API_CLIENT_LIMITS.runFileMaxBytes)
  results.forEach((result, index) => {
    const exchange = exchanges[index]
    if (result.detail === null && exchange) {
      exchange.outcome = { kind: 'error', code: 'cancelled', message: SIZE_CAP_MESSAGE }
    }
  })
  return capped
}

export class TestMapStore {
  /** Capture ledger operations: `append`, `markCleaned`, `listUncleaned`, `forget`. */
  readonly ledger: CaptureLedgerStore
  private readonly root: string | undefined
  private readonly secretStore: () => SecretStore

  constructor(options: { root?: string; secretStore?: () => SecretStore } = {}) {
    this.root = options.root
    this.secretStore = options.secretStore ?? getSecretStore
    this.ledger = new CaptureLedgerStore(options)
  }

  async getMap(worktreeId: string, collectionId: string): Promise<StoredRead<TestMap>> {
    const paths = getApiClientWorktreePaths(worktreeId, this.root)
    const read = await readStoredFile(
      paths.testMapFile(collectionId),
      StoredTestMapSchema,
      looseTestMapSchema,
      paths.corruptDir
    )
    return read.kind === 'ok'
      ? { value: read.data.map, readOnly: read.readOnly }
      : { value: null, readOnly: false }
  }

  async saveMap(worktreeId: string, collectionId: string, map: TestMap): Promise<void> {
    const paths = getApiClientWorktreePaths(worktreeId, this.root)
    await writeStoredFile(paths.testMapFile(collectionId), {
      schemaVersion: STORED_SCHEMA_VERSION,
      map
    })
  }

  async removeMap(worktreeId: string, collectionId: string): Promise<void> {
    const paths = getApiClientWorktreePaths(worktreeId, this.root)
    await removeFileIfPresent(paths.testMapFile(collectionId))
  }

  async getPlanSettings(worktreeId: string, collectionId: string): Promise<PlanSettingsRead> {
    const paths = getApiClientWorktreePaths(worktreeId, this.root)
    const read = await readStoredFile(
      paths.testPlanFile(collectionId),
      StoredPlanSettingsSchema,
      loosePlanSchema,
      paths.corruptDir
    )
    if (read.kind !== 'ok') {
      return { value: null, readOnly: false, unavailableSecretInputs: [] }
    }
    const secretInputs: Record<string, string> = {}
    const unavailableSecretInputs: string[] = []
    for (const [name, cipher] of Object.entries(read.data.settings.secretInputs)) {
      const opened = openSecretCipher(cipher, this.secretStore())
      if (opened === null) {
        unavailableSecretInputs.push(name)
      } else {
        secretInputs[name] = opened
      }
    }
    return {
      value: { ...read.data.settings, secretInputs },
      readOnly: read.readOnly,
      unavailableSecretInputs
    }
  }

  async savePlanSettings(
    worktreeId: string,
    collectionId: string,
    settings: PlanSettings
  ): Promise<void> {
    const paths = getApiClientWorktreePaths(worktreeId, this.root)
    const store = this.secretStore()
    const memoryOnly = getSecretProtection(store)?.level === 'memory-only'
    const secretInputs: Record<string, string> = {}
    for (const [name, value] of Object.entries(settings.secretInputs)) {
      secretInputs[name] = memoryOnly ? UNSEALED_CIPHER : sealSecretValue(value, store)
    }
    await writeStoredFile(paths.testPlanFile(collectionId), {
      schemaVersion: STORED_SCHEMA_VERSION,
      settings: { ...settings, secretInputs }
    })
  }

  /** Each run replaces the previous one (FR-005d). */
  async saveRun(worktreeId: string, collectionId: string, run: TestRun): Promise<void> {
    const paths = getApiClientWorktreePaths(worktreeId, this.root)
    await writeStoredFile(paths.testRunFile(collectionId), {
      schemaVersion: STORED_SCHEMA_VERSION,
      run: capTestRun(run)
    })
  }

  async getRun(worktreeId: string, collectionId: string): Promise<StoredRead<TestRun>> {
    const paths = getApiClientWorktreePaths(worktreeId, this.root)
    const read = await readStoredFile(
      paths.testRunFile(collectionId),
      StoredTestRunSchema,
      looseRunSchema,
      paths.corruptDir
    )
    return read.kind === 'ok'
      ? { value: read.data.run, readOnly: read.readOnly }
      : { value: null, readOnly: false }
  }
}
