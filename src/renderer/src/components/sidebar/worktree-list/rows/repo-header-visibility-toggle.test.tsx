// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RepoHeaderVisibilityToggleButton } from './repo-header-project-actions'
import type { Repo } from '../../../../../../shared/repo-types'

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string, values?: Record<string, string>) =>
    fallback.replace('{{value0}}', values?.value0 ?? '')
}))

vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => (
    <span data-tooltip="">{children}</span>
  ),
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>
}))

function makeRepo(overrides: Partial<Repo> = {}): Repo {
  return {
    id: 'repo-1',
    path: '/tmp/repo-1',
    displayName: 'Repo 1',
    badgeColor: 'gray',
    addedAt: 1,
    ...overrides
  }
}

afterEach(cleanup)

describe('RepoHeaderVisibilityToggleButton', () => {
  it('offers hiding for a visible project and toggles through the action callback', async () => {
    const user = userEvent.setup()
    const onToggleProjectHidden = vi.fn()
    render(
      <RepoHeaderVisibilityToggleButton
        repo={makeRepo()}
        label="Repo 1"
        onToggleProjectHidden={onToggleProjectHidden}
      />
    )

    expect(screen.getByRole('button')).toHaveAttribute('aria-label', 'Repo 1 visibility')
    expect(screen.getByText('Hide project')).toBeInTheDocument()
    expect(document.querySelector('.lucide-eye:not(.lucide-eye-off)')).not.toBeNull()

    await user.click(screen.getByRole('button'))
    expect(onToggleProjectHidden).toHaveBeenCalledWith(expect.objectContaining({ id: 'repo-1' }))
  })

  it('offers showing for a hidden project', () => {
    render(
      <RepoHeaderVisibilityToggleButton
        repo={makeRepo({ hidden: true })}
        label="Repo 1"
        onToggleProjectHidden={vi.fn()}
      />
    )

    expect(screen.getByText('Show project')).toBeInTheDocument()
    expect(document.querySelector('.lucide-eye-off')).not.toBeNull()
  })
})
