import { describe, expect, it, vi } from 'vitest'
import type {
  GitBranchCompareResult,
  GitBranchCompareSummary
} from '../../shared/git-diff-compare-types'
import type { GitStatusResult } from '../../shared/git-status-types'
import type { WorktreeMeta } from '../../shared/worktree/meta-types'
import type { RuntimeGitTarget } from '../runtime/runtime-git-command-target'
import {
  NOT_GIT_WORKSPACE_ERROR,
  buildExplanationChangeSet,
  type ExplanationChangeSetDeps
} from './explanation-change-set'

const HEAD = 'a'.repeat(40)
const MERGE_BASE = 'b'.repeat(40)

// Why: `satisfies Partial<…>` keeps fixture field names checked against the real
// worktree shape while letting the fixture omit fields these tests never read.
function makeTarget(
  head: string,
  repoId = 'repo-1',
  repo: { worktreeBaseRef?: string } | null = { worktreeBaseRef: 'origin/main' }
): RuntimeGitTarget {
  const worktree = {
    id: 'wt-1',
    repoId,
    path: '/repo/wt',
    git: { path: '/repo/wt', head, branch: 'feature', isBare: false, isMainWorktree: false }
  } satisfies Partial<RuntimeGitTarget['worktree']>
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: test double only needs the members the code under test reads.
  return {
    worktree,
    ...(repo ? { repo: { id: repoId, path: '/repo', ...repo } } : {})
  } as unknown as RuntimeGitTarget
}

function makeMeta(baseRef: string): WorktreeMeta {
  const meta = {
    displayName: 'wt',
    comment: '',
    linkedIssue: null,
    linkedPR: null,
    linkedLinearIssue: null,
    isArchived: false,
    isUnread: false,
    isPinned: false,
    sortOrder: 0,
    lastActivityAt: 0,
    baseRef
  } satisfies Partial<WorktreeMeta>
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: test double only needs the members the code under test reads.
  return meta as unknown as WorktreeMeta
}

function readySummary(overrides: Partial<GitBranchCompareSummary> = {}): GitBranchCompareSummary {
  return {
    baseRef: 'origin/main',
    baseOid: 'c'.repeat(40),
    compareRef: 'feature',
    headOid: HEAD,
    mergeBase: MERGE_BASE,
    changedFiles: 0,
    status: 'ready',
    ...overrides
  }
}

function createDeps(options: {
  target?: RuntimeGitTarget
  branchCompare?: GitBranchCompareResult
  status?: GitStatusResult
  meta?: WorktreeMeta
  emptyTreeOid?: string
}): ExplanationChangeSetDeps {
  return {
    resolveTarget: vi.fn(async () => options.target ?? makeTarget(HEAD)),
    branchCompare: vi.fn(
      async () => options.branchCompare ?? { summary: readySummary(), entries: [] }
    ),
    status: vi.fn(
      async (): Promise<GitStatusResult> =>
        options.status ?? { entries: [], conflictOperation: 'unknown' }
    ),
    worktreeMeta: vi.fn(() => options.meta),
    emptyTreeOid: vi.fn(async () => options.emptyTreeOid ?? 'e'.repeat(40))
  }
}

describe('buildExplanationChangeSet', () => {
  it('unions branch-compare and uncommitted entries keyed by current path', async () => {
    const deps = createDeps({
      branchCompare: {
        summary: readySummary(),
        entries: [
          { path: 'src/branch-only.ts', status: 'added' },
          { path: 'src/both.ts', status: 'modified' }
        ]
      },
      status: {
        entries: [
          { path: 'src/both.ts', status: 'modified', area: 'unstaged' },
          { path: 'src/untracked.ts', status: 'untracked', area: 'untracked' }
        ],
        conflictOperation: 'unknown'
      }
    })

    const snapshot = await buildExplanationChangeSet('wt-1', deps)

    expect(snapshot.base).toEqual({
      kind: 'branch-and-uncommitted',
      baseRef: 'origin/main',
      mergeBase: MERGE_BASE,
      headOid: HEAD
    })
    expect(snapshot.files).toEqual([
      { path: 'src/branch-only.ts', status: 'added' },
      { path: 'src/both.ts', status: 'modified' },
      { path: 'src/untracked.ts', status: 'added' }
    ])
  })

  it('keeps the committed status kind when a file is in both lists', async () => {
    const deps = createDeps({
      branchCompare: {
        summary: readySummary(),
        entries: [{ path: 'src/added-on-branch.ts', status: 'added' }]
      },
      status: {
        entries: [{ path: 'src/added-on-branch.ts', status: 'modified', area: 'unstaged' }],
        conflictOperation: 'unknown'
      }
    })

    const snapshot = await buildExplanationChangeSet('wt-1', deps)

    expect(snapshot.files).toEqual([{ path: 'src/added-on-branch.ts', status: 'added' }])
  })

  it('keeps oldPath for renames from either list', async () => {
    const deps = createDeps({
      branchCompare: {
        summary: readySummary(),
        entries: [{ path: 'src/renamed.ts', status: 'renamed', oldPath: 'src/original.ts' }]
      },
      status: {
        entries: [
          {
            path: 'src/working-renamed.ts',
            status: 'renamed',
            oldPath: 'src/working.ts',
            area: 'unstaged'
          }
        ],
        conflictOperation: 'unknown'
      }
    })

    const snapshot = await buildExplanationChangeSet('wt-1', deps)

    expect(snapshot.files).toEqual([
      { path: 'src/renamed.ts', oldPath: 'src/original.ts', status: 'renamed' },
      { path: 'src/working-renamed.ts', oldPath: 'src/working.ts', status: 'renamed' }
    ])
  })

  it.each(['invalid-base', 'no-merge-base'] as const)(
    'falls back to uncommitted-only on %s',
    async (status) => {
      const deps = createDeps({
        branchCompare: { summary: readySummary({ status }), entries: [] },
        status: {
          entries: [{ path: 'src/local.ts', status: 'modified', area: 'unstaged' }],
          conflictOperation: 'unknown',
          head: HEAD
        }
      })

      const snapshot = await buildExplanationChangeSet('wt-1', deps)

      expect(snapshot.base).toEqual({
        kind: 'uncommitted-only',
        baseRef: null,
        mergeBase: HEAD,
        headOid: HEAD
      })
      expect(snapshot.files).toEqual([{ path: 'src/local.ts', status: 'modified' }])
    }
  )

  it('falls back to uncommitted-only when no base ref resolves', async () => {
    const deps = createDeps({
      target: makeTarget(HEAD, 'repo-1', null),
      status: {
        entries: [{ path: 'src/local.ts', status: 'modified', area: 'unstaged' }],
        conflictOperation: 'unknown',
        head: HEAD
      }
    })

    const snapshot = await buildExplanationChangeSet('wt-1', deps)

    expect(snapshot.base).toEqual({
      kind: 'uncommitted-only',
      baseRef: null,
      mergeBase: HEAD,
      headOid: HEAD
    })
    expect(deps.branchCompare).not.toHaveBeenCalled()
  })

  it('prefers WorktreeMeta.baseRef over the repo pin and the repo default', async () => {
    const deps = createDeps({
      branchCompare: { summary: readySummary({ baseRef: 'meta-base' }), entries: [] },
      meta: makeMeta('meta-base')
    })

    await buildExplanationChangeSet('wt-1', deps)

    expect(deps.branchCompare).toHaveBeenCalledWith('wt-1', 'meta-base')
  })

  it('falls back to uncommitted-only when working directly on the base branch', async () => {
    const deps = createDeps({
      branchCompare: {
        summary: readySummary({ mergeBase: HEAD }),
        entries: []
      },
      status: {
        entries: [{ path: 'src/local.ts', status: 'modified', area: 'unstaged' }],
        conflictOperation: 'unknown',
        head: HEAD
      }
    })

    const snapshot = await buildExplanationChangeSet('wt-1', deps)

    expect(snapshot.base).toEqual({
      kind: 'uncommitted-only',
      baseRef: null,
      mergeBase: HEAD,
      headOid: HEAD
    })
    expect(snapshot.files).toEqual([{ path: 'src/local.ts', status: 'modified' }])
  })

  it('uses the empty tree as merge-base with every file added for an unborn repo', async () => {
    const emptyTree = 'e'.repeat(40)
    const deps = createDeps({
      target: makeTarget(''),
      emptyTreeOid: emptyTree,
      status: {
        entries: [
          { path: 'README.md', status: 'untracked', area: 'untracked' },
          { path: 'src/new.ts', status: 'added', area: 'staged' }
        ],
        conflictOperation: 'unknown'
      }
    })

    const snapshot = await buildExplanationChangeSet('wt-1', deps)

    expect(snapshot.base).toEqual({
      kind: 'uncommitted-only',
      baseRef: null,
      mergeBase: emptyTree,
      headOid: null
    })
    expect(snapshot.files).toEqual([
      { path: 'README.md', status: 'added' },
      { path: 'src/new.ts', status: 'added' }
    ])
    expect(deps.branchCompare).not.toHaveBeenCalled()
  })

  it('treats a branchCompare unborn-head summary the same as an empty head', async () => {
    const deps = createDeps({
      branchCompare: {
        summary: readySummary({ status: 'unborn-head', headOid: null, mergeBase: null }),
        entries: []
      },
      status: {
        entries: [{ path: 'README.md', status: 'untracked', area: 'untracked' }],
        conflictOperation: 'unknown'
      }
    })

    const snapshot = await buildExplanationChangeSet('wt-1', deps)

    expect(snapshot.base).toEqual({
      kind: 'uncommitted-only',
      baseRef: null,
      mergeBase: 'e'.repeat(40),
      headOid: null
    })
    expect(snapshot.files).toEqual([{ path: 'README.md', status: 'added' }])
  })

  it('refuses a folder workspace with not_git_workspace', async () => {
    const deps = createDeps({ target: makeTarget('', 'folder-workspace:group-1') })

    await expect(buildExplanationChangeSet('wt-1', deps)).rejects.toThrow(NOT_GIT_WORKSPACE_ERROR)
    expect(deps.status).not.toHaveBeenCalled()
  })
})
