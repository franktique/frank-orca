// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest'
import type { GitStatusEntry } from '../../../../../shared/git-status-types'
import { resolveExplanationNoteScope } from './explanation-review-note-scope'

function entry(path: string, area: GitStatusEntry['area']): GitStatusEntry {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: test double only needs the members the code under test reads.
  return { path, area, status: 'modified' } as GitStatusEntry
}

describe('resolveExplanationNoteScope', () => {
  it("uses 'unstaged' while the working tree differs from the index", () => {
    expect(resolveExplanationNoteScope([entry('a.ts', 'unstaged')], 'a.ts')).toBe('unstaged')
    expect(resolveExplanationNoteScope([entry('a.ts', 'untracked')], 'a.ts')).toBe('unstaged')
    // Staged and unstaged edits to the same file: Source Control still has an unstaged diff.
    expect(
      resolveExplanationNoteScope([entry('a.ts', 'staged'), entry('a.ts', 'unstaged')], 'a.ts')
    ).toBe('unstaged')
  })

  it("uses 'staged' when everything is staged", () => {
    expect(resolveExplanationNoteScope([entry('a.ts', 'staged')], 'a.ts')).toBe('staged')
  })

  it("uses 'branch' when the file is only changed by commits", () => {
    expect(resolveExplanationNoteScope([], 'a.ts')).toBe('branch')
    expect(resolveExplanationNoteScope(undefined, 'a.ts')).toBe('branch')
    expect(resolveExplanationNoteScope([entry('other.ts', 'unstaged')], 'a.ts')).toBe('branch')
  })
})
