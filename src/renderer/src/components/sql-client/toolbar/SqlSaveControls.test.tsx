// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import userEvent from '@testing-library/user-event'

type MockState = {
  sqlTabsById: Record<
    string,
    { draftText: string; savedQueryId: string | null; connectionId: string | null }
  >
  sqlProjectKeyByWorktree: Record<string, string>
  sqlSnapshotsByProject: Record<string, unknown>
}

const mocks = vi.hoisted(() => ({
  state: {
    sqlTabsById: {},
    sqlProjectKeyByWorktree: { 'wt-1': 'repo:r1' },
    sqlSnapshotsByProject: {}
  } satisfies MockState
}))

vi.mock('@/store', () => ({
  useAppStore: Object.assign(
    (selector: (state: typeof mocks.state) => unknown) => selector(mocks.state),
    { getState: () => mocks.state }
  )
}))
vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string) => fallback
}))

import SqlSaveControls from './SqlSaveControls'
import { TooltipProvider } from '@/components/ui/tooltip'

function setup(draftText: string, savedSql: string | null) {
  mocks.state.sqlTabsById = {
    'tab-1': { draftText, savedQueryId: savedSql === null ? null : 'q1', connectionId: 'conn' }
  }
  mocks.state.sqlSnapshotsByProject = {
    'repo:r1': {
      queries:
        savedSql === null
          ? []
          : [
              {
                id: 'q1',
                connectionId: 'conn',
                collectionId: null,
                name: 'My query',
                sql: savedSql,
                revision: 1
              }
            ]
    }
  }
  const onSave = vi.fn()
  render(
    <TooltipProvider>
      <SqlSaveControls worktreeId="wt-1" tabId="tab-1" onSave={onSave} />
    </TooltipProvider>
  )
  return onSave
}

afterEach(cleanup)

describe('SqlSaveControls', () => {
  it('shows the loaded query name and no marker while the draft matches it', () => {
    setup('select 1', 'select 1')
    expect(screen.getByText('My query')).toBeInTheDocument()
    expect(document.querySelector('[data-unsaved]')).toBeNull()
  })

  it('marks unsaved changes once the draft differs from the saved query', () => {
    setup('select 2', 'select 1')
    expect(document.querySelector('[data-unsaved]')).not.toBeNull()
  })

  it('shows nothing about a query when the tab is not linked to one', () => {
    setup('select 1', null)
    expect(screen.queryByText('My query')).toBeNull()
  })

  it('saves in place on a plain click and as new on Alt-click', async () => {
    const user = userEvent.setup()
    const onSave = setup('select 2', 'select 1')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(onSave).toHaveBeenLastCalledWith(false)
    await user.keyboard('{Alt>}')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await user.keyboard('{/Alt}')
    expect(onSave).toHaveBeenLastCalledWith(true)
  })

  it('cannot save an empty editor', () => {
    setup('', null)
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  })
})
