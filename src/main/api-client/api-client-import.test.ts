import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { SecretStore } from '../../shared/secret-store'
import { importPostmanContent, readPostmanFile } from './api-client-import'
import { ApiClientStore } from './api-client-store'
import { getApiClientWorktreePaths } from './api-client-storage-paths'

const FIXTURES = join(__dirname, '../../shared/api-client/__fixtures__')

function fakeSecretStore(): SecretStore {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (plain) => Buffer.from(Buffer.from(plain).toReversed()),
    decryptString: (cipher) => Buffer.from(cipher.toReversed()).toString(),
    describeProtectionGap: () => null
  }
}

async function readFixture(name: string): Promise<unknown> {
  const loaded = await readPostmanFile(join(FIXTURES, name))
  if (!loaded.ok) {
    throw new Error(loaded.message)
  }
  return loaded.json
}

let root: string
let counter = 0
const store = (): ApiClientStore =>
  new ApiClientStore({ root, secretStore: fakeSecretStore, newId: () => `id-${++counter}` })

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'api-client-import-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('importPostmanContent', () => {
  it('writes nothing when the file is invalid (acceptance 1.4)', async () => {
    const result = await importPostmanContent(
      store(),
      'wt',
      await readFixture('invalid.postman_collection.json')
    )
    expect(result).toMatchObject({
      ok: false,
      code: 'invalid-import',
      message: 'item[3].request.url: expected string or object'
    })
    expect(await readdir(root)).toEqual([])
  })

  it('rejects a file that is not JSON before touching the store', async () => {
    const path = join(root, 'broken.json')
    await writeFile(path, '{nope')
    expect(await readPostmanFile(path)).toMatchObject({ ok: false, code: 'invalid-import' })
    expect(await readPostmanFile(join(root, 'missing.json'))).toMatchObject({ ok: false })
  })

  it('reports a duplicate collection name and offers the existing id', async () => {
    const s = store()
    const json = await readFixture('smoke.postman_collection.json')
    const first = await importPostmanContent(s, 'wt', json)
    expect(first).toMatchObject({ ok: true, kind: 'collection' })
    const second = await importPostmanContent(s, 'wt', json)
    expect(second).toMatchObject({
      ok: false,
      code: 'duplicate-name',
      existingId: first.ok ? first.id : undefined
    })
    expect((await s.getSnapshot('wt')).collections).toHaveLength(1)
  })

  it('replace keeps the existing id and swaps the content', async () => {
    const s = store()
    const json = await readFixture('smoke.postman_collection.json')
    const first = await importPostmanContent(s, 'wt', json)
    const replaced = await importPostmanContent(s, 'wt', json, 'replace')
    expect(replaced).toMatchObject({ ok: true, id: first.ok ? first.id : undefined })
    const snapshot = await s.getSnapshot('wt')
    expect(snapshot.collections).toHaveLength(1)
    expect(snapshot.collections[0].revision).toBeGreaterThan(0)
  })

  it('keep-both adds a numbered suffix and keeps both collections', async () => {
    const s = store()
    const json = await readFixture('smoke.postman_collection.json')
    await importPostmanContent(s, 'wt', json)
    await importPostmanContent(s, 'wt', json, 'keep-both')
    await importPostmanContent(s, 'wt', json, 'keep-both')
    const names = (await s.getSnapshot('wt')).collections.map((c) => c.name)
    expect(names).toEqual(['Smoke', 'Smoke (2)', 'Smoke (3)'])
    const ids = new Set((await s.getSnapshot('wt')).collections.map((c) => c.id))
    expect(ids.size).toBe(3)
  })

  it('stores environment secrets encrypted on disk', async () => {
    const s = store()
    const result = await importPostmanContent(
      s,
      'wt',
      await readFixture('smoke.postman_environment.json')
    )
    expect(result).toMatchObject({ ok: true, kind: 'environment' })
    const paths = getApiClientWorktreePaths('wt', root)
    const raw = await readFile(paths.environmentFile(result.ok ? result.id : ''), 'utf8')
    expect(raw).not.toContain('secret-token-value')
    expect(raw).not.toContain('hunter2-hunter2')
    expect(raw).toContain('http://localhost:3000')

    const revealed = await store().getSnapshot('wt', { revealSecrets: true })
    const token = revealed.environments[0].variables.find((v) => v.key === 'token')
    expect(token?.value).toBe('secret-token-value')
  })

  it('refuses a file that is neither a collection nor an environment', async () => {
    expect(await importPostmanContent(store(), 'wt', { hello: 1 })).toMatchObject({
      ok: false,
      code: 'invalid-import'
    })
  })
})
