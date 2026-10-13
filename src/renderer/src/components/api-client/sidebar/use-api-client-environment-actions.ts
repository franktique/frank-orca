import { toast } from 'sonner'
import { useAppStore } from '@/store'
import { describeApiClientFailure } from './use-api-client-tree-actions'

export type ApiClientEnvironmentActions = {
  create: () => Promise<string | null>
  rename: (id: string, name: string) => Promise<boolean>
  duplicate: (id: string) => Promise<string | null>
  remove: (id: string) => Promise<boolean>
  setActive: (id: string | null) => Promise<void>
}

export function useApiClientEnvironmentActions(worktreeId: string): ApiClientEnvironmentActions {
  const setActive = useAppStore((state) => state.setApiClientActiveEnvironment)
  const api = window.api.apiClient

  const run = async (call: () => ReturnType<typeof api.envOp>): Promise<{ id?: string } | null> => {
    const result = await call()
    if (!result.ok) {
      toast.error(describeApiClientFailure(result))
      return null
    }
    return result
  }

  return {
    create: async () => (await run(() => api.envOp({ worktreeId, op: 'create' })))?.id ?? null,
    rename: async (id, name) =>
      (await run(() => api.envOp({ worktreeId, op: 'rename', id, name }))) !== null,
    duplicate: async (id) =>
      (await run(() => api.envOp({ worktreeId, op: 'duplicate', id })))?.id ?? null,
    remove: async (id) => (await run(() => api.envOp({ worktreeId, op: 'delete', id }))) !== null,
    setActive: (id) => setActive(worktreeId, id)
  }
}
