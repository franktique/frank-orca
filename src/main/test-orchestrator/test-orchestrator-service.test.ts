import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ApiNodeId, ApiRequest, Collection } from '../../shared/api-client/api-client-types'
import type { SecretStore } from '../../shared/secret-store'
import { getApiClientWorktreePaths } from '../api-client/api-client-storage-paths'
import { TestMapStore } from './test-map-store'
import { TestOrchestratorService } from './test-orchestrator-service'

const WT = 'wt'
const COL = 'col-1'

const secretStore: SecretStore = {
  isEncryptionAvailable: () => true,
  encryptString: (plain) => Buffer.from(plain),
  decryptString: (cipher) => cipher.toString(),
  describeProtectionGap: () => null
}

function request(id: string, name: string): ApiRequest {
  return {
    id,
    kind: 'request',
    name,
    method: 'GET',
    url: { raw: '', query: [] },
    pathVariables: [],
    headers: [],
    events: {},
    settings: {},
    revision: 1,
    postmanExtra: {}
  }
}

function makeCollection(items: ApiRequest[]): Collection {
  return {
    id: COL,
    name: 'C',
    variables: [],
    events: {},
    items,
    revision: 1,
    postmanExtra: {},
    importWarnings: []
  }
}

let root: string
let collection: Collection
let service: TestOrchestratorService
let store: TestMapStore
const emitted = vi.fn()

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'test-orchestrator-service-'))
  store = new TestMapStore({ root, secretStore: () => secretStore })
  collection = makeCollection([request('r1', 'Login'), request('r2', 'Logout')])
  emitted.mockClear()
  service = new TestOrchestratorService({
    store,
    apiClient: {
      store: {
        getState: async () => ({ collections: new Map<ApiNodeId, Collection>([[COL, collection]]) })
      }
    },
    browserBridge: { tabList: () => ({ tabs: [] }) },
    emitTestMapChanged: emitted
  })
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

async function writeMapFile(name: string, body: unknown): Promise<string> {
  const filePath = join(root, name)
  await writeFile(filePath, typeof body === 'string' ? body : JSON.stringify(body))
  return filePath
}

const validFile = {
  orcaTestMap: 1,
  entries: [{ request: { path: ['Login'] }, before: [{ sql: 'select 1' }] }]
}
const mapFilePath = () => getApiClientWorktreePaths(WT, root).testMapFile(COL)

describe('loadTestMap', () => {
  it('loads, links and stores the map, then notifies', async () => {
    const filePath = await writeMapFile('map.json', validFile)
    const result = await service.loadTestMap({ worktreeId: WT, collectionId: COL, filePath })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.map.entries[0]?.link).toEqual({ state: 'linked', requestId: 'r1' })
    }
    expect((await store.getMap(WT, COL)).value?.sourceFileName).toBe('map.json')
    expect(emitted).toHaveBeenCalledWith(WT, COL)
  })

  it('returns conflict when a map exists, and replaces it with replace', async () => {
    const filePath = await writeMapFile('map.json', validFile)
    await service.loadTestMap({ worktreeId: WT, collectionId: COL, filePath })
    const conflict = await service.loadTestMap({ worktreeId: WT, collectionId: COL, filePath })
    expect(conflict).toMatchObject({ ok: false, code: 'conflict' })
    const replaced = await service.loadTestMap({
      worktreeId: WT,
      collectionId: COL,
      filePath,
      replace: true
    })
    expect(replaced.ok).toBe(true)
  })

  it('writes nothing for an invalid file, even with replace', async () => {
    const good = await writeMapFile('good.json', validFile)
    await service.loadTestMap({ worktreeId: WT, collectionId: COL, filePath: good })
    const before = await readFile(mapFilePath(), 'utf8')
    emitted.mockClear()
    for (const bad of [
      await writeMapFile('bad.json', { orcaTestMap: 2, entries: [] }),
      await writeMapFile('notjson.json', '{nope')
    ]) {
      const result = await service.loadTestMap({
        worktreeId: WT,
        collectionId: COL,
        filePath: bad,
        replace: true
      })
      expect(result).toMatchObject({ ok: false, code: 'invalid-test-map' })
    }
    expect(await readFile(mapFilePath(), 'utf8')).toBe(before)
    expect(emitted).not.toHaveBeenCalled()
  })

  it('writes no file when the first load is invalid', async () => {
    const bad = await writeMapFile('bad.json', { orcaTestMap: 1, entries: [{}] })
    const result = await service.loadTestMap({ worktreeId: WT, collectionId: COL, filePath: bad })
    expect(result).toMatchObject({ ok: false, code: 'invalid-test-map' })
    expect((await store.getMap(WT, COL)).value).toBeNull()
  })
})

describe('getTestMap', () => {
  it('marks entries broken when the request was deleted', async () => {
    const filePath = await writeMapFile('map.json', validFile)
    await service.loadTestMap({ worktreeId: WT, collectionId: COL, filePath })
    collection = makeCollection([request('r2', 'Logout')])
    const map = await service.getTestMap({ worktreeId: WT, collectionId: COL })
    expect(map?.entries[0]?.link).toEqual({ state: 'broken', lastRequestId: 'r1' })
  })

  it('returns null when no map is stored', async () => {
    expect(await service.getTestMap({ worktreeId: WT, collectionId: COL })).toBeNull()
  })
})

describe('saveQueries', () => {
  const query = { id: 'q1', sql: 'select 1', precondition: false, changesData: false }

  it('creates an entry for a request without one', async () => {
    const result = await service.saveQueries({
      worktreeId: WT,
      collectionId: COL,
      requestId: 'r2',
      before: [query],
      after: [],
      baseLoadedAt: 0
    })
    expect(result.ok).toBe(true)
    const stored = (await store.getMap(WT, COL)).value
    expect(stored?.entries).toHaveLength(1)
    expect(stored?.entries[0]?.link).toEqual({ state: 'linked', requestId: 'r2' })
  })

  it('returns conflict when baseLoadedAt is stale and leaves the map unchanged', async () => {
    const filePath = await writeMapFile('map.json', validFile)
    const loaded = await service.loadTestMap({ worktreeId: WT, collectionId: COL, filePath })
    if (!loaded.ok) {
      throw new Error('load failed')
    }
    const before = await readFile(mapFilePath(), 'utf8')
    const result = await service.saveQueries({
      worktreeId: WT,
      collectionId: COL,
      requestId: 'r1',
      before: [query],
      after: [],
      baseLoadedAt: loaded.map.loadedAt - 1
    })
    expect(result).toMatchObject({ ok: false, code: 'conflict' })
    expect(await readFile(mapFilePath(), 'utf8')).toBe(before)
  })

  it('updates the existing entry when baseLoadedAt matches', async () => {
    const filePath = await writeMapFile('map.json', validFile)
    const loaded = await service.loadTestMap({ worktreeId: WT, collectionId: COL, filePath })
    if (!loaded.ok) {
      throw new Error('load failed')
    }
    await service.saveQueries({
      worktreeId: WT,
      collectionId: COL,
      requestId: 'r1',
      before: [],
      after: [query],
      baseLoadedAt: loaded.map.loadedAt
    })
    const stored = (await store.getMap(WT, COL)).value
    expect(stored?.entries).toHaveLength(1)
    expect(stored?.entries[0]?.after).toEqual([query])
  })
})

describe('export, remove and rematch', () => {
  it('exports a file that loads back, then removes the map', async () => {
    const filePath = await writeMapFile('map.json', validFile)
    await service.loadTestMap({ worktreeId: WT, collectionId: COL, filePath })
    const out = join(root, 'out.json')
    expect(
      await service.exportTestMap({ worktreeId: WT, collectionId: COL, filePath: out })
    ).toEqual({ ok: true })
    expect(JSON.parse(await readFile(out, 'utf8')).orcaTestMap).toBe(1)
    await service.removeTestMap({ worktreeId: WT, collectionId: COL })
    expect((await store.getMap(WT, COL)).value).toBeNull()
  })

  it('re-links by path after the collection gets new request ids', async () => {
    const filePath = await writeMapFile('map.json', validFile)
    await service.loadTestMap({ worktreeId: WT, collectionId: COL, filePath })
    emitted.mockClear()
    collection = makeCollection([request('n1', 'Login')])
    const warnings = await service.rematchAfterImport(WT, collection)
    expect(warnings).toEqual([])
    expect((await store.getMap(WT, COL)).value?.entries[0]?.link).toEqual({
      state: 'linked',
      requestId: 'n1'
    })
    expect(emitted).toHaveBeenCalledWith(WT, COL)
  })

  it('reports requests that no longer exist after a re-import', async () => {
    const filePath = await writeMapFile('map.json', validFile)
    await service.loadTestMap({ worktreeId: WT, collectionId: COL, filePath })
    collection = makeCollection([request('n2', 'Other')])
    const warnings = await service.rematchAfterImport(WT, collection)
    expect(warnings).toHaveLength(1)
  })
})
