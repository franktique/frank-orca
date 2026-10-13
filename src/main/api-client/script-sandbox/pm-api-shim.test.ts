import { describe, expect, it } from 'vitest'
import { runScript } from './script-sandbox-runner'
import type { ScriptInput } from './script-sandbox-types'

function input(script: string, overrides: Partial<ScriptInput> = {}): ScriptInput {
  return {
    script,
    phase: 'test',
    request: {
      method: 'POST',
      url: 'http://x/echo?a=1',
      headers: [['X-One', '1']],
      body: { mode: 'raw', raw: '{"a":1}' }
    },
    response: {
      code: 201,
      status: 'Created',
      headers: [
        ['Content-Type', 'application/json'],
        ['X-Trace', 'abc']
      ],
      body: '{"token":"t-123","items":[{"id":1},{"id":2}],"ok":true}',
      bodyTooLarge: false,
      responseTimeMs: 12,
      sizeBytes: 55
    },
    variables: {
      local: [],
      environment: [
        { key: 'baseUrl', value: 'http://x' },
        { key: 'off', value: 'nope', enabled: false }
      ],
      collection: [{ key: 'apiVersion', value: 'v1' }],
      folders: [{ key: 'folderVar', value: 'f' }]
    },
    info: {
      requestName: 'Get it',
      requestId: 'r-1',
      iteration: 1,
      iterationCount: 1,
      eventName: 'test'
    },
    ...overrides
  }
}

const run = (script: string, overrides?: Partial<ScriptInput>) =>
  runScript(input(script, overrides))

describe('script sandbox — tests and assertions', () => {
  it('records passing, failing and throwing tests', async () => {
    const out = await run(`
      pm.test('passes', function () { pm.expect(1).to.equal(1) });
      pm.test('fails', function () { pm.expect(1).to.equal(2) });
      pm.test('throws', function () { throw new Error('boom') });
    `)
    expect(out.error).toBeNull()
    expect(out.tests).toEqual([
      { name: 'passes', passed: true },
      { name: 'fails', passed: false, error: 'expected 1 to equal 2' },
      { name: 'throws', passed: false, error: 'boom' }
    ])
  })

  it('supports chai assertions through pm.expect', async () => {
    const out = await run(`
      pm.test('chai', function () {
        pm.expect({ a: [1, 2, { b: 3 }] }).to.eql({ a: [1, 2, { b: 3 }] });
        pm.expect([1, 2, 3]).to.include(2);
        pm.expect('x').to.be.a('string');
        pm.expect({ a: 1 }).to.have.property('a').that.equals(1);
        pm.expect(5).to.be.above(3).and.below(10);
        pm.expect(null).to.be.null;
      });
    `)
    expect(out.tests).toEqual([{ name: 'chai', passed: true }])
  })

  it('records a promise-returning test that rejects', async () => {
    const out = await run(`
      pm.test('async', function () { return Promise.reject(new Error('later')) });
    `)
    expect(out.tests).toEqual([{ name: 'async', passed: false, error: 'later' }])
  })
})

describe('script sandbox — response API', () => {
  it('exposes code, status, headers, json() and text()', async () => {
    const out = await run(`
      var json = pm.response.json();
      pm.test('response', function () {
        pm.expect(pm.response.code).to.equal(201);
        pm.expect(pm.response.status).to.equal('Created');
        pm.expect(pm.response.headers.get('content-type')).to.equal('application/json');
        pm.expect(pm.response.headers.get('X-TRACE')).to.equal('abc');
        pm.expect(pm.response.headers.has('nope')).to.equal(false);
        pm.expect(json.items.length).to.equal(2);
        pm.expect(pm.response.text()).to.contain('t-123');
        pm.expect(pm.response.responseTime).to.equal(12);
        pm.expect(pm.response.responseSize).to.equal(55);
      });
    `)
    expect(out.tests).toEqual([{ name: 'response', passed: true }])
  })

  it('supports the chai-postman style response assertions', async () => {
    const out = await run(`
      pm.test('status', function () { pm.response.to.have.status(201); pm.response.to.have.status('Created'); });
      pm.test('ok', function () { pm.response.to.be.ok; pm.response.to.be.success; });
      pm.test('header', function () { pm.response.to.have.header('X-Trace'); pm.response.to.have.header('X-Trace', 'abc'); });
      pm.test('jsonBody', function () { pm.response.to.have.jsonBody('token', 't-123'); pm.response.to.have.jsonBody('items[1].id', 2); });
      pm.test('wrong status', function () { pm.response.to.have.status(500); });
      pm.test('not an error', function () { pm.response.to.be.error; });
    `)
    expect(out.tests.map((t) => [t.name, t.passed])).toEqual([
      ['status', true],
      ['ok', true],
      ['header', true],
      ['jsonBody', true],
      ['wrong status', false],
      ['not an error', false]
    ])
    expect(out.tests[4].error).toContain('201')
  })

  it('explains invalid JSON readably', async () => {
    const out = await run(`pm.test('json', function () { pm.response.json() })`, {
      response: { ...input('').response!, body: '<html>' }
    })
    expect(out.tests[0].error).toContain('not valid JSON')
  })

  it('has no response in the pre-request phase', async () => {
    const out = await run(
      `pm.test('none', function () { pm.expect(pm.response).to.equal(undefined) })`,
      {
        phase: 'prerequest',
        response: null
      }
    )
    expect(out.tests).toEqual([{ name: 'none', passed: true }])
  })
})

describe('script sandbox — variables', () => {
  it('reads and writes environment, collection and local variables', async () => {
    const out = await run(`
      pm.test('reads', function () {
        pm.expect(pm.environment.get('baseUrl')).to.equal('http://x');
        pm.expect(pm.environment.get('off')).to.equal(undefined);
        pm.expect(pm.collectionVariables.get('apiVersion')).to.equal('v1');
        pm.expect(pm.variables.get('folderVar')).to.equal('f');
        pm.expect(pm.variables.get('baseUrl')).to.equal('http://x');
        pm.expect(pm.variables.has('missing')).to.equal(false);
      });
      pm.environment.set('token', pm.response.json().token);
      pm.environment.unset('baseUrl');
      pm.collectionVariables.set('count', 5);
      pm.variables.set('scratch', 'local');
      pm.test('after write', function () {
        pm.expect(pm.environment.get('token')).to.equal('t-123');
        pm.expect(pm.environment.has('baseUrl')).to.equal(false);
        pm.expect(pm.variables.get('scratch')).to.equal('local');
        pm.expect(pm.variables.replaceIn('{{token}}-{{missing}}')).to.equal('t-123-{{missing}}');
      });
    `)
    expect(out.tests.every((t) => t.passed)).toBe(true)
    expect(out.writes.environment).toEqual({ set: { token: 't-123' }, unset: ['baseUrl'] })
    expect(out.writes.collection).toEqual({ set: { count: '5' }, unset: [] })
    expect(out.writes.local).toEqual({ set: { scratch: 'local' }, unset: [] })
  })

  it('exposes pm.info', async () => {
    const out = await run(`
      pm.test('info', function () {
        pm.expect(pm.info.requestName).to.equal('Get it');
        pm.expect(pm.info.requestId).to.equal('r-1');
        pm.expect(pm.info.iteration).to.equal(1);
        pm.expect(pm.info.eventName).to.equal('test');
      });
    `)
    expect(out.tests).toEqual([{ name: 'info', passed: true }])
  })
})

describe('script sandbox — request mutation', () => {
  it('reports pre-request changes to the outgoing request', async () => {
    const out = await run(
      `
      pm.request.headers.upsert({ key: 'X-One', value: '2' });
      pm.request.headers.add({ key: 'X-Two', value: 'b' });
      pm.request.headers.remove('X-Nope');
      pm.request.url.addQueryParams('b=2');
      pm.request.method = 'put';
      pm.request.body.raw = '{"changed":true}';
    `,
      { phase: 'prerequest', response: null }
    )
    expect(out.request).toEqual({
      method: 'PUT',
      url: 'http://x/echo?a=1&b=2',
      headers: [
        ['X-One', '2'],
        ['X-Two', 'b']
      ],
      body: { mode: 'raw', raw: '{"changed":true}' }
    })
  })

  it('reports no mutation when the script only reads', async () => {
    const out = await run(
      `pm.test('read', function () { pm.expect(pm.request.method).to.equal('POST') })`
    )
    expect(out.request).toBeNull()
  })
})

describe('script sandbox — console and legacy API', () => {
  it('captures console output', async () => {
    const out = await run(`
      console.log('a', 1, { b: 2 });
      console.info('info');
      console.warn('warn');
      console.error('error');
    `)
    expect(out.logs).toEqual([
      { level: 'log', text: 'a 1 {"b":2}' },
      { level: 'info', text: 'info' },
      { level: 'warn', text: 'warn' },
      { level: 'error', text: 'error' }
    ])
  })

  it('supports tests[...] and responseBody / postman.* from older collections', async () => {
    const out = await run(`
      tests['status is 201'] = responseCode.code === 201;
      tests['bad'] = false;
      var data = JSON.parse(responseBody);
      postman.setEnvironmentVariable('token', data.token);
      tests['reads back'] = postman.getEnvironmentVariable('token') === 't-123';
    `)
    expect(out.tests.map((t) => [t.name, t.passed])).toEqual([
      ['status is 201', true],
      ['bad', false],
      ['reads back', true]
    ])
    expect(out.writes.environment.set).toEqual({ token: 't-123' })
  })

  it('offers btoa, atob and crypto.randomUUID', async () => {
    const out = await run(`
      pm.test('helpers', function () {
        pm.expect(btoa('alice:pw')).to.equal('YWxpY2U6cHc=');
        pm.expect(atob('YWxpY2U6cHc=')).to.equal('alice:pw');
        pm.expect(crypto.randomUUID()).to.match(/^[0-9a-f-]{36}$/);
      });
    `)
    expect(out.tests).toEqual([{ name: 'helpers', passed: true }])
  })
})

describe('script sandbox — unsupported APIs and isolation', () => {
  it('names the unsupported API in a NotSupportedError', async () => {
    const out = await run(`
      pm.test('send', function () { pm.sendRequest('http://x') });
      pm.test('cookies', function () { pm.cookies.get('a') });
      pm.test('visualizer', function () { pm.visualizer.set('<p/>') });
      pm.test('next', function () { postman.setNextRequest('x') });
    `)
    expect(out.tests.map((t) => t.error)).toEqual([
      'pm.sendRequest is not supported in Orca',
      'pm.cookies is not supported in Orca',
      'pm.visualizer is not supported in Orca',
      'postman.setNextRequest is not supported in Orca'
    ])
  })

  it('only allows require("chai")', async () => {
    const out = await run(`
      pm.test('chai', function () { require('chai').expect(1).to.equal(1) });
      pm.test('fs', function () { require('fs') });
    `)
    expect(out.tests[0].passed).toBe(true)
    expect(out.tests[1].error).toContain("require('fs') is not supported")
  })

  it('has no host objects', async () => {
    const out = await run(`
      pm.test('isolated', function () {
        pm.expect(typeof process).to.equal('undefined');
        pm.expect(typeof Buffer).to.equal('undefined');
        pm.expect(typeof fetch).to.equal('undefined');
        pm.expect(typeof window).to.equal('undefined');
        pm.expect(typeof XMLHttpRequest).to.equal('undefined');
      });
    `)
    expect(out.tests).toEqual([{ name: 'isolated', passed: true }])
  })

  it('stops a script that never returns and keeps what it produced', async () => {
    const started = Date.now()
    const out = await runScript(
      input(`console.log('before'); pm.test('first', function () {}); while (true) {}`, {
        timeoutMs: 300
      })
    )
    expect(Date.now() - started).toBeLessThan(5000)
    expect(out.error?.name).toBe('TimeoutError')
    expect(out.logs).toEqual([{ level: 'log', text: 'before' }])
    expect(out.tests).toEqual([{ name: 'first', passed: true }])
  })

  it('enforces the memory limit', async () => {
    const startedAt = Date.now()
    const out = await runScript(
      input(`var big = []; while (true) { big.push(new Array(1000000)) }`, {
        memoryLimitBytes: 16 * 1024 * 1024,
        timeoutMs: 5000
      })
    )
    expect(out.error?.name).toBe('MemoryError')
    expect(Date.now() - startedAt).toBeLessThan(1000)
  })

  it('reports an uncaught error with the tests recorded before it', async () => {
    const out = await run(`pm.test('ok', function () {}); throw new Error('script failed')`)
    expect(out.error).toEqual({ name: 'Error', message: 'script failed' })
    expect(out.tests).toEqual([{ name: 'ok', passed: true }])
  })

  it('gives every script a fresh context', async () => {
    await run(`globalThis.leaked = 'yes'`)
    const out = await run(
      `pm.test('clean', function () { pm.expect(typeof leaked).to.equal('undefined') })`
    )
    expect(out.tests).toEqual([{ name: 'clean', passed: true }])
  })
})
