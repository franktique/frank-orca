import { describe, expect, it, vi } from 'vitest'
import type { GitDiffResult } from '../../shared/git-diff-compare-types'
import type {
  ChangeSetFile,
  ExplanationSet
} from '../../shared/agent-explanations/explanation-types'
import type { ExplanationChangeSetSnapshot } from './explanation-change-set'
import { publishExplanation, type ExplanationPublishDeps } from './explanation-publish'
import { buildGlobalOrder } from '../../shared/agent-explanations/explanation-labels'

const MERGE_BASE = 'b'.repeat(40)

function snapshot(
  overrides: Partial<ExplanationChangeSetSnapshot> = {}
): ExplanationChangeSetSnapshot {
  return {
    workspaceId: 'wt-1',
    base: {
      kind: 'branch-and-uncommitted',
      baseRef: 'origin/main',
      mergeBase: MERGE_BASE,
      headOid: 'c'.repeat(40)
    },
    files: [
      { path: 'src/a.ts', status: 'modified' },
      { path: 'src/b.ts', status: 'modified' },
      { path: 'src/added.ts', status: 'added' },
      { path: 'src/deleted.ts', status: 'deleted' },
      { path: 'src/renamed.ts', oldPath: 'src/old-name.ts', status: 'renamed' },
      { path: 'src/bin.dat', status: 'modified' }
    ],
    ...overrides
  }
}

const textDiff = (oldContent: string, newContent: string): GitDiffResult => ({
  kind: 'text',
  originalContent: oldContent,
  modifiedContent: newContent,
  originalIsBinary: false,
  modifiedIsBinary: false
})

// 8 lines on each side; line 2 is the only change.
const A_OLD = 'a1\na2\na3\na4\na5\na6\na7\na8\n'
const A_NEW = 'a1\nA2\na3\na4\na5\na6\na7\na8\n'
const B_OLD = 'b1\nb2\n'
const B_NEW = 'b1\nb2\nb3\n'

const BASE_DIFFS: Record<string, GitDiffResult> = {
  'src/a.ts': textDiff(A_OLD, A_NEW),
  'src/b.ts': textDiff(B_OLD, B_NEW),
  'src/bin.dat': {
    kind: 'binary',
    originalContent: '',
    modifiedContent: '',
    originalIsBinary: true,
    modifiedIsBinary: false
  }
}

function createDeps({
  snap = snapshot(),
  diffs = BASE_DIFFS,
  failChangeSet
}: {
  snap?: ExplanationChangeSetSnapshot
  diffs?: Record<string, GitDiffResult>
  failChangeSet?: Error
} = {}) {
  const replace = vi.fn(
    async (_workspaceId: string, _set: ExplanationSet): Promise<{ replacedPrevious: boolean }> => ({
      replacedPrevious: true
    })
  )
  const deps: ExplanationPublishDeps = {
    changeSet: vi.fn(async () => {
      if (failChangeSet) {
        throw failChangeSet
      }
      return snap
    }),
    fileDiff: vi.fn(async (_selector: string, filePath: string) => {
      const result = diffs[filePath]
      if (!result) {
        throw new Error(`no diff stub for ${filePath}`)
      }
      return result
    }),
    replace,
    terminalInfo: vi.fn((handle: string) =>
      handle === 't-1' ? { paneKey: 'pane-1', agentName: 'Pi' } : null
    )
  }
  return { deps, replace }
}

const item = (overrides: Record<string, unknown> = {}) => ({ text: 'why', ...overrides })

describe('fatal checks', () => {
  it('rejects non-JSON stdin payloads as invalid_payload', async () => {
    const { deps } = createDeps()
    const outcome = await publishExplanation('wt', '{not json', {}, deps)
    expect(outcome).toEqual({ ok: false, code: 'invalid_payload', message: expect.any(String) })
  })

  it('reports the zod path on schema failures', async () => {
    const { deps } = createDeps()
    const outcome = await publishExplanation(
      'wt',
      { version: 1, changes: [{ title: '', files: [{ path: 'x', items: [item()] }] }] },
      {},
      deps
    )
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) {
      expect(outcome.code).toBe('invalid_payload')
      expect(outcome.message).toContain('changes.0.title')
    }
  })

  it('rejects a non-1 version before parsing the rest', async () => {
    const { deps } = createDeps()
    const outcome = await publishExplanation('wt', { version: 2, changes: [] }, {}, deps)
    expect(outcome).toEqual({
      ok: false,
      code: 'unsupported_version',
      message: expect.stringContaining('2')
    })
  })

  it('rejects a re-serialized payload over 900 KB', async () => {
    const { deps } = createDeps()
    const payload = {
      version: 1,
      changes: [
        {
          title: 'big',
          summary: '',
          files: [{ path: 'src/a.ts', items: [item({ text: 'x'.repeat(1_000_000) })] }]
        }
      ]
    }
    const outcome = await publishExplanation('wt', payload, {}, deps)
    expect(outcome).toEqual({ ok: false, code: 'payload_too_large', message: expect.any(String) })
  })

  it('rejects more than 500 items', async () => {
    const { deps } = createDeps()
    const files = Array.from({ length: 6 }, (_, fileIndex) => ({
      path: 'src/a.ts',
      items: Array.from({ length: fileIndex === 5 ? 1 : 100 }, () => item())
    }))
    const outcome = await publishExplanation(
      'wt',
      { version: 1, changes: [{ title: 'many', summary: '', files }] },
      {},
      deps
    )
    expect(outcome).toEqual({
      ok: false,
      code: 'too_many_items',
      message: expect.stringContaining('> 500 items')
    })
  })

  it('rejects an empty change set with no_changes', async () => {
    const { deps } = createDeps({ snap: snapshot({ files: [] }) })
    const outcome = await publishExplanation(
      'wt',
      {
        version: 1,
        changes: [{ title: 't', summary: '', files: [{ path: 'x', items: [item()] }] }]
      },
      {},
      deps
    )
    expect(outcome).toEqual({ ok: false, code: 'no_changes', message: expect.any(String) })
  })

  it('maps a folder workspace to not_git_workspace', async () => {
    const { deps } = createDeps({ failChangeSet: new Error('not_git_workspace') })
    const outcome = await publishExplanation(
      'wt',
      {
        version: 1,
        changes: [{ title: 't', summary: '', files: [{ path: 'x', items: [item()] }] }]
      },
      {},
      deps
    )
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) {
      expect(outcome.code).toBe('not_git_workspace')
    }
  })
})

describe('per-item validation', () => {
  const changeWith = (path: string, items: Record<string, unknown>[]) => ({
    version: 1,
    changes: [{ title: 't', summary: '', files: [{ path, items }] }]
  })

  it('rejects a path that is not in the change set', async () => {
    const { deps } = createDeps()
    const outcome = await publishExplanation('wt', changeWith('src/nope.ts', [item()]), {}, deps)
    expect(outcome.ok).toBe(true)
    if (outcome.ok) {
      expect(outcome.result.published).toBe(false)
      expect(outcome.result.rejected[0]?.code).toBe('file_not_in_change_set')
    }
  })

  it('names the new path when anchoring a renamed file by its old path', async () => {
    const { deps } = createDeps()
    const outcome = await publishExplanation(
      'wt',
      changeWith('src/old-name.ts', [item()]),
      {},
      deps
    )
    expect(outcome.ok).toBe(true)
    if (outcome.ok) {
      expect(outcome.result.rejected[0]?.code).toBe('file_not_in_change_set')
      expect(outcome.result.rejected[0]?.message).toContain('src/renamed.ts')
    }
  })

  it('rejects old on an added file and new on a deleted file', async () => {
    const { deps } = createDeps()
    const outcome = await publishExplanation(
      'wt',
      {
        version: 1,
        changes: [
          {
            title: 't',
            summary: '',
            files: [
              { path: 'src/added.ts', items: [item({ side: 'old' })] },
              { path: 'src/deleted.ts', items: [item({ side: 'new' })] }
            ]
          }
        ]
      },
      {},
      deps
    )
    expect(outcome.ok).toBe(true)
    if (outcome.ok) {
      expect(outcome.result.rejected.map((issue) => issue.code)).toEqual([
        'side_unavailable',
        'side_unavailable'
      ])
    }
  })

  it('rejects lines beyond the side length', async () => {
    const { deps } = createDeps()
    const outcome = await publishExplanation(
      'wt',
      changeWith('src/a.ts', [item({ startLine: 1, endLine: 999 })]),
      {},
      deps
    )
    expect(outcome.ok).toBe(true)
    if (outcome.ok) {
      expect(outcome.result.rejected[0]?.code).toBe('line_out_of_range')
      expect(outcome.result.rejected[0]?.message).toContain('999 > 8 lines on new side')
    }
  })

  it('rejects line anchors on a binary file', async () => {
    const { deps } = createDeps()
    const outcome = await publishExplanation(
      'wt',
      changeWith('src/bin.dat', [item({ startLine: 1 })]),
      {},
      deps
    )
    expect(outcome.ok).toBe(true)
    if (outcome.ok) {
      expect(outcome.result.rejected[0]?.code).toBe('line_anchor_unsupported')
    }
  })

  it('rejects empty and oversize item text', async () => {
    const { deps } = createDeps()
    const outcome = await publishExplanation(
      'wt',
      changeWith('src/a.ts', [item({ text: '' }), item({ text: 'x'.repeat(8193) })]),
      {},
      deps
    )
    expect(outcome.ok).toBe(true)
    if (outcome.ok) {
      expect(outcome.result.rejected.map((issue) => issue.code)).toEqual([
        'text_empty',
        'text_too_long'
      ])
    }
  })

  it('warns when an anchor only covers unchanged context', async () => {
    const { deps } = createDeps()
    const outcome = await publishExplanation(
      'wt',
      changeWith('src/a.ts', [item({ id: 'ctx', startLine: 5, endLine: 6 })]),
      {},
      deps
    )
    expect(outcome.ok).toBe(true)
    if (outcome.ok) {
      expect(outcome.result.warnings[0]?.code).toBe('outside_changed_hunk')
      expect(outcome.result.warnings[0]?.clientId).toBe('ctx')
      expect(outcome.result.published).toBe(true)
    }
  })

  it('does not warn when the range touches a changed line', async () => {
    const { deps } = createDeps()
    const outcome = await publishExplanation(
      'wt',
      changeWith('src/a.ts', [item({ startLine: 1, endLine: 2 })]),
      {},
      deps
    )
    expect(outcome.ok).toBe(true)
    if (outcome.ok) {
      expect(outcome.result.warnings).toEqual([])
    }
  })

  it('merges a duplicate path into the first entry with a warning', async () => {
    const { deps } = createDeps()
    const outcome = await publishExplanation(
      'wt',
      {
        version: 1,
        changes: [
          {
            title: 't',
            summary: '',
            files: [
              { path: 'src/a.ts', items: [item({ id: 'one', startLine: 1 })] },
              { path: './src/a.ts', items: [item({ id: 'two', startLine: 3 })] }
            ]
          }
        ]
      },
      {},
      deps
    )
    expect(outcome.ok).toBe(true)
    if (outcome.ok) {
      expect(outcome.result.warnings.map((issue) => issue.code)).toContain(
        'duplicate_file_in_change'
      )
      expect(outcome.result.counts.files).toBe(1)
      expect(outcome.result.labels).toEqual([
        { id: 'one', label: 'A1.1' },
        { id: 'two', label: 'A1.2' }
      ])
    }
  })
})

describe('partial and rejected publishes', () => {
  it('stores a partial publish and reports counts, labels and replacedPrevious', async () => {
    const { deps, replace } = createDeps()
    const outcome = await publishExplanation(
      'wt',
      {
        version: 1,
        changes: [
          {
            title: 't',
            summary: '',
            files: [
              {
                path: 'src/a.ts',
                items: [item({ id: 'good', startLine: 2, endLine: 2 }), item({ startLine: 999 })]
              }
            ]
          }
        ]
      },
      {},
      deps
    )
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) {
      return
    }
    expect(outcome.result.published).toBe(true)
    expect(outcome.result.counts).toEqual({
      changes: 1,
      files: 1,
      items: 1,
      rejected: 1,
      warnings: 0
    })
    expect(outcome.result.labels).toEqual([{ id: 'good', label: 'A1.1' }])
    expect(outcome.result.changeSetBase).toEqual(snapBase())
    expect(outcome.result.replacedPrevious).toBe(true)
    expect(replace).toHaveBeenCalledTimes(1)
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: test double only needs the members the code under test reads.
    const [, set] = replace.mock.calls[0] as [string, ExplanationSet]
    expect(set.workspaceId).toBe('wt-1')
    expect(set.questions).toEqual([])
    expect(set.changes[0]?.files[0]?.items[0]?.anchor).toMatchObject({
      side: 'new',
      startLine: 2,
      endLine: 2
    })
  })

  it('keeps the previous set when every item is rejected', async () => {
    const { deps, replace } = createDeps()
    const outcome = await publishExplanation(
      'wt',
      {
        version: 1,
        changes: [{ title: 't', summary: '', files: [{ path: 'src/nope.ts', items: [item()] }] }]
      },
      {},
      deps
    )
    expect(outcome.ok).toBe(true)
    if (outcome.ok) {
      expect(outcome.result.published).toBe(false)
      expect(outcome.result.replacedPrevious).toBe(false)
    }
    expect(replace).not.toHaveBeenCalled()
  })
})

describe('normalization and labels', () => {
  it('normalizes leading ./ and backslashes', async () => {
    const { deps } = createDeps()
    const outcome = await publishExplanation(
      'wt',
      {
        version: 1,
        changes: [
          {
            title: 't',
            summary: '',
            files: [
              { path: './src/a.ts', items: [item({ id: 'dot', startLine: 1 })] },
              { path: 'src\\a.ts', items: [item({ id: 'back', startLine: 3 })] }
            ]
          }
        ]
      },
      {},
      deps
    )
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) {
      return
    }
    expect(outcome.result.counts.files).toBe(1)
    expect(outcome.result.labels).toEqual([
      { id: 'dot', label: 'A1.1' },
      { id: 'back', label: 'A1.2' }
    ])
  })

  it('keeps labels gap-free when a file or change drops out', async () => {
    const { deps } = createDeps()
    const outcome = await publishExplanation(
      'wt',
      {
        version: 1,
        changes: [
          {
            title: 'all items rejected',
            summary: '',
            files: [
              {
                path: 'src/a.ts',
                items: [
                  item({ id: 'i1', startLine: 2 }),
                  item({ id: 'i2', startLine: 999 }),
                  item({ id: 'i3', startLine: 3 })
                ]
              }
            ]
          },
          {
            title: 'all files rejected',
            summary: '',
            files: [{ path: 'src/nope.ts', items: [item({ id: 'i4' })] }]
          },
          {
            title: 'survivor',
            summary: '',
            files: [{ path: 'src/b.ts', items: [item({ id: 'i5' })] }]
          }
        ]
      },
      {},
      deps
    )
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) {
      return
    }
    // i1 and i3 renumber to A1.1/A1.2 (no A1.2→A1.3 gap), and the emptied change
    // consumes no letter, so the survivor change is A2.
    expect(outcome.result.labels).toEqual([
      { id: 'i1', label: 'A1.1' },
      { id: 'i3', label: 'A1.2' },
      { id: 'i5', label: 'B1.1' }
    ])
    expect(outcome.result.counts.changes).toBe(2)
  })
})

describe('producer resolution', () => {
  const publishWith = async (
    options: { agent?: string; terminalHandle?: string },
    payloadAgent?: string
  ) => {
    const { deps, replace } = createDeps()
    await publishExplanation(
      'wt',
      {
        version: 1,
        ...(payloadAgent ? { agent: payloadAgent } : {}),
        changes: [
          {
            title: 't',
            summary: '',
            files: [{ path: 'src/a.ts', items: [item({ startLine: 1 })] }]
          }
        ]
      },
      options,
      deps
    )
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: test double only needs the members the code under test reads.
    const [, set] = replace.mock.calls[0] as [string, ExplanationSet]
    return set.producer
  }

  it('prefers --agent over the payload agent and the pane status', async () => {
    expect(await publishWith({ agent: 'Flag', terminalHandle: 't-1' }, 'Payload')).toMatchObject({
      agentName: 'Flag',
      paneKey: 'pane-1',
      terminalHandle: 't-1'
    })
  })

  it('falls back to the payload agent over the pane status', async () => {
    expect(await publishWith({ terminalHandle: 't-1' }, 'Payload')).toMatchObject({
      agentName: 'Payload'
    })
  })

  it('uses the pane agent status when no name is given', async () => {
    expect(await publishWith({ terminalHandle: 't-1' })).toMatchObject({
      agentName: 'Pi',
      paneKey: 'pane-1'
    })
  })

  it('defaults to "agent"', async () => {
    expect(await publishWith({})).toMatchObject({ agentName: 'agent' })
  })
})

describe('quickstart §2 payload', () => {
  it('publishes A1.1/A2.1/B1.1 with the two expected rejections', async () => {
    const { deps, replace } = createDeps()
    const outcome = await publishExplanation(
      'wt',
      {
        version: 1,
        changes: [
          {
            title: 'Retry policy',
            summary: '…',
            files: [
              {
                path: 'src/a.ts',
                items: [
                  { id: 'a1', startLine: 3, endLine: 6, text: 'Why A1.1' },
                  { startLine: 9999, text: 'bad' }
                ]
              },
              { path: 'src/b.ts', items: [{ text: 'file-level note' }] }
            ]
          },
          {
            title: 'Settings toggle',
            summary: '…',
            files: [
              { path: 'src/a.ts', items: [{ side: 'old', startLine: 2, text: 'Removed code' }] },
              { path: 'not/changed.ts', items: [{ startLine: 1, text: 'x' }] }
            ]
          }
        ]
      },
      {},
      deps
    )
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) {
      return
    }
    expect(outcome.result.published).toBe(true)
    // Only the item with a client id appears in the response label map.
    expect(outcome.result.labels).toEqual([{ id: 'a1', label: 'A1.1' }])
    // A2.1 and B1.1 are the labels of the other surviving items in the stored set.
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: test double only needs the members the code under test reads.
    const [, set] = replace.mock.calls[0] as [string, ExplanationSet]
    expect(buildGlobalOrder(set).map((entry) => entry.label)).toEqual(['A1.1', 'A2.1', 'B1.1'])
    expect(outcome.result.rejected.map((issue) => issue.code)).toEqual([
      'line_out_of_range',
      'file_not_in_change_set'
    ])
    expect(outcome.result.rejected[1]?.changeIndex).toBe(1)
  })
})

describe('unborn repo', () => {
  it('rejects side old as unavailable when no commit exists', async () => {
    const unborn = snapshot({
      base: { kind: 'uncommitted-only', baseRef: null, mergeBase: 'e'.repeat(40), headOid: null },
      files: [{ path: 'src/new.ts', status: 'added' }]
    })
    const { deps } = createDeps({ snap: unborn, diffs: {} })
    const outcome = await publishExplanation(
      'wt',
      {
        version: 1,
        changes: [
          {
            title: 't',
            summary: '',
            files: [{ path: 'src/new.ts', items: [item({ side: 'old' })] }]
          }
        ]
      },
      {},
      deps
    )
    expect(outcome.ok).toBe(true)
    if (outcome.ok) {
      expect(outcome.result.rejected[0]?.code).toBe('side_unavailable')
    }
  })
})

describe('performance', () => {
  it('validates 50 files with 500 items in under 2 s', async () => {
    const paths = Array.from({ length: 50 }, (_, i) => `src/f${i}.ts`)
    const files: ChangeSetFile[] = paths.map((path) => ({ path, status: 'modified' }))
    const diffs: Record<string, GitDiffResult> = {}
    for (const path of paths) {
      diffs[path] = textDiff(
        'l1\nl2\nl3\nl4\nl5\nl6\nl7\nl8\nl9\nl10\n',
        'l1\nL2\nl3\nl4\nl5\nl6\nl7\nl8\nl9\nl10\n'
      )
    }
    const { deps } = createDeps({ snap: snapshot({ files }), diffs })
    const payload = {
      version: 1,
      changes: [
        {
          title: 'bulk',
          summary: '',
          files: paths.map((path) => ({
            path,
            items: Array.from({ length: 10 }, (_, i) => item({ startLine: i + 1 }))
          }))
        }
      ]
    }
    const started = Date.now()
    const outcome = await publishExplanation('wt', payload, {}, deps)
    const elapsed = Date.now() - started
    expect(outcome.ok).toBe(true)
    if (outcome.ok) {
      expect(outcome.result.counts.items).toBe(500)
    }
    expect(elapsed).toBeLessThan(2000)
  })
})

function snapBase(): ExplanationChangeSetSnapshot['base'] {
  return snapshot().base
}
