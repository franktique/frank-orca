// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import userEvent from '@testing-library/user-event'
import type { SqlColumn } from '../../../../../shared/sql-client/sql-client-types'

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string, values?: Record<string, unknown>) =>
    fallback.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(values?.[name] ?? ''))
}))

// happy-dom has no layout, so the real virtualizer would mount no rows.
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getVirtualItems: () =>
      Array.from({ length: count }, (_unused, index) => ({ index, key: index, start: index * 28 })),
    getTotalSize: () => count * 28,
    scrollToIndex: () => undefined
  })
}))

import { TooltipProvider } from '@/components/ui/tooltip'
import SqlResultsGrid from './SqlResultsGrid'

const columns: SqlColumn[] = [
  { name: 'id', dataTypeId: 23, dataTypeName: 'integer' },
  { name: 'note', dataTypeId: 25, dataTypeName: 'text' },
  { name: 'flag', dataTypeId: 16, dataTypeName: 'boolean' }
]
const longValue = 'x'.repeat(500)
const rows: (string | null)[][] = [
  ['1', 'plain', 't'],
  ['2', null, 'f'],
  ['3', longValue, null]
]

const writeClipboardText = vi.fn()

function renderGrid() {
  render(
    <TooltipProvider>
      <SqlResultsGrid columns={columns} rows={rows} />
    </TooltipProvider>
  )
}

const cell = (row: number, column: number): HTMLElement => {
  const element = document.querySelector<HTMLElement>(
    `[data-row="${row}"][data-column="${column}"]`
  )
  if (!element) {
    throw new Error(`no cell ${row}:${column}`)
  }
  return element
}

beforeEach(() => {
  writeClipboardText.mockReset()
  writeClipboardText.mockResolvedValue(undefined)
  Object.defineProperty(window, 'api', {
    value: { ui: { writeClipboardText } },
    configurable: true
  })
})
afterEach(cleanup)

describe('SqlResultsGrid copy', () => {
  it('copies the full, untruncated value on click', async () => {
    const user = userEvent.setup()
    renderGrid()
    await user.click(cell(2, 1))
    expect(writeClipboardText).toHaveBeenCalledWith(longValue)
  })

  it('copies a NULL cell as an empty string and shows the NULL token', async () => {
    const user = userEvent.setup()
    renderGrid()
    expect(cell(1, 1)).toHaveTextContent('NULL')
    await user.click(cell(1, 1))
    expect(writeClipboardText).toHaveBeenCalledWith('')
  })

  it('does not confuse the text NULL with a NULL value', async () => {
    const user = userEvent.setup()
    render(
      <TooltipProvider>
        <SqlResultsGrid columns={columns} rows={[['1', 'NULL', 't']]} />
      </TooltipProvider>
    )
    await user.click(cell(0, 1))
    expect(writeClipboardText).toHaveBeenCalledWith('NULL')
    expect(cell(0, 1).querySelector('.italic')).toBeNull()
  })

  it('flashes the copied cell and announces it to screen readers', async () => {
    const user = userEvent.setup()
    renderGrid()
    await user.click(cell(0, 0))
    await waitFor(() => expect(cell(0, 0)).toHaveAttribute('data-copied', 'true'))
    expect(screen.getByRole('status')).toHaveTextContent('Copied cell')
  })

  it('copies the focused cell on Enter and Space', async () => {
    const user = userEvent.setup()
    renderGrid()
    cell(0, 0).focus()
    await user.click(cell(0, 0))
    writeClipboardText.mockClear()
    await user.keyboard('{ArrowRight}')
    await user.keyboard('{Enter}')
    expect(writeClipboardText).toHaveBeenLastCalledWith('plain')
    await user.keyboard('{ArrowRight}')
    await user.keyboard(' ')
    expect(writeClipboardText).toHaveBeenLastCalledWith('t')
  })

  it('extends a range with Shift+click and copies it as TSV with Ctrl+C', async () => {
    const user = userEvent.setup()
    renderGrid()
    await user.click(cell(0, 0))
    await user.keyboard('{Shift>}')
    await user.click(cell(1, 1))
    await user.keyboard('{/Shift}')
    expect(cell(1, 0)).toHaveAttribute('aria-selected', 'true')
    writeClipboardText.mockClear()
    await user.keyboard('{Control>}c{/Control}')
    expect(writeClipboardText).toHaveBeenCalledWith('id\tnote\n1\tplain\n2\t')
  })

  it('extends a range with Shift+arrows', async () => {
    const user = userEvent.setup()
    renderGrid()
    await user.click(cell(0, 0))
    await user.keyboard('{Shift>}{ArrowDown}{ArrowRight}{/Shift}')
    expect(cell(1, 1)).toHaveAttribute('aria-selected', 'true')
    expect(cell(2, 2)).toHaveAttribute('aria-selected', 'false')
  })

  it('selects a whole row from its number and a whole column from its header', async () => {
    const user = userEvent.setup()
    renderGrid()
    await user.click(screen.getByRole('rowheader', { name: '2' }))
    expect(cell(1, 0)).toHaveAttribute('aria-selected', 'true')
    expect(cell(1, 2)).toHaveAttribute('aria-selected', 'true')
    expect(cell(0, 0)).toHaveAttribute('aria-selected', 'false')
    writeClipboardText.mockClear()
    await user.keyboard('{Control>}c{/Control}')
    expect(writeClipboardText).toHaveBeenCalledWith('id\tnote\tflag\n2\t\tf')

    await user.click(screen.getByRole('columnheader', { name: /note/ }))
    expect(cell(0, 1)).toHaveAttribute('aria-selected', 'true')
    expect(cell(2, 1)).toHaveAttribute('aria-selected', 'true')
    expect(cell(0, 0)).toHaveAttribute('aria-selected', 'false')
  })

  it('keeps a single tab stop: only the focused cell is tabbable', async () => {
    const user = userEvent.setup()
    renderGrid()
    expect(screen.getByRole('grid')).toHaveAttribute('tabindex', '0')
    expect(document.querySelectorAll('[role="gridcell"][tabindex="0"]')).toHaveLength(0)
    await user.click(cell(1, 1))
    expect(screen.getByRole('grid')).toHaveAttribute('tabindex', '-1')
    expect(document.querySelectorAll('[role="gridcell"][tabindex="0"]')).toHaveLength(1)
    await user.keyboard('{ArrowDown}')
    expect(cell(2, 1)).toHaveAttribute('tabindex', '0')
    expect(cell(1, 1)).toHaveAttribute('tabindex', '-1')
  })
})
