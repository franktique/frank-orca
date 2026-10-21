// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string, values?: Record<string, unknown>) =>
    values
      ? fallback.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(values[name] ?? ''))
      : fallback
}))

import TestRunPauseCard, { type TestRunPauseCardRequest } from './TestRunPauseCard'

let root: Root
let container: HTMLDivElement
const writeClipboardText = vi.fn()

const button = (label: string): HTMLButtonElement | undefined =>
  [...container.querySelectorAll('button')].find((b) => b.textContent === label)

async function render(
  pause: TestRunPauseCardRequest,
  onAnswer = vi.fn()
): Promise<typeof onAnswer> {
  await act(async () => root.render(<TestRunPauseCard pause={pause} onAnswer={onAnswer} />))
  return onAnswer
}

async function typeInto(
  el: HTMLInputElement | HTMLTextAreaElement | null,
  value: string
): Promise<void> {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement : HTMLInputElement
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto.prototype, 'value')?.set?.call(el, value)
    el?.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

beforeEach(() => {
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: { ui: { writeClipboardText } }
  })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.clearAllMocks()
})

describe('TestRunPauseCard variants', () => {
  it('credentials: masked inputs, Resume needs values, Stop answers', async () => {
    const onAnswer = await render({
      kind: 'credentials',
      stepId: 's1',
      inputs: [{ name: 'token', secret: true }]
    })
    const input = container.querySelector<HTMLInputElement>('#test-run-credential-token')
    expect(input?.type).toBe('password')
    expect(button('Resume')?.disabled).toBe(true)
    await typeInto(input, 'abc')
    await act(async () => button('Resume')?.click())
    expect(onAnswer).toHaveBeenCalledWith({
      kind: 'credentials',
      action: 'resume',
      values: { token: 'abc' }
    })
    await act(async () => button('Stop')?.click())
    expect(onAnswer).toHaveBeenCalledWith({ kind: 'credentials', action: 'stop' })
  })

  it('stopping: Run cleanup and Keep data', async () => {
    const onAnswer = await render({ kind: 'stopping' })
    await act(async () => button('Run cleanup')?.click())
    await act(async () => button('Keep data')?.click())
    expect(onAnswer).toHaveBeenNthCalledWith(1, { kind: 'stopping', choice: 'run-cleanup' })
    expect(onAnswer).toHaveBeenNthCalledWith(2, { kind: 'stopping', choice: 'keep-data' })
  })

  const manual: TestRunPauseCardRequest = {
    kind: 'manual-queries',
    stepId: 's1',
    when: 'before',
    queries: [
      { queryId: 'q1', sqlResolved: 'SELECT ***', sqlRaw: 'SELECT secret' },
      { queryId: 'q2', sqlResolved: 'SELECT 2' }
    ]
  }

  it('manual-queries: copies raw sql when present, else resolved', async () => {
    await render(manual)
    expect(container.textContent).toContain('SELECT ***')
    const copies = [...container.querySelectorAll('button')].filter((b) => b.textContent === 'Copy')
    await act(async () => copies[0].click())
    await act(async () => copies[1].click())
    expect(writeClipboardText).toHaveBeenNthCalledWith(1, 'SELECT secret')
    expect(writeClipboardText).toHaveBeenNthCalledWith(2, 'SELECT 2')
  })

  it('manual-queries: Continue sends pasted results', async () => {
    const onAnswer = await render(manual)
    await typeInto(container.querySelector('textarea'), 'row 1')
    await act(async () => button('Continue')?.click())
    expect(onAnswer).toHaveBeenCalledWith({
      kind: 'manual-queries',
      action: 'continue',
      pasted: { q1: 'row 1' }
    })
  })

  it('manual-queries: per-query Skip answers with the skipped ids', async () => {
    const onAnswer = await render(manual)
    const skips = [...container.querySelectorAll('button')].filter((b) => b.textContent === 'Skip')
    await act(async () => skips[1].click())
    await act(async () => button('Continue')?.click())
    expect(onAnswer).toHaveBeenCalledWith({
      kind: 'manual-queries',
      action: 'skip',
      queryIds: ['q2']
    })
  })

  it('answers browser-recovery actions and picks another tab', async () => {
    const listConsoleTabs = vi.fn().mockResolvedValue({
      ok: true,
      tabs: [{ browserPageId: 'p2', title: 'Other', url: 'https://x.test' }]
    })
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { ui: { writeClipboardText }, testRun: { listConsoleTabs } }
    })
    const onAnswer = vi.fn()
    await act(async () =>
      root.render(
        <TestRunPauseCard
          worktreeId="wt"
          pause={{
            kind: 'browser-recovery',
            stepId: 's1',
            queryId: 'q1',
            problem: 'sign-in',
            screenshot: 'data:image/png;base64,AAA'
          }}
          onAnswer={onAnswer}
        />
      )
    )
    expect(container.querySelector('img')).not.toBeNull()
    await act(async () => button('Retry')?.click())
    expect(onAnswer).toHaveBeenLastCalledWith({ kind: 'browser-recovery', action: 'retry' })
    await act(async () => button('Skip remaining queries')?.click())
    expect(onAnswer).toHaveBeenLastCalledWith({
      kind: 'browser-recovery',
      action: 'skip-remaining-queries'
    })
    await act(async () => button('Other')?.click())
    expect(onAnswer).toHaveBeenLastCalledWith({
      kind: 'browser-recovery',
      action: 'pick-tab',
      browserPageId: 'p2'
    })
  })
})
