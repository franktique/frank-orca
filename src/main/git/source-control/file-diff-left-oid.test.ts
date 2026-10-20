import { execFileSync } from 'node:child_process'
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { invalidateGitReadCaches } from './git-read-cache-invalidation'
import { getDiff } from './file-diff'

const tempRoots: string[] = []

function git(repo: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd: repo,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim()
}

async function write(repo: string, relativePath: string, contents: string): Promise<void> {
  const target = path.join(repo, relativePath)
  await mkdir(path.dirname(target), { recursive: true })
  await writeFile(target, contents)
}

beforeEach(() => {
  invalidateGitReadCaches()
})

afterEach(async () => {
  invalidateGitReadCaches()
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('getDiff with leftOid', () => {
  it('reads the left side from the given commit instead of HEAD or the index', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'orca-file-diff-left-oid-'))
    tempRoots.push(root)
    const repo = path.join(root, 'repo')
    execFileSync('git', ['init', '-q', repo])
    git(repo, ['config', 'user.email', 'test@example.com'])
    git(repo, ['config', 'user.name', 'Test'])
    git(repo, ['config', 'commit.gpgSign', 'false'])

    await write(repo, 'a.txt', 'base line\n')
    git(repo, ['add', '-A'])
    git(repo, ['commit', '-q', '-m', 'base'])
    const mergeBase = git(repo, ['rev-parse', 'HEAD'])

    await write(repo, 'a.txt', 'base line\nbranch line\n')
    git(repo, ['add', '-A'])
    git(repo, ['commit', '-q', '-m', 'branch commit'])
    const head = git(repo, ['rev-parse', 'HEAD'])

    await write(repo, 'a.txt', 'base line\nbranch line\nuncommitted line\n')

    const result = await getDiff(repo, 'a.txt', false, false, {}, mergeBase)
    expect(result.kind).toBe('text')
    if (result.kind !== 'text') {
      return
    }
    // Left side is the merge-base blob, so the branch commit's line still appears.
    expect(result.originalContent).toBe('base line\n')
    expect(result.modifiedContent).toContain('uncommitted line')

    // compareAgainstHead equivalence: leftOid = HEAD behaves like left = HEAD.
    const headResult = await getDiff(repo, 'a.txt', false, false, {}, head)
    expect(headResult.kind).toBe('text')
    if (headResult.kind !== 'text') {
      return
    }
    expect(headResult.originalContent).toBe('base line\nbranch line\n')
  })

  it('defaults to the unstaged left read when leftOid is omitted', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'orca-file-diff-left-oid-'))
    tempRoots.push(root)
    const repo = path.join(root, 'repo')
    execFileSync('git', ['init', '-q', repo])
    git(repo, ['config', 'user.email', 'test@example.com'])
    git(repo, ['config', 'user.name', 'Test'])
    git(repo, ['config', 'commit.gpgSign', 'false'])

    await write(repo, 'a.txt', 'committed\n')
    git(repo, ['add', '-A'])
    git(repo, ['commit', '-q', '-m', 'base'])
    await write(repo, 'a.txt', 'committed\nstaged edit\n')
    git(repo, ['add', '-A'])
    await write(repo, 'a.txt', 'committed\nstaged edit\nworking tree edit\n')

    const unstaged = await getDiff(repo, 'a.txt', false)
    expect(unstaged.kind).toBe('text')
    if (unstaged.kind !== 'text') {
      return
    }
    expect(unstaged.originalContent).toBe('committed\nstaged edit\n')
  })
})
