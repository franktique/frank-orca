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

import TestRunDataChangeApprovals from './TestRunDataChangeApprovals'

let root: Root
let container: HTMLDivElement

const steps = [
  { stepId: 's1', title: 'Create case', phase: 'setup' as const, queries: [], problems: [] }
]

beforeEach(() => {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('TestRunDataChangeApprovals', () => {
  it('renders nothing without data-changing steps', async () => {
    await act(async () =>
      root.render(
        <TestRunDataChangeApprovals
          steps={steps}
          dataChangingSteps={[]}
          approved={[]}
          onToggle={vi.fn()}
        />
      )
    )
    expect(container.innerHTML).toBe('')
  })

  it('lists each step unchecked and reports toggles', async () => {
    const onToggle = vi.fn()
    await act(async () =>
      root.render(
        <TestRunDataChangeApprovals
          steps={steps}
          dataChangingSteps={[{ stepId: 's1', queryIds: ['q1', 'q2'] }]}
          approved={[]}
          onToggle={onToggle}
        />
      )
    )
    expect(container.textContent).toContain('Allow Create case (2 data-changing queries)')
    const box = container.querySelector<HTMLElement>('#test-run-approve-s1')
    expect(box?.getAttribute('aria-checked')).toBe('false')
    await act(async () => box?.click())
    expect(onToggle).toHaveBeenCalledWith('s1', true)
  })
})
