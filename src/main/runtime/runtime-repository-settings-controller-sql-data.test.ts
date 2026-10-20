import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Repo } from '../../shared/repo-types'

const { deleteProjectSqlDataMock } = vi.hoisted(() => ({ deleteProjectSqlDataMock: vi.fn() }))

vi.mock('../sql-client/sql-client-data-deletion', () => ({
  deleteProjectSqlData: deleteProjectSqlDataMock
}))
vi.mock('../ipc/filesystem-auth', () => ({ invalidateAuthorizedRootsCache: vi.fn() }))

import { RuntimeRepositorySettingsController } from './runtime-repository-settings-controller'
import type { RuntimeStore } from './runtime-store-contract'

const repo = (connectionId?: string): Repo => ({
  id: 'repo-1',
  path: '/work/repo-1',
  displayName: 'repo-1',
  badgeColor: '#000',
  addedAt: 0,
  ...(connectionId ? { connectionId } : {})
})

function createController(repos: Repo[]) {
  const removeProject = vi.fn()
  const removeProjectForHost = vi.fn()
  const store = { getRepos: () => repos, removeProject, removeProjectForHost }
  const controller = new RuntimeRepositorySettingsController({
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the controller only reads getRepos and calls the two remove methods in this path.
    getStore: () => store as unknown as RuntimeStore,
    resolveRepo: async () => repos[0],
    forgetTerminalTopology: vi.fn(),
    invalidateResolvedWorktrees: vi.fn(),
    invalidateWorktreeScan: vi.fn(),
    notifyReposChanged: vi.fn()
  })
  return { controller, removeProject, removeProjectForHost }
}

beforeEach(() => deleteProjectSqlDataMock.mockReset())

describe('RuntimeRepositorySettingsController.remove', () => {
  it('deletes the project SQL data when the project is removed everywhere', async () => {
    const { controller, removeProject } = createController([repo()])

    await controller.remove('repo-1')

    expect(removeProject).toHaveBeenCalledWith('repo-1')
    expect(deleteProjectSqlDataMock).toHaveBeenCalledWith('repo:repo-1')
  })

  it('keeps the SQL data when only one host forgets a repo another host still has', async () => {
    const { controller, removeProjectForHost } = createController([repo(), repo('ssh-target')])

    await controller.remove('repo-1')

    expect(removeProjectForHost).toHaveBeenCalled()
    expect(deleteProjectSqlDataMock).not.toHaveBeenCalled()
  })
})
