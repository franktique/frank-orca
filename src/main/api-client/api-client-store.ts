import { randomUUID } from 'node:crypto'
import type { SecretStore } from '../../shared/secret-store'
import { getSecretStore } from '../../shared/secret-store'
import type {
  ApiClientChangedEvent,
  ApiClientFailure,
  ApiClientResult
} from '../../shared/api-client/api-client-ipc-schemas'
import {
  collectionSchema,
  metaFileSchema,
  persistedEnvironmentSchema,
  stateFileSchema,
  type PersistedEnvironment,
  type StateFile
} from '../../shared/api-client/api-client-schemas'
import {
  API_CLIENT_SCHEMA_VERSION,
  type ApiNodeId,
  type Collection,
  type Environment,
  type SecretProtection,
  type WorktreeApiData
} from '../../shared/api-client/api-client-types'
import {
  getApiClientRoot,
  getApiClientWorktreePaths,
  type ApiClientWorktreePaths
} from './api-client-storage-paths'
import { decryptEnvironmentSecrets } from './api-client-secret-codec'
import { getSecretProtection } from '../secret-value-codec'
import {
  listJsonFileNames,
  readJsonFile,
  removeFileIfPresent,
  writeJsonFile
} from './api-client-store-files'
import {
  commitTransaction,
  createTransaction,
  type StoreTransaction
} from './api-client-store-transaction'

export type ApiClientStoreOptions = {
  root?: string
  secretStore?: () => SecretStore
  newId?: () => string
  now?: () => number
}

/** The mutable, in-memory copy of one worktree's data. Only transactions change it. */
export type WorktreeApiState = {
  worktreeId: string
  paths: ApiClientWorktreePaths
  createdAt: number | null
  schemaVersion: number
  readOnly: boolean
  state: StateFile
  collections: Map<ApiNodeId, Collection>
  environments: Map<ApiNodeId, Environment>
  /** Kept so an untouched secret keeps its cipher text byte-for-byte. */
  persistedEnvironments: Map<ApiNodeId, PersistedEnvironment>
  corruptFiles: string[]
}

export type ApiClientSnapshot = WorktreeApiData & {
  secretProtection?: SecretProtection
}

export function failure(
  code: ApiClientFailure['code'],
  message: string,
  extra: Partial<ApiClientFailure> = {}
): ApiClientFailure {
  return { ok: false, code, message, ...extra }
}

export class ApiClientStore {
  private readonly root: string
  private readonly secretStoreProvider: () => SecretStore
  readonly newId: () => string
  readonly now: () => number
  private readonly loaded = new Map<string, Promise<WorktreeApiState>>()
  private readonly locks = new Map<string, Promise<unknown>>()
  private readonly listeners = new Set<(event: ApiClientChangedEvent) => void>()

  constructor(options: ApiClientStoreOptions = {}) {
    this.root = options.root ?? getApiClientRoot()
    this.secretStoreProvider = options.secretStore ?? getSecretStore
    this.newId = options.newId ?? randomUUID
    this.now = options.now ?? Date.now
  }

  get secretStore(): SecretStore {
    return this.secretStoreProvider()
  }

  onChange(listener: (event: ApiClientChangedEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  emit(event: ApiClientChangedEvent): void {
    for (const listener of this.listeners) {
      listener(event)
    }
  }

  /** Drops the cache; the next access reloads from disk (used after deleting a worktree). */
  evict(worktreeId: string): void {
    this.loaded.delete(worktreeId)
  }

  getState(worktreeId: string): Promise<WorktreeApiState> {
    let pending = this.loaded.get(worktreeId)
    if (!pending) {
      pending = this.loadFromDisk(worktreeId)
      this.loaded.set(worktreeId, pending)
      pending.catch(() => this.loaded.delete(worktreeId))
    }
    return pending
  }

  private async loadFromDisk(worktreeId: string): Promise<WorktreeApiState> {
    const paths = getApiClientWorktreePaths(worktreeId, this.root)
    const corruptFiles: string[] = []
    const track = (name: string, result: { kind: string; quarantinedAs?: string | null }): void => {
      if (result.kind === 'corrupt') {
        corruptFiles.push(name)
      }
    }

    const meta = await readJsonFile(paths.metaFile, metaFileSchema, paths.corruptDir)
    track('meta.json', meta)
    const schemaVersion = meta.kind === 'ok' ? meta.value.schemaVersion : API_CLIENT_SCHEMA_VERSION
    const savedState = await readJsonFile(paths.stateFile, stateFileSchema, paths.corruptDir)
    track('state.json', savedState)
    const state: StateFile =
      savedState.kind === 'ok'
        ? savedState.value
        : { activeEnvironmentId: null, collectionOrder: [], environmentOrder: [], revision: 0 }

    const collections = new Map<ApiNodeId, Collection>()
    for (const name of await listJsonFileNames(paths.collectionsDir)) {
      const result = await readJsonFile(
        `${paths.collectionsDir}/${name}`,
        collectionSchema,
        paths.corruptDir
      )
      track(`collections/${name}`, result)
      if (result.kind === 'ok') {
        collections.set(result.value.id, result.value)
      }
    }

    const secretStore = this.secretStore
    const environments = new Map<ApiNodeId, Environment>()
    const persistedEnvironments = new Map<ApiNodeId, PersistedEnvironment>()
    for (const name of await listJsonFileNames(paths.environmentsDir)) {
      const result = await readJsonFile(
        `${paths.environmentsDir}/${name}`,
        persistedEnvironmentSchema,
        paths.corruptDir
      )
      track(`environments/${name}`, result)
      if (result.kind === 'ok') {
        persistedEnvironments.set(result.value.id, result.value)
        environments.set(result.value.id, decryptEnvironmentSecrets(result.value, secretStore))
      }
    }

    return {
      worktreeId,
      paths,
      createdAt: meta.kind === 'ok' ? meta.value.createdAt : null,
      schemaVersion,
      // Why: a newer build wrote this data; editing it could drop fields we do not know.
      readOnly: schemaVersion > API_CLIENT_SCHEMA_VERSION,
      state,
      collections,
      environments,
      persistedEnvironments,
      corruptFiles
    }
  }

  /** Serializes writers per worktree so two edits never interleave their file writes. */
  private async withLock<T>(worktreeId: string, task: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(worktreeId) ?? Promise.resolve()
    const next = previous.then(task, task)
    const tail = next.catch(() => undefined)
    this.locks.set(worktreeId, tail)
    void tail.then(() => {
      if (this.locks.get(worktreeId) === tail) {
        this.locks.delete(worktreeId)
      }
    })
    return next
  }

  /**
   * Runs `task` against the worktree's state and persists whatever it touched. A task that
   * returns a failure result persists nothing.
   */
  async transact<T extends ApiClientResult<object>>(
    worktreeId: string,
    task: (data: WorktreeApiState, tx: StoreTransaction) => Promise<T> | T
  ): Promise<T | ApiClientFailure> {
    return this.withLock(worktreeId, async () => {
      const data = await this.getState(worktreeId)
      if (data.readOnly) {
        return failure('read-only', 'This data was written by a newer version of Orca.')
      }
      const tx = createTransaction(data)
      const result = await task(data, tx)
      if (!result.ok) {
        // Why: a task may have mutated the cache before failing; reload to stay truthful.
        if (tx.isDirty()) {
          this.evict(worktreeId)
        }
        return result
      }
      try {
        const events = await commitTransaction(this, data, tx)
        for (const event of events) {
          this.emit(event)
        }
      } catch (error) {
        this.evict(worktreeId)
        throw error
      }
      return result
    })
  }

  async getSnapshot(
    worktreeId: string,
    options: { revealSecrets?: boolean } = {}
  ): Promise<ApiClientSnapshot> {
    const data = await this.getState(worktreeId)
    const ordered = <T extends { id: string }>(items: Map<string, T>, order: string[]): T[] => {
      const known = order.flatMap((id) => (items.has(id) ? [items.get(id)!] : []))
      const unlisted = [...items.values()].filter((item) => !order.includes(item.id))
      return [...known, ...unlisted]
    }
    const environments = ordered(data.environments, data.state.environmentOrder).map((env) => ({
      ...env,
      variables: env.variables.map((variable) =>
        variable.type === 'secret' && !options.revealSecrets && variable.value !== null
          ? { ...variable, value: null, masked: true }
          : variable
      )
    }))
    const hasSecrets = environments.some((env) => env.variables.some((v) => v.type === 'secret'))
    const protection = hasSecrets ? getSecretProtection(this.secretStore) : null
    return {
      worktreeId,
      schemaVersion: API_CLIENT_SCHEMA_VERSION,
      collections: ordered(data.collections, data.state.collectionOrder),
      environments,
      activeEnvironmentId: data.state.activeEnvironmentId,
      revision: data.state.revision,
      readOnly: data.readOnly,
      corruptFiles: data.corruptFiles,
      ...(protection ? { secretProtection: protection } : {})
    }
  }

  async setActiveEnvironment(
    worktreeId: string,
    environmentId: ApiNodeId | null
  ): Promise<ApiClientResult> {
    return this.transact(worktreeId, (data, tx) => {
      if (environmentId !== null && !data.environments.has(environmentId)) {
        return failure('not-found', 'Environment not found.')
      }
      data.state.activeEnvironmentId = environmentId
      tx.touchState('active-environment')
      return { ok: true as const }
    })
  }

  async writeMetaIfMissing(data: WorktreeApiState): Promise<void> {
    if (data.createdAt !== null) {
      return
    }
    data.createdAt = this.now()
    await writeJsonFile(data.paths.metaFile, {
      schemaVersion: API_CLIENT_SCHEMA_VERSION,
      worktreeId: data.worktreeId,
      createdAt: data.createdAt
    })
  }

  removeFile(path: string): Promise<void> {
    return removeFileIfPresent(path)
  }
}
