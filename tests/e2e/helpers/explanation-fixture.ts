/**
 * Fixtures for the agent-explanations specs: a throwaway git repo shaped like a feature branch
 * (committed edits, uncommitted edits, a rename, a deletion, a binary), and a driver for the
 * dev `orca explain` CLI that can pipe a payload on stdin.
 */

import { execFile, execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const git = (cwd: string, ...args: string[]): void => {
  execFileSync('git', args, { cwd, stdio: 'pipe' })
}

function numberedLines(prefix: string, count: number): string {
  return `${Array.from({ length: count }, (_, i) => `${prefix} line ${i + 1}`).join('\n')}\n`
}

export type ExplanationRepo = {
  repoPath: string
  dispose: () => void
}

/**
 * `main` holds the base; `feature` commits an edit to src/a.ts; the working tree then edits
 * src/b.ts, renames src/old-name.ts, deletes src/gone.ts and rewrites assets/logo.bin.
 */
export function createExplanationRepo(
  options: { onDefaultBranch?: boolean } = {}
): ExplanationRepo {
  const repoPath = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'orca-e2e-explain-')))
  git(repoPath, 'init', '-b', 'main')
  git(repoPath, 'config', 'user.email', 'e2e@test.local')
  git(repoPath, 'config', 'user.name', 'E2E Test')
  mkdirSync(path.join(repoPath, 'src'))
  mkdirSync(path.join(repoPath, 'assets'))
  writeFileSync(path.join(repoPath, 'src', 'a.ts'), numberedLines('a', 12))
  writeFileSync(path.join(repoPath, 'src', 'b.ts'), numberedLines('b', 8))
  writeFileSync(path.join(repoPath, 'src', 'c.ts'), numberedLines('c', 5))
  writeFileSync(path.join(repoPath, 'src', 'old-name.ts'), numberedLines('renamed', 6))
  writeFileSync(path.join(repoPath, 'src', 'gone.ts'), numberedLines('gone', 4))
  writeFileSync(path.join(repoPath, 'assets', 'logo.bin'), Buffer.from([0, 1, 2, 3, 0, 255]))
  git(repoPath, 'add', '-A')
  git(repoPath, 'commit', '-m', 'base')

  if (!options.onDefaultBranch) {
    git(repoPath, 'checkout', '-b', 'feature')
    writeFileSync(
      path.join(repoPath, 'src', 'a.ts'),
      numberedLines('a', 12).replace('a line 3\n', 'a line 3 (committed edit)\n')
    )
    git(repoPath, 'commit', '-am', 'feature edit')
  }

  // Uncommitted edits: working tree only.
  writeFileSync(
    path.join(repoPath, 'src', 'a.ts'),
    numberedLines('a', 12)
      .replace('a line 3\n', 'a line 3 (committed edit)\n')
      .replace('a line 9\n', 'a line 9 (uncommitted edit)\n')
      .replace('a line 2\n', '')
  )
  writeFileSync(
    path.join(repoPath, 'src', 'b.ts'),
    numberedLines('b', 8).replace('b line 4\n', 'b line 4 (edited)\n')
  )
  git(repoPath, 'mv', 'src/old-name.ts', 'src/new-name.ts')
  rmSync(path.join(repoPath, 'src', 'gone.ts'))
  writeFileSync(path.join(repoPath, 'assets', 'logo.bin'), Buffer.from([9, 8, 7, 0, 255, 1]))

  return { repoPath, dispose: () => rmSync(repoPath, { recursive: true, force: true }) }
}

export type CliRun = { code: number; stdout: string; stderr: string }

/** Runs the dev CLI against the app launched with this userData dir. */
export function runOrcaCli(userDataDir: string, args: string[], stdin?: string): Promise<CliRun> {
  return new Promise((resolve) => {
    const child = execFile(
      process.execPath,
      [path.join(process.cwd(), 'config', 'scripts', 'orca-dev.mjs'), ...args],
      { cwd: process.cwd(), env: { ...process.env, ORCA_DEV_USER_DATA_PATH: userDataDir } },
      (error, stdout, stderr) => {
        const code = error && typeof error.code === 'number' ? error.code : error ? 1 : 0
        resolve({ code, stdout: String(stdout), stderr: String(stderr) })
      }
    )
    child.stdin?.end(stdin ?? '')
  })
}

/** Two changes over the fixture repo; one item per quickstart §2 scenario. */
export function twoChangePayload(): string {
  return JSON.stringify({
    version: 1,
    agent: 'e2e-agent',
    changes: [
      {
        title: 'Retry policy',
        summary: 'Retries with **backoff**.',
        files: [
          {
            path: 'src/a.ts',
            items: [
              { id: 'a1', startLine: 8, endLine: 8, text: 'Why **A1.1**: the uncommitted tweak.' },
              { id: 'bad', startLine: 9999, text: 'Out of range.' }
            ]
          },
          { path: 'src/b.ts', items: [{ id: 'b-file', text: 'File-level note.' }] },
          { path: 'assets/logo.bin', items: [{ id: 'bin', text: 'The logo was regenerated.' }] }
        ]
      },
      {
        title: 'Settings toggle',
        summary: 'A second theme.',
        files: [
          {
            path: 'src/a.ts',
            items: [{ id: 'b1', side: 'old', startLine: 2, text: 'Removed line two.' }]
          },
          { path: 'not/changed.ts', items: [{ startLine: 1, text: 'Not in the change set.' }] }
        ]
      }
    ]
  })
}
