// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import userEvent from '@testing-library/user-event'
import type { SqlConnectionView } from '../../../../../shared/sql-client/sql-client-types'

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string, values?: Record<string, unknown>) =>
    fallback.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(values?.[name] ?? ''))
}))

vi.mock('@/components/ui/select', () => ({
  Select: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectTrigger: ({ children, id }: { children: React.ReactNode; id?: string }) => (
    <button type="button" id={id}>
      {children}
    </button>
  ),
  SelectValue: () => null,
  SelectContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children }: { children: React.ReactNode }) => <div>{children}</div>
}))

import ConnectionFormDialog from './ConnectionFormDialog'

const api = {
  createConnection: vi.fn(),
  updateConnection: vi.fn(),
  testConnection: vi.fn()
}

const existing: SqlConnectionView = {
  id: 'c1',
  name: 'Local',
  host: 'localhost',
  port: 5433,
  user: 'postgres',
  database: 'cases',
  sslMode: 'require',
  createdAt: 't',
  updatedAt: 't',
  revision: 4,
  passwordState: 'set',
  agentAccess: 'full',
  status: { state: 'idle' }
}

function renderDialog(overrides: Partial<React.ComponentProps<typeof ConnectionFormDialog>> = {}) {
  const onSaved = vi.fn()
  const onClose = vi.fn()
  render(
    <ConnectionFormDialog
      worktreeId="wt-1"
      encryptionAvailable
      onClose={onClose}
      onSaved={onSaved}
      {...overrides}
    />
  )
  return { onSaved, onClose }
}

async function fillRequired(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('Name'), 'My DB')
  await user.type(screen.getByLabelText('Host'), 'db.local')
  await user.type(screen.getByLabelText('User'), 'app')
  await user.type(screen.getByLabelText('Database'), 'cases')
}

beforeEach(() => {
  Object.defineProperty(window, 'api', { value: { sqlClient: api }, configurable: true })
  for (const fn of Object.values(api)) {
    fn.mockReset()
  }
})
afterEach(cleanup)

describe('ConnectionFormDialog', () => {
  it('requires name, host, user and database before saving', async () => {
    const user = userEvent.setup()
    renderDialog()
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(screen.getAllByText('Required')).toHaveLength(4)
    expect(api.createConnection).not.toHaveBeenCalled()
  })

  it('defaults to port 5432 and SSL prefer', async () => {
    const user = userEvent.setup()
    api.createConnection.mockResolvedValue({ ok: true, connection: existing })
    const { onSaved } = renderDialog()
    expect(screen.getByLabelText('Port')).toHaveValue('5432')
    await fillRequired(user)
    await user.type(screen.getByLabelText('Password'), 'secret')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(api.createConnection).toHaveBeenCalledWith({
      worktreeId: 'wt-1',
      input: {
        name: 'My DB',
        host: 'db.local',
        port: 5432,
        user: 'app',
        database: 'cases',
        sslMode: 'prefer',
        password: 'secret'
      }
    })
  })

  it('rejects an out-of-range port', async () => {
    const user = userEvent.setup()
    renderDialog()
    await fillRequired(user)
    await user.clear(screen.getByLabelText('Port'))
    await user.type(screen.getByLabelText('Port'), '70000')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(screen.getByText('Enter a port from 1 to 65535')).toBeInTheDocument()
    expect(api.createConnection).not.toHaveBeenCalled()
  })

  it('edits with an empty password field and omits the password when untouched', async () => {
    const user = userEvent.setup()
    api.updateConnection.mockResolvedValue({ ok: true, connection: existing })
    renderDialog({ existing })
    const password = screen.getByLabelText('Password')
    expect(password).toHaveValue('')
    expect(password).toHaveAttribute('placeholder', 'Unchanged')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(api.updateConnection).toHaveBeenCalled())
    const call = api.updateConnection.mock.calls[0][0]
    expect(call).toMatchObject({ id: 'c1', baseRevision: 4 })
    expect('password' in call.input).toBe(false)
    expect(call.input).toMatchObject({ port: 5433, sslMode: 'require' })
  })

  it('sends the password once it has been typed on an edit', async () => {
    const user = userEvent.setup()
    api.updateConnection.mockResolvedValue({ ok: true, connection: existing })
    renderDialog({ existing })
    await user.type(screen.getByLabelText('Password'), 'new-secret')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(api.updateConnection).toHaveBeenCalled())
    expect(api.updateConnection.mock.calls[0][0].input.password).toBe('new-secret')
  })

  it('shows the protection gap message when passwords cannot be encrypted', () => {
    renderDialog({ encryptionAvailable: false, protectionGapMessage: 'No keyring is available.' })
    expect(screen.getByText('No keyring is available.')).toBeInTheDocument()
  })

  it('asks for the password again when the saved one cannot be read', () => {
    renderDialog({ existing: { ...existing, passwordState: 'needs-reentry' } })
    expect(screen.getByText(/can no longer be read/)).toBeInTheDocument()
  })

  it('shows the server version when the test succeeds', async () => {
    const user = userEvent.setup()
    api.testConnection.mockResolvedValue({ ok: true, serverVersion: '16.2' })
    renderDialog()
    await fillRequired(user)
    await user.click(screen.getByRole('button', { name: 'Test connection' }))
    expect(await screen.findByText('Connected to PostgreSQL 16.2')).toBeInTheDocument()
  })

  it('shows the error when the test fails', async () => {
    const user = userEvent.setup()
    api.testConnection.mockResolvedValue({
      ok: false,
      code: 'invalid',
      message: 'password authentication failed'
    })
    renderDialog()
    await fillRequired(user)
    await user.click(screen.getByRole('button', { name: 'Test connection' }))
    expect(await screen.findByText('password authentication failed')).toBeInTheDocument()
  })

  it('shows a failed save inline and stays open', async () => {
    const user = userEvent.setup()
    api.createConnection.mockResolvedValue({
      ok: false,
      code: 'invalid',
      message: 'A connection named "My DB" already exists.'
    })
    const { onSaved } = renderDialog()
    await fillRequired(user)
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('already exists')
    expect(onSaved).not.toHaveBeenCalled()
  })
})
