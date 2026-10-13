import { mkdir, readdir, readFile, rename, rm } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import type { z } from 'zod'
import { durableWriteTempPath, writeFileDurable } from '../durable-file-write'

export type JsonReadResult<T> =
  | { kind: 'ok'; value: T }
  | { kind: 'missing' }
  | { kind: 'corrupt'; quarantinedAs: string | null }

/** Moves an unreadable file aside so the rest of the data still loads (storage-format.md). */
async function quarantineFile(path: string, corruptDir: string): Promise<string | null> {
  try {
    await mkdir(corruptDir, { recursive: true })
    const target = join(corruptDir, `${basename(path, '.json')}.${Date.now()}.json`)
    await rename(path, target)
    return target
  } catch {
    return null
  }
}

export async function readJsonFile<S extends z.ZodType>(
  path: string,
  schema: S,
  corruptDir: string
): Promise<JsonReadResult<z.output<S>>> {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    if (isMissingFileError(error)) {
      return { kind: 'missing' }
    }
    return { kind: 'corrupt', quarantinedAs: null }
  }
  try {
    const parsed = schema.safeParse(JSON.parse(text))
    if (parsed.success) {
      return { kind: 'ok', value: parsed.data }
    }
  } catch {
    // Fall through to quarantine.
  }
  return { kind: 'corrupt', quarantinedAs: await quarantineFile(path, corruptDir) }
}

export async function writeJsonFile(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFileDurable(durableWriteTempPath(path), path, JSON.stringify(value))
}

export async function listJsonFileNames(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir)).filter((name) => name.endsWith('.json')).sort()
  } catch {
    return []
  }
}

export async function removeFileIfPresent(path: string): Promise<void> {
  await rm(path, { force: true })
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}
