import { describe, expect, it } from 'vitest'
import { FLOATING_TERMINAL_WORKTREE_ID } from '../../../shared/constants'
import { createTestStore } from '@/store/slices/store-test-helpers'
import { getApiClientAvailability } from './api-client-availability'

const LOCAL_ID = 'repo-local::/work/local'
const SSH_ID = 'repo-ssh::/work/remote'

function seed() {
  const store = createTestStore()
  store.setState({
    repos: [
      {
        id: 'repo-local',
        path: '/work/local',
        displayName: 'Local',
        badgeColor: '#000',
        addedAt: 0
      },
      {
        id: 'repo-ssh',
        path: '/work/remote',
        displayName: 'Remote',
        badgeColor: '#000',
        addedAt: 0,
        connectionId: 'ssh-target'
      }
    ]
  })
  return store.getState()
}

describe('getApiClientAvailability', () => {
  it('is available for a local worktree', () => {
    expect(getApiClientAvailability(seed(), LOCAL_ID)).toBe('available')
  })

  it('is remote (visible but disabled) for an SSH-backed worktree', () => {
    expect(getApiClientAvailability(seed(), SSH_ID)).toBe('remote')
  })

  it('is hidden without a workspace and in the floating terminal', () => {
    expect(getApiClientAvailability(seed(), null)).toBe('hidden')
    expect(getApiClientAvailability(seed(), FLOATING_TERMINAL_WORKTREE_ID)).toBe('hidden')
  })
})
