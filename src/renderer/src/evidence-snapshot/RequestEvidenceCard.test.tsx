// @vitest-environment happy-dom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import RequestEvidenceCard from './RequestEvidenceCard'

describe('RequestEvidenceCard', () => {
  it('shows method, url, request body, status and clipped response body', () => {
    const body = Array.from({ length: 60 }, (_, i) => `line ${i}`).join('\n')
    render(
      <RequestEvidenceCard
        card={{
          kind: 'request',
          title: 'SC-1',
          durationMs: 312,
          resolvedRequest: {
            method: 'POST',
            url: 'https://qa.example.com/x',
            headers: [['Authorization', 'Bearer ••••']],
            body: '{"a":1}'
          },
          outcome: {
            kind: 'response',
            response: {
              status: 201,
              statusText: 'Created',
              headers: [['content-type', 'text/plain']],
              sizeBytes: 10,
              contentType: 'text/plain',
              body: { encoding: 'utf8', text: body, truncated: false },
              redirects: []
            }
          }
        }}
      />
    )
    expect(screen.getByText('https://qa.example.com/x', { exact: false })).toBeTruthy()
    expect(screen.getByText('201 Created')).toBeTruthy()
    expect(screen.getByText('Bearer ••••')).toBeTruthy()
    expect(screen.getByText('… 20 more lines', { exact: false })).toBeTruthy()
  })
})
