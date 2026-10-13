import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Worker } from 'node:worker_threads'
import { build } from 'esbuild'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ScriptSandboxClient } from './script-sandbox-client'
import type { ScriptInput } from './script-sandbox-types'

let dir: string
let entryPath: string

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'script-sandbox-worker-'))
  entryPath = join(dir, 'script-sandbox-worker-entry.js')
  // Same shape as the production build: one bundled worker entry with the wasm embedded.
  await build({
    entryPoints: [join(__dirname, 'script-sandbox-worker-entry.ts')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: entryPath,
    logLevel: 'silent'
  })
}, 60_000)

afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
})

function input(script: string, overrides: Partial<ScriptInput> = {}): ScriptInput {
  return {
    script,
    phase: 'test',
    request: { method: 'GET', url: 'http://x', headers: [], body: null },
    response: null,
    variables: { local: [], environment: [], collection: [], folders: [] },
    info: { requestName: 'r', requestId: 'id', iteration: 1, iterationCount: 1, eventName: 'test' },
    ...overrides
  }
}

describe('ScriptSandboxClient', () => {
  it('runs scripts on a real worker thread and returns their output', async () => {
    const client = new ScriptSandboxClient({ workerFactory: () => new Worker(entryPath) })
    const output = await client.run(
      input(`pm.test('works', function () { pm.expect(1).to.equal(1) }); console.log('hi')`)
    )
    expect(output.tests).toEqual([{ name: 'works', passed: true }])
    expect(output.logs).toEqual([{ level: 'log', text: 'hi' }])
    const second = await client.run(input(`pm.environment.set('a', 'b')`))
    expect(second.writes.environment.set).toEqual({ a: 'b' })
  })

  it('stops a runaway script without losing the worker', async () => {
    const client = new ScriptSandboxClient({ workerFactory: () => new Worker(entryPath) })
    const stuck = await client.run(input('while (true) {}', { timeoutMs: 200 }))
    expect(stuck.error?.name).toBe('TimeoutError')
    const after = await client.run(input(`pm.test('still alive', function () {})`))
    expect(after.tests).toEqual([{ name: 'still alive', passed: true }])
  })

  it('reports an unavailable worker as a script error instead of rejecting', async () => {
    const client = new ScriptSandboxClient({
      workerFactory: () => {
        throw new Error('no worker')
      },
      log: () => undefined
    })
    const output = await client.run(input('1'))
    expect(output.error?.name).toBe('SandboxError')
  })
})
