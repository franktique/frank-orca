import { describe, expect, it } from 'vitest'
import { parseTestMapFile } from './test-map-schema'

const minimal = {
  orcaTestMap: 1,
  entries: [
    {
      request: { path: ['Scenarios', 'SC-1 Bulk create'] },
      before: [{ sql: "SELECT count(*) FROM requests WHERE case_id = '{{caseId}}'" }],
      after: [
        {
          sql: "SELECT id, status FROM requests WHERE case_id = '{{caseId}}'",
          description: '3 rows, status PENDING'
        }
      ]
    }
  ]
}

const full = {
  orcaTestMap: 1,
  guide: 'smoke/guide.html',
  allowedHosts: ['localhost', '*.dev.example.com'],
  databaseConsole: {
    editorSelector: '.monaco-editor',
    runSelector: "button[aria-label='Run']"
  },
  entries: [
    {
      request: { path: ['Preflight', 'Health'] },
      stepId: 'P-1',
      expect: { status: 200 }
    },
    {
      request: { path: ['Setup', 'Create case'] },
      stepId: 'S-1',
      captures: [{ variable: 'caseId', from: 'id' }]
    },
    {
      request: { path: ['Scenarios', 'SC-1 Bulk create'] },
      stepId: 'SC-1',
      title: 'Bulk create',
      expect: { status: 201 },
      captures: [{ variable: 'requestId', from: 'data.requestId' }],
      before: [{ sql: 'SELECT 1', precondition: true }],
      after: [{ sql: 'SELECT 2' }]
    },
    {
      request: { path: ['Scenarios', 'SC-4 Duplicate'] },
      stepId: 'SC-4',
      dependsOn: ['SC-1'],
      expect: { status: 422, errorCode: 'AM00109' }
    },
    {
      request: { path: ['Scenarios', 'SC-14 Race A'] },
      stepId: 'SC-14a',
      concurrentGroup: 'race',
      expectAll: [{ status: 201 }, { status: [409, 422], errorCode: 'AM00107' }]
    },
    { request: { id: 'node-9' }, stepId: 'SC-14b', concurrentGroup: 'race' },
    {
      request: { path: ['Cleanup', 'Delete request'] },
      phase: 'cleanup',
      forEach: 'requestId',
      after: [{ sql: 'DELETE FROM requests', changesData: true }]
    }
  ]
}

function issuesOf(raw: unknown) {
  const result = parseTestMapFile(raw)
  if (result.ok) {
    throw new Error('expected the map to be rejected')
  }
  return result.issues
}

const withEntry = (entry: Record<string, unknown>) => ({
  orcaTestMap: 1,
  entries: [{ request: { path: ['A', 'B'] }, ...entry }]
})

describe('parseTestMapFile', () => {
  it('parses the minimal example with defaults and generated query ids', () => {
    const result = parseTestMapFile(minimal)
    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    const [query] = result.file.entries[0].before
    expect(query.precondition).toBe(false)
    expect(query.changesData).toBe(false)
    expect(query.id).toMatch(/\S/)
    expect(result.file.entries[0].after[0].id).not.toBe(query.id)
    expect(result.unknownFields).toEqual([])
  })

  it('keeps a provided query id', () => {
    const result = parseTestMapFile(withEntry({ before: [{ id: 'q1', sql: 'SELECT 1' }] }))
    expect(result.ok && result.file.entries[0].before[0].id).toBe('q1')
  })

  it('parses the full example', () => {
    const result = parseTestMapFile(full)
    expect(result.ok).toBe(true)
    expect(result.ok && result.unknownFields).toEqual([])
  })

  it('rejects another version and names the supported one', () => {
    const [issue] = issuesOf({ ...minimal, orcaTestMap: 2 })
    expect(issue.path).toBe('orcaTestMap')
    expect(issue.message).toContain('orcaTestMap: 1')
  })

  it('rejects a non-numeric status with its path', () => {
    const raw = {
      orcaTestMap: 1,
      entries: [1, 2, 3]
        .map(() => ({ request: { id: 'x' } }))
        // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: Deliberately malformed entry to exercise schema rejection.
        .concat({
          request: { id: 'x' },
          expect: { status: 'abc' }
        } as never)
    }
    expect(issuesOf(raw).map((i) => i.path)).toContain('entries[3].expect.status')
  })

  it('rejects out-of-range statuses', () => {
    expect(issuesOf(withEntry({ expect: { status: 99 } }))[0].path).toBe('entries[0].expect.status')
    expect(issuesOf(withEntry({ expect: { status: [200, 600] } }))[0].path).toBe(
      'entries[0].expect.status[1]'
    )
  })

  it('rejects blank SQL', () => {
    const [issue] = issuesOf(withEntry({ after: [{ sql: '   ' }] }))
    expect(issue).toEqual({
      path: 'entries[0].after[0].sql',
      message: 'must not be blank'
    })
  })

  it('rejects duplicate stepId at the second occurrence', () => {
    const raw = {
      orcaTestMap: 1,
      entries: [
        { request: { id: 'a' }, stepId: 'S-1' },
        { request: { id: 'b' }, stepId: 'S-1' }
      ]
    }
    const [issue] = issuesOf(raw)
    expect(issue.path).toBe('entries[1].stepId')
    expect(issue.message).toContain('unique')
  })

  it('rejects a dangling dependsOn', () => {
    const [issue] = issuesOf(withEntry({ stepId: 'S-1', dependsOn: ['S-9'] }))
    expect(issue.path).toBe('entries[0].dependsOn[0]')
  })

  it('accepts dependsOn that names a later step', () => {
    const raw = {
      orcaTestMap: 1,
      entries: [
        { request: { id: 'a' }, dependsOn: ['S-2'] },
        { request: { id: 'b' }, stepId: 'S-2' }
      ]
    }
    expect(parseTestMapFile(raw).ok).toBe(true)
  })

  it('rejects forEach outside cleanup', () => {
    expect(issuesOf(withEntry({ forEach: 'caseId' }))[0].path).toBe('entries[0].forEach')
    expect(issuesOf(withEntry({ forEach: 'caseId', phase: 'setup' }))[0].path).toBe(
      'entries[0].forEach'
    )
  })

  it('rejects expectAll without concurrentGroup', () => {
    const [issue] = issuesOf(withEntry({ expectAll: [{ status: 200 }] }))
    expect(issue.path).toBe('entries[0].expectAll')
  })

  it('rejects invalid variable names', () => {
    const issues = issuesOf(withEntry({ captures: [{ variable: '1bad', from: 'id' }] }))
    expect(issues[0].path).toBe('entries[0].captures[0].variable')
  })

  it('reports unknown top-level and entry fields as warnings', () => {
    const raw = {
      ...minimal,
      extra: 1,
      entries: [{ ...minimal.entries[0], stepid: 'x' }]
    }
    const result = parseTestMapFile(raw)
    expect(result.ok && result.unknownFields).toEqual(['extra', 'entries[0].stepid'])
  })

  it('rejects non-object input', () => {
    expect(parseTestMapFile(null).ok).toBe(false)
    expect(parseTestMapFile([]).ok).toBe(false)
  })
})
