import { readFile } from 'node:fs/promises'
import { z } from 'zod'
import { readJsonFile, writeJsonFile } from '../api-client/api-client-store-files'

export const STORED_SCHEMA_VERSION = 1

export type StoredRead<T> = { value: T | null; readOnly: boolean }

export class StoredFileReadOnlyError extends Error {
  constructor() {
    super('This data was saved by a newer version of Orca and cannot be changed here.')
  }
}

const versionProbeSchema = z.object({ schemaVersion: z.number() })

async function probeSchemaVersion(path: string): Promise<{ version: number; raw: unknown } | null> {
  try {
    const raw: unknown = JSON.parse(await readFile(path, 'utf8'))
    const probe = versionProbeSchema.safeParse(raw)
    return probe.success ? { version: probe.data.schemaVersion, raw } : null
  } catch {
    return null
  }
}

/** `loose` accepts any `schemaVersion` so a newer file can still be shown read-only. */
export async function readStoredFile<S extends z.ZodType, L extends z.ZodType>(
  path: string,
  strict: S,
  loose: L,
  corruptDir: string
): Promise<
  | { kind: 'missing' | 'corrupt' }
  | { kind: 'ok'; data: z.output<S> | z.output<L>; readOnly: boolean }
> {
  const probed = await probeSchemaVersion(path)
  if (probed && probed.version > STORED_SCHEMA_VERSION) {
    const parsed = loose.safeParse(probed.raw)
    return parsed.success ? { kind: 'ok', data: parsed.data, readOnly: true } : { kind: 'corrupt' }
  }
  const read = await readJsonFile(path, strict, corruptDir)
  return read.kind === 'ok'
    ? { kind: 'ok', data: read.value, readOnly: false }
    : { kind: read.kind }
}

export async function writeStoredFile(path: string, value: unknown): Promise<void> {
  const probed = await probeSchemaVersion(path)
  if (probed && probed.version > STORED_SCHEMA_VERSION) {
    throw new StoredFileReadOnlyError()
  }
  await writeJsonFile(path, value)
}
