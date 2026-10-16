// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'
import type { ReactNode } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { QuickLink } from '../../../../shared/quick-link-types'

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string, params?: Record<string, unknown>) =>
    params ? fallback.replace(/\{\{value0\}\}/g, String(params.value0)) : fallback
}))
vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => <>{children}</>
}))
vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>
}))

import { QuickLinksMenu } from './QuickLinksMenu'
import { quickLinkDestinations } from './open-quick-link'

const links: QuickLink[] = [
  { id: 'a', label: 'Grafana', url: 'https://grafana.example.com/' },
  { id: 'b', label: 'Jira', url: 'https://jira.example.com/' }
]

function renderMenu(over: Partial<Parameters<typeof QuickLinksMenu>[0]> = {}) {
  const props = {
    links,
    destinations: ['system', 'orca'] as const,
    onOpenLink: vi.fn(),
    onAddLink: vi.fn(),
    onEditLink: vi.fn(),
    onDeleteLink: vi.fn(),
    ...over
  }
  render(<QuickLinksMenu {...props} />)
  return props
}

afterEach(cleanup)

describe('QuickLinksMenu', () => {
  it('expands a link into browser choices and opens the picked one', async () => {
    const user = userEvent.setup()
    const props = renderMenu()
    expect(screen.queryByText('Orca Browser')).not.toBeInTheDocument()
    await user.click(screen.getByText('Grafana'))
    await user.click(screen.getByText('Orca Browser'))
    expect(props.onOpenLink).toHaveBeenCalledWith(links[0], 'orca')
  })

  it('offers only the destinations it is given', async () => {
    const user = userEvent.setup()
    renderMenu({ destinations: ['system'] })
    await user.click(screen.getByText('Jira'))
    expect(screen.getByText('System Browser')).toBeInTheDocument()
    expect(screen.queryByText('Orca Browser')).not.toBeInTheDocument()
  })

  it('edits and deletes without expanding the row', async () => {
    const user = userEvent.setup()
    const props = renderMenu()
    await user.click(screen.getByRole('button', { name: 'Edit Jira' }))
    await user.click(screen.getByRole('button', { name: 'Remove Grafana' }))
    expect(props.onEditLink).toHaveBeenCalledWith(links[1])
    expect(props.onDeleteLink).toHaveBeenCalledWith(links[0])
    expect(screen.queryByText('System Browser')).not.toBeInTheDocument()
  })

  it('filters by label or url', async () => {
    const user = userEvent.setup()
    renderMenu()
    await user.type(screen.getByPlaceholderText('Search quick links...'), 'jira.example')
    expect(screen.queryByText('Grafana')).not.toBeInTheDocument()
    expect(screen.getByText('Jira')).toBeInTheDocument()
  })
})

describe('quickLinkDestinations', () => {
  it('orders by the link-routing preference and drops Orca without a worktree', () => {
    expect(quickLinkDestinations(true, 'wt')).toEqual(['orca', 'system'])
    expect(quickLinkDestinations(false, 'wt')).toEqual(['system', 'orca'])
    expect(quickLinkDestinations(true, null)).toEqual(['system'])
  })
})
