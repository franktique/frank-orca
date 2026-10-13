import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { SecretStore } from '../../shared/secret-store'
import { exportPostmanFile } from './api-client-export'
import { importPostmanContent, readPostmanFile } from './api-client-import'
import { ApiClientStore } from './api-client-store'

const FIXTURES = join(__dirname, '../../shared/api-client/__fixtures__')

function fakeSecretStore(): SecretStore {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (plain) => Buffer.from(Buffer.from(plain).toReversed()),
    decryptString: (cipher) => Buffer.from(cipher.toReversed()).toString(),
    describeProtectionGap: () => null
  }
}

let root: string
let store: ApiClientStore

async function importFixture(name: string): Promise<string> {
  const loaded = await readPostmanFile(join(FIXTURES, name))
  if (!loaded.ok) {
    throw new Error(loaded.message)
  }
  const result = await importPostmanContent(store, 'wt', loaded.json)
  if (!result.ok) {
    throw new Error(result.message)
  }
  return result.id
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'api-client-export-'))
  store = new ApiClientStore({ root: join(root, 'data'), secretStore: fakeSecretStore })
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('exportPostmanFile', () => {
  it('writes an environment with its secrets decrypted', async () => {
    const id = await importFixture('smoke.postman_environment.json')
    const filePath = join(root, 'env.json')
    expect(
      await exportPostmanFile(store, { worktreeId: 'wt', kind: 'environment', id, filePath })
    ).toEqual({
      ok: true
    })
    const written = JSON.parse(await readFile(filePath, 'utf8'))
    expect(written.values).toContainEqual(
      expect.objectContaining({ key: 'token', value: 'secret-token-value', type: 'secret' })
    )
  })

  it('writes a collection as Postman v2.1', async () => {
    const id = await importFixture('smoke.postman_collection.json')
    const filePath = join(root, 'collection.json')
    await exportPostmanFile(store, { worktreeId: 'wt', kind: 'collection', id, filePath })
    const written = JSON.parse(await readFile(filePath, 'utf8'))
    expect(written.info.schema).toContain('v2.1.0')
    expect(written.item.length).toBeGreaterThan(0)
  })

  it('reports a missing item and writes nothing', async () => {
    const filePath = join(root, 'none.json')
    expect(
      await exportPostmanFile(store, { worktreeId: 'wt', kind: 'collection', id: 'nope', filePath })
    ).toMatchObject({ ok: false, code: 'not-found' })
    await expect(readFile(filePath)).rejects.toThrow()
  })
})
