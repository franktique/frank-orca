/**
 * `orca sql` from a real process against the running app: no passwords, full access on loopback,
 * read-only on a LAN host, and timeouts that leave no backend behind (quickstart 21-23).
 */

import { execFile } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import type { ElectronApplication } from '@stablyai/playwright-test'
import { test, expect } from '../helpers/orca-app'
import { waitForSessionReady } from '../helpers/store'
import { attachRepoAndOpenTerminal, createRestartSession } from '../helpers/orca-restart'
import { TEST_REPO_PATH_FILE } from '../global-setup'
import { createScratchDatabase } from './scratch-database'

type CliResult = { code: number; stdout: string; stderr: string }

function runCli(args: string[], userDataDir: string, cwd: string): Promise<CliResult> {
  const cli = path.join(process.cwd(), 'out', 'cli', 'index.js')
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [cli, ...args],
      { cwd, env: { ...process.env, ORCA_USER_DATA_PATH: userDataDir }, timeout: 60_000 },
      (error, stdout, stderr) => {
        const code = error && typeof error.code === 'number' ? error.code : error ? 1 : 0
        resolve({ code, stdout, stderr })
      }
    )
  })
}

test('orca sql: connections, read-only agent access, and timeouts', async (// oxlint-disable-next-line no-empty-pattern -- Playwright's second fixture arg is testInfo; the first must be an object destructure to opt out of the default fixture set.
{}, testInfo) => {
  test.setTimeout(300_000)
  test.skip(!process.env.ORCA_TEST_PG_URL, 'ORCA_TEST_PG_URL is not set')
  const lanHost = process.env.ORCA_TEST_PG_LAN_HOST
  test.skip(!lanHost, 'ORCA_TEST_PG_LAN_HOST is not set')
  const repoPath = existsSync(TEST_REPO_PATH_FILE)
    ? readFileSync(TEST_REPO_PATH_FILE, 'utf-8').trim()
    : ''
  test.skip(!repoPath || !existsSync(repoPath), 'Global setup did not produce a seeded test repo')

  const db = await createScratchDatabase()
  const session = createRestartSession(testInfo)
  let app: ElectronApplication | null = null
  try {
    const launched = await session.launch()
    app = launched.app
    const page = launched.page
    await waitForSessionReady(page)
    const worktreeId = await attachRepoAndOpenTerminal(page, repoPath)

    await page.evaluate(
      async ({ id, base, lan }) => {
        for (const [name, host] of [
          ['local', base.host],
          ['lan', lan]
        ] as const) {
          const created = await window.api.sqlClient.createConnection({
            worktreeId: id,
            input: { ...base, name, host, sslMode: 'disable' }
          })
          if (!created.ok) {
            throw new Error(`createConnection ${name} failed`)
          }
        }
      },
      {
        id: worktreeId,
        lan: lanHost!,
        base: {
          host: db.host,
          port: db.port,
          user: db.user,
          database: db.database,
          password: db.password
        }
      }
    )

    const cli = (...args: string[]): Promise<CliResult> =>
      runCli(
        ['sql', ...args, '--worktree', `id:${worktreeId}`, '--json'],
        session.userDataDir,
        repoPath
      )

    // Scenario 21
    const listed = await cli('connections')
    expect(listed.code, listed.stderr).toBe(0)
    expect(listed.stdout).not.toContain(db.password)
    expect(listed.stdout).toContain('"full"')
    expect(listed.stdout).toContain('"read-only"')
    const created = await cli('run', '--connection', 'local', '--sql', 'create table cli_t(id int)')
    expect(created.code, created.stderr).toBe(0)
    const inserted = await cli(
      'run',
      '--connection',
      'local',
      '--sql',
      'insert into cli_t values (1),(2)'
    )
    expect(inserted.code, inserted.stderr).toBe(0)
    expect(await db.query('select count(*)::int as n from cli_t')).toEqual([{ n: 2 }])

    // Scenario 22
    const denied = await cli('run', '--connection', 'lan', '--sql', 'delete from cli_t')
    expect(denied.code).toBe(3)
    const read = await cli('run', '--connection', 'lan', '--sql', 'select * from cli_t')
    expect(read.code, read.stderr).toBe(0)
    const bypass = await cli(
      'run',
      '--connection',
      'lan',
      '--sql',
      'COMMIT; SET default_transaction_read_only=off; DELETE FROM cli_t'
    )
    expect(bypass.code).toBe(3)
    expect(await db.query('select count(*)::int as n from cli_t')).toEqual([{ n: 2 }])

    // Scenario 23
    const slow = await cli(
      'run',
      '--connection',
      'local',
      '--sql',
      'select pg_sleep(5)',
      '--timeout',
      '1'
    )
    expect(slow.code).toBe(4)
    expect(slow.stdout).toContain('timed-out')
    await expect
      .poll(
        async () =>
          (
            await db.query(
              `select count(*)::int as n from pg_stat_activity where datname = '${db.database}' and query like '%pg_sleep%' and pid <> pg_backend_pid()`
            )
          )[0]?.n
      )
      .toBe(0)
  } finally {
    if (app) {
      try {
        await session.close(app)
      } catch {
        // best-effort cleanup
      }
    }
    await session.dispose()
    await db.drop()
  }
})
