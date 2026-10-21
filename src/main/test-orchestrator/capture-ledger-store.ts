import type { SecretStore } from '../../shared/secret-store'
import { getSecretStore } from '../../shared/secret-store'
import {
  StoredCaptureLedgerSchema,
  captureLedgerSchema
} from '../../shared/test-orchestrator/test-orchestrator-schemas'
import type { CapturedValue } from '../../shared/test-orchestrator/test-orchestrator-types'
import { getApiClientWorktreePaths } from '../api-client/api-client-storage-paths'
import {
  UNSEALED_CIPHER,
  getSecretProtection,
  openSecretCipher,
  sealSecretValue
} from '../secret-value-codec'
import {
  readStoredFile,
  STORED_SCHEMA_VERSION,
  StoredFileReadOnlyError,
  writeStoredFile
} from './stored-test-file'
import { z } from 'zod'

const looseLedgerSchema = StoredCaptureLedgerSchema.extend({ schemaVersion: z.number() })

const SENSITIVE_VARIABLE = /token|secret|password|key/i

export function isSensitiveVariableName(variable: string): boolean {
  return SENSITIVE_VARIABLE.test(variable)
}

export type CaptureIdentity = { variable: string; runId: string; stepId: string }
export type CleanedMark = { runId: string; stepId: string; at: number }

const identityKey = (v: CaptureIdentity): string => `${v.variable}\u0000${v.runId}\u0000${v.stepId}`

type LedgerRead = { values: CapturedValue[]; readOnly: boolean }

/** Capture ledger per collection; sensitive values are sealed on disk or held in memory only. */
export class CaptureLedgerStore {
  private readonly root: string | undefined
  private readonly secretStore: () => SecretStore
  // Why: with no encryption, sensitive values live only for this app session (FR-017b).
  private readonly sessionValues = new Map<string, CapturedValue[]>()
  private readonly queues = new Map<string, Promise<unknown>>()

  constructor(options: { root?: string; secretStore?: () => SecretStore } = {}) {
    this.root = options.root
    this.secretStore = options.secretStore ?? getSecretStore
  }

  async append(worktreeId: string, collectionId: string, value: CapturedValue): Promise<void> {
    await this.mutate(worktreeId, collectionId, (stored, session) => {
      const persisted = this.toStored(value)
      if (persisted.unavailable) {
        session.push({ ...value, unavailable: undefined })
      }
      stored.push(persisted)
    })
  }

  async markCleaned(
    worktreeId: string,
    collectionId: string,
    match: CaptureIdentity,
    cleaned: CleanedMark
  ): Promise<void> {
    await this.mutate(worktreeId, collectionId, (stored, session) => {
      for (const list of [stored, session]) {
        for (const entry of list) {
          if (identityKey(entry) === identityKey(match) && entry.cleaned === null) {
            entry.cleaned = cleaned
          }
        }
      }
    })
  }

  /** Entries whose value was lost to a restart come back with `unavailable: true`. */
  async listUncleaned(worktreeId: string, collectionId: string): Promise<CapturedValue[]> {
    const { values } = await this.read(worktreeId, collectionId)
    return values.filter((entry) => entry.cleaned === null)
  }

  async list(worktreeId: string, collectionId: string): Promise<LedgerRead> {
    return this.read(worktreeId, collectionId)
  }

  /** Drops one capture, or the whole ledger when `match` is omitted. */
  async forget(worktreeId: string, collectionId: string, match?: CaptureIdentity): Promise<void> {
    await this.mutate(worktreeId, collectionId, (stored, session) => {
      for (const list of [stored, session]) {
        const kept = list.filter(
          (entry) => match !== undefined && identityKey(entry) !== identityKey(match)
        )
        list.splice(0, list.length, ...kept)
      }
    })
  }

  private paths(worktreeId: string): ReturnType<typeof getApiClientWorktreePaths> {
    return getApiClientWorktreePaths(worktreeId, this.root)
  }

  private sessionKey(worktreeId: string, collectionId: string): string {
    return `${worktreeId}\u0000${collectionId}`
  }

  private toStored(value: CapturedValue): CapturedValue {
    if (!isSensitiveVariableName(value.variable)) {
      return value
    }
    const store = this.secretStore()
    const memoryOnly = getSecretProtection(store)?.level === 'memory-only'
    const cipher = memoryOnly ? UNSEALED_CIPHER : sealSecretValue(value.value, store)
    return cipher === UNSEALED_CIPHER
      ? { ...value, value: '', unavailable: true }
      : { ...value, value: cipher }
  }

  private fromStored(entry: CapturedValue, session: CapturedValue[]): CapturedValue {
    if (!isSensitiveVariableName(entry.variable)) {
      return entry
    }
    if (entry.unavailable) {
      const live = session.find((candidate) => identityKey(candidate) === identityKey(entry))
      return live ? { ...entry, value: live.value, unavailable: undefined } : entry
    }
    const opened = openSecretCipher(entry.value, this.secretStore())
    return opened === null
      ? { ...entry, value: '', unavailable: true }
      : { ...entry, value: opened }
  }

  private async readStored(worktreeId: string, collectionId: string): Promise<LedgerRead> {
    const paths = this.paths(worktreeId)
    const read = await readStoredFile(
      paths.testCapturesFile(collectionId),
      StoredCaptureLedgerSchema,
      looseLedgerSchema,
      paths.corruptDir
    )
    return read.kind === 'ok'
      ? { values: read.data.ledger.values, readOnly: read.readOnly }
      : { values: [], readOnly: false }
  }

  private async read(worktreeId: string, collectionId: string): Promise<LedgerRead> {
    const { values, readOnly } = await this.readStored(worktreeId, collectionId)
    const session = this.sessionValues.get(this.sessionKey(worktreeId, collectionId)) ?? []
    return { values: values.map((entry) => this.fromStored(entry, session)), readOnly }
  }

  private mutate(
    worktreeId: string,
    collectionId: string,
    change: (stored: CapturedValue[], session: CapturedValue[]) => void
  ): Promise<void> {
    const file = this.paths(worktreeId).testCapturesFile(collectionId)
    const run = async (): Promise<void> => {
      const { values, readOnly } = await this.readStored(worktreeId, collectionId)
      if (readOnly) {
        throw new StoredFileReadOnlyError()
      }
      const key = this.sessionKey(worktreeId, collectionId)
      const session = this.sessionValues.get(key) ?? []
      change(values, session)
      this.sessionValues.set(key, session)
      const ledger = captureLedgerSchema.parse({ collectionId, values })
      await writeStoredFile(file, { schemaVersion: STORED_SCHEMA_VERSION, ledger })
    }
    // Why: read-modify-write on one file must not interleave.
    const next = (this.queues.get(file) ?? Promise.resolve()).then(run, run)
    this.queues.set(
      file,
      next.catch(() => undefined)
    )
    return next
  }
}
