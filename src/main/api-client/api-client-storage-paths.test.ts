import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { getApiClientWorktreePaths, toSafeFileStem } from './api-client-storage-paths'

describe('test orchestrator storage paths', () => {
  const paths = getApiClientWorktreePaths('wt-1', '/data/api-client')
  const stem = toSafeFileStem('col/../1.x')

  it('places each file under its own directory in the worktree dir', () => {
    expect(paths.testMapFile('col/../1.x')).toBe(join(paths.dir, 'test-maps', `${stem}.json`))
    expect(paths.testPlanFile('col/../1.x')).toBe(join(paths.dir, 'test-plans', `${stem}.json`))
    expect(paths.testCapturesFile('col/../1.x')).toBe(
      join(paths.dir, 'test-captures', `${stem}.json`)
    )
    expect(paths.testRunFile('col/../1.x')).toBe(join(paths.dir, 'test-runs', `${stem}.json`))
  })

  it('never lets a collection id escape the directory', () => {
    expect(stem).not.toMatch(/[/\\.]/)
  })
})
