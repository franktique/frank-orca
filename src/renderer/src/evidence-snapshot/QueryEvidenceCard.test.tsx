// @vitest-environment happy-dom
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string, values?: Record<string, unknown>) =>
    fallback.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(values?.[name] ?? ''))
}))

import { TooltipProvider } from '@/components/ui/tooltip'
import QueryEvidenceCard from './QueryEvidenceCard'

describe('QueryEvidenceCard', () => {
  it('shows the query text and mounts every result row', () => {
    render(
      <TooltipProvider>
        <QueryEvidenceCard
          card={{
            kind: 'query',
            title: 'SC-1 · before 1',
            description: 'Rows for this case',
            sql: 'select id from t',
            result: {
              columns: ['id'],
              rows: Array.from({ length: 50 }, (_, i) => [`row-${i}`]),
              totalRows: 50,
              truncated: false
            }
          }}
        />
      </TooltipProvider>
    )
    expect(screen.getByText('select id from t')).toBeTruthy()
    expect(screen.getByText('row-0')).toBeTruthy()
    expect(screen.getByText('row-49')).toBeTruthy()
  })
})
