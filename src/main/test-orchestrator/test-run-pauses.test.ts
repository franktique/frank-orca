import { describe, expect, it } from 'vitest'
import { TestRunPauses } from './test-run-pauses'

const credentials = {
  kind: 'credentials' as const,
  stepId: 's1',
  inputs: [{ name: 'token', secret: true }]
}

function setup() {
  let t = 1000
  const pauses = new TestRunPauses(() => t)
  return { pauses, advance: (ms: number) => (t += ms) }
}

describe('TestRunPauses', () => {
  it('resolves with a matching answer', async () => {
    const { pauses } = setup()
    let id = ''
    const waiting = pauses.raise(credentials, (pauseId) => (id = pauseId))
    expect(pauses.answer(id, { kind: 'credentials', action: 'stop' })).toEqual({ ok: true })
    await expect(waiting).resolves.toEqual({ kind: 'credentials', action: 'stop' })
  })

  it('rejects stale ids with no-pause', () => {
    const { pauses } = setup()
    const result = pauses.answer('missing', { kind: 'credentials', action: 'stop' })
    expect(result).toMatchObject({ ok: false, code: 'no-pause' })
  })

  it('rejects a wrong-kind or malformed answer and keeps waiting', () => {
    const { pauses } = setup()
    let id = ''
    void pauses.raise(credentials, (pauseId) => (id = pauseId))
    expect(pauses.answer(id, { kind: 'browser-recovery', action: 'retry' })).toMatchObject({
      code: 'pause-mismatch'
    })
    expect(pauses.answer(id, { nonsense: true })).toMatchObject({ code: 'pause-mismatch' })
    expect(pauses.pendingPauseIds()).toEqual([id])
  })

  it('accepts the stopping choice for a stopping pause', async () => {
    const { pauses } = setup()
    let id = ''
    const waiting = pauses.raise({ kind: 'stopping' }, (pauseId) => (id = pauseId))
    pauses.answer(id, { kind: 'stopping', choice: 'keep-data' })
    await expect(waiting).resolves.toEqual({ kind: 'stopping', choice: 'keep-data' })
  })

  it('accounts paused time, counting overlapping pauses once and open pauses live', () => {
    const { pauses, advance } = setup()
    let a = ''
    let b = ''
    void pauses.raise(credentials, (id) => (a = id))
    advance(100)
    void pauses.raise(credentials, (id) => (b = id))
    advance(100)
    pauses.answer(a, { kind: 'credentials', action: 'stop' })
    advance(50)
    expect(pauses.pausedMs()).toBe(250)
    pauses.answer(b, { kind: 'credentials', action: 'stop' })
    advance(500)
    expect(pauses.pausedMs()).toBe(250)
    expect(pauses.pausedWithin(1100, 1200)).toBe(100)
  })

  it('abortAll rejects waiters and closes the interval', async () => {
    const { pauses, advance } = setup()
    const waiting = pauses.raise(credentials)
    advance(40)
    pauses.abortAll(new Error('stopped'))
    await expect(waiting).rejects.toThrow('stopped')
    advance(40)
    expect(pauses.pausedMs()).toBe(40)
  })
})
