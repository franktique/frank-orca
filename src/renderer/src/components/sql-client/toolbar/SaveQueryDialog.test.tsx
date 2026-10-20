// @vitest-environment happy-dom

import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import userEvent from '@testing-library/user-event'
import type { SqlQueryCollection } from '../../../../../shared/sql-client/sql-client-types'

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string, values?: Record<string, unknown>) =>
    fallback.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(values?.[name] ?? ''))
}))
vi.mock('@/components/ui/select', () => ({
  Select: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectTrigger: ({ children }: { children: ReactNode }) => (
    <button type="button">{children}</button>
  ),
  SelectValue: () => null,
  SelectContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children }: { children: ReactNode }) => <div>{children}</div>
}))

import { defaultSavedQueryName } from '@/lib/sql-saved-query-actions'
import SaveQueryDialog from './SaveQueryDialog'

const collections: SqlQueryCollection[] = [
  { id: 'c1', connectionId: 'conn', name: 'Cleanup', createdAt: 't', revision: 1 }
]

afterEach(cleanup)

describe('defaultSavedQueryName', () => {
  it('collapses whitespace and keeps the first 40 characters', () => {
    expect(defaultSavedQueryName('select   *\n  from\t cases')).toBe('select * from cases')
    expect(defaultSavedQueryName(`select ${'x'.repeat(100)}`)).toHaveLength(40)
  })
})

describe('SaveQueryDialog', () => {
  it('prefills the name from the SQL and saves without a collection by default', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn().mockResolvedValue(true)
    const onClose = vi.fn()
    render(
      <SaveQueryDialog
        sql={'select  *   from\n cases'}
        collections={collections}
        onSave={onSave}
        onClose={onClose}
      />
    )
    expect(screen.getByLabelText('Name')).toHaveValue('select * from cases')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(onSave).toHaveBeenCalledWith({ name: 'select * from cases', collectionId: null })
  })

  it('stays open when saving fails', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(
      <SaveQueryDialog
        sql="select 1"
        collections={collections}
        onSave={vi.fn().mockResolvedValue(false)}
        onClose={onClose}
      />
    )
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('blocks an empty name', async () => {
    const user = userEvent.setup()
    render(<SaveQueryDialog sql="select 1" collections={[]} onSave={vi.fn()} onClose={vi.fn()} />)
    await user.clear(screen.getByLabelText('Name'))
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  })
})
