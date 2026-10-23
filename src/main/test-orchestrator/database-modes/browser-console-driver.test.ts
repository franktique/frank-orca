import { describe, expect, it, vi } from 'vitest'
import { createBrowserConsoleDriver, type BrowserConsoleBridge } from './browser-console-driver'

type Probe = { hash: string; signIn: boolean; errorText: string | null; partial: boolean }

const IDLE: Probe = { hash: 'a', signIn: false, errorText: null, partial: false }
const DONE: Probe = { ...IDLE, hash: 'b' }

const REFS = [
  { ref: '@e1', role: 'textbox', name: 'Query editor' },
  { ref: '@e2', role: 'button', name: 'Run' }
]

type FakeOptions = {
  probes?: Probe[]
  refs?: typeof REFS
  tabOpen?: boolean
  redaction?: { covered: number; residual: number; uninspectable: number }
  clickFails?: boolean
  screenshotFails?: boolean
}

function createFakeBridge(options: FakeOptions = {}) {
  const probes = [...(options.probes ?? [IDLE, DONE, DONE])]
  const evaluated: string[] = []
  const calls: string[] = []
  const bridge: BrowserConsoleBridge = {
    snapshot: vi.fn(async () => ({
      browserPageId: 'page-1',
      snapshot: '',
      refs: options.refs ?? REFS,
      url: 'https://console.example',
      title: 'Console'
    })),
    click: vi.fn(async (element: string) => {
      calls.push(`click ${element}`)
      if (options.clickFails) {
        throw new Error('not clickable')
      }
      return { clicked: element }
    }),
    keypress: vi.fn(async (key: string) => {
      calls.push(`keypress ${key}`)
      return { pressed: key }
    }),
    keyboardInsertText: vi.fn(async (text: string) => {
      calls.push(`insert ${text}`)
      return { inserted: true }
    }),
    focus: vi.fn(async (element: string) => {
      calls.push(`focus ${element}`)
      return { focused: element }
    }),
    selectAll: vi.fn(async (element: string) => {
      calls.push(`selectAll ${element}`)
      return { selected: element }
    }),
    evaluate: vi.fn(async (expression: string) => {
      evaluated.push(expression)
      if (expression.includes('rawNeedles')) {
        return {
          result: JSON.stringify(
            options.redaction ?? { covered: 1, residual: 0, uninspectable: 0 }
          ),
          origin: ''
        }
      }
      if (expression.includes('removed: removed')) {
        return { result: JSON.stringify({ removed: 1 }), origin: '' }
      }
      if (expression.includes('MAX_ROWS')) {
        return {
          result: JSON.stringify({ found: true, rows: [['id'], ['tok-secret-123']] }),
          origin: ''
        }
      }
      const next = probes.length > 1 ? probes.shift() : probes[0]
      return { result: JSON.stringify(next), origin: '' }
    }),
    screenshot: vi.fn(async () => {
      calls.push('screenshot')
      if (options.screenshotFails) {
        throw new Error('capture failed')
      }
      return { data: 'AAAA', format: 'png' as const }
    }),
    tabList: vi.fn(() => ({
      tabs:
        options.tabOpen === false
          ? []
          : [{ browserPageId: 'page-1', index: 0, url: '', title: '', active: true }]
    }))
  }
  return { bridge, calls, evaluated }
}

function createDriver(
  bridge: BrowserConsoleBridge,
  extra: Partial<Parameters<typeof createBrowserConsoleDriver>[0]> = {}
) {
  let clock = 0
  return createBrowserConsoleDriver({
    bridge,
    browserPageId: 'page-1',
    pollIntervalMs: 100,
    sleep: async (ms) => {
      clock += ms
    },
    now: () => clock,
    ...extra
  })
}

describe('browser console driver', () => {
  it('locates the editor and the run control from the snapshot', async () => {
    const { bridge } = createFakeBridge()

    expect(await createDriver(bridge).locate()).toEqual({ ok: true, editor: '@e1', run: '@e2' })
  })

  it('reads the keyed refs map agent-browser actually returns', async () => {
    const { bridge } = createFakeBridge()
    vi.mocked(bridge.snapshot).mockResolvedValueOnce({
      browserPageId: 'page-1',
      snapshot: '',
      // Why: the real CLI returns a keyed map although the bridge types a list; JSON.parse yields `any`.
      refs: JSON.parse(
        '{"e1":{"role":"textbox","name":"Query editor"},"e2":{"role":"button","name":"Run"}}'
      ),
      url: 'https://console.example',
      title: 'Console'
    })

    expect(await createDriver(bridge).locate()).toEqual({ ok: true, editor: '@e1', run: '@e2' })
  })

  it('lets test-map selector hints win over the snapshot', async () => {
    const { bridge, calls } = createFakeBridge()
    const driver = createDriver(bridge, {
      hints: { editorSelector: '#sql', runSelector: '#go' }
    })

    await driver.runQuery('select 1')

    expect(bridge.snapshot).not.toHaveBeenCalled()
    expect(calls).toEqual(['focus #sql', 'selectAll #sql', 'insert select 1', 'click #go'])
  })

  it('reports which control could not be located', async () => {
    const noEditor = createFakeBridge({ refs: [REFS[1]] })
    const noRun = createFakeBridge({ refs: [REFS[0]] })

    expect(await createDriver(noEditor.bridge).locate()).toMatchObject({
      ok: false,
      reason: 'editor-not-found'
    })
    expect(await createDriver(noRun.bridge).locate()).toMatchObject({
      ok: false,
      reason: 'run-not-found'
    })
    expect(await createDriver(noRun.bridge).runQuery('select 1')).toMatchObject({
      kind: 'locate-failed'
    })
  })

  it('runs a query and waits for the result region to change', async () => {
    const { bridge } = createFakeBridge({ probes: [IDLE, IDLE, DONE, DONE] })

    expect(await createDriver(bridge).runQuery('select 1')).toEqual({
      kind: 'completed',
      partial: false
    })
  })

  it('flags partial results when pagination is visible', async () => {
    const paged = { ...DONE, partial: true }
    const { bridge } = createFakeBridge({ probes: [IDLE, paged, paged] })

    expect(await createDriver(bridge).runQuery('select 1')).toEqual({
      kind: 'completed',
      partial: true
    })
  })

  it('raises a recovery outcome for a sign-in screen', async () => {
    const { bridge } = createFakeBridge({ probes: [IDLE, { ...IDLE, signIn: true }] })

    expect(await createDriver(bridge).runQuery('select 1')).toEqual({ kind: 'sign-in' })
  })

  it('raises a recovery outcome for a new error banner only', async () => {
    const stale = { ...IDLE, errorText: 'old error' }
    const stillStale = createFakeBridge({
      probes: [stale, stale, { ...stale, hash: 'b' }, { ...stale, hash: 'b' }]
    })
    const fresh = createFakeBridge({ probes: [stale, { ...stale, errorText: 'syntax error' }] })

    expect(await createDriver(stillStale.bridge).runQuery('select 1')).toMatchObject({
      kind: 'completed'
    })
    expect(await createDriver(fresh.bridge).runQuery('select 1')).toEqual({
      kind: 'error',
      message: 'syntax error'
    })
  })

  it('times out at the configured query timeout', async () => {
    const { bridge } = createFakeBridge({ probes: [IDLE] })

    expect(await createDriver(bridge, { queryTimeoutMs: 1000 }).runQuery('select 1')).toEqual({
      kind: 'timeout',
      timeoutMs: 1000
    })
  })

  it('defaults the timeout to 30 seconds', async () => {
    const { bridge } = createFakeBridge({ probes: [IDLE] })

    expect(await createDriver(bridge).runQuery('select 1')).toEqual({
      kind: 'timeout',
      timeoutMs: 30_000
    })
  })

  it('reports a closed tab', async () => {
    const { bridge } = createFakeBridge({ tabOpen: false })

    expect(await createDriver(bridge).runQuery('select 1')).toEqual({ kind: 'tab-closed' })
  })

  it.each([
    ['darwin', 'Meta+Enter'],
    ['linux', 'Control+Enter'],
    ['win32', 'Control+Enter']
  ] as const)(
    'falls back to the %s submit shortcut when the click fails',
    async (platform, key) => {
      const { bridge, calls } = createFakeBridge({ clickFails: true })

      await createDriver(bridge, { platform }).runQuery('select 1')

      expect(calls).toContain(`keypress ${key}`)
    }
  )

  it('reads the first table as masked text', async () => {
    const { bridge } = createFakeBridge()

    const result = await createDriver(bridge).readResult((text) =>
      text.replace('tok-secret-123', '[masked]')
    )

    expect(result).toEqual({ ok: true, found: true, text: 'id\n[masked]' })
  })

  it('captures a screenshot after blurring and then restores', async () => {
    const { bridge, evaluated } = createFakeBridge()

    const outcome = await createDriver(bridge).captureScreenshot(['tok-secret-123'])

    expect(outcome).toEqual({
      kind: 'captured',
      data: 'AAAA',
      format: 'png',
      blurredCount: 1,
      overlaysRestored: true
    })
    expect(evaluated.at(-1)).toContain('removed: removed')
  })

  it.each([
    ['residual', { covered: 1, residual: 1, uninspectable: 0 }],
    ['uninspectable', { covered: 1, residual: 0, uninspectable: 1 }]
  ] as const)('takes no screenshot when redaction reports %s', async (reason, redaction) => {
    const { bridge, evaluated } = createFakeBridge({ redaction })

    const outcome = await createDriver(bridge).captureScreenshot(['tok-secret-123'])

    expect(outcome).toMatchObject({ kind: 'withheld', reason, overlaysRestored: true })
    expect(bridge.screenshot).not.toHaveBeenCalled()
    expect(evaluated.at(-1)).toContain('removed: removed')
  })

  it('restores the overlays when capture throws', async () => {
    const { bridge, evaluated } = createFakeBridge({ screenshotFails: true })

    const outcome = await createDriver(bridge).captureScreenshot(['tok-secret-123'])

    expect(outcome).toMatchObject({
      kind: 'failed',
      message: 'capture failed',
      overlaysRestored: true
    })
    expect(evaluated.at(-1)).toContain('removed: removed')
  })

  it('skips blurring when the run has no sensitive values', async () => {
    const { bridge, evaluated } = createFakeBridge()

    const outcome = await createDriver(bridge).captureScreenshot([])

    expect(outcome).toMatchObject({ kind: 'captured', blurredCount: 0 })
    expect(evaluated).toEqual([])
  })
})
