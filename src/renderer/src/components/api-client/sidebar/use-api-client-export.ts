import { useCallback, useState } from 'react'
import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { describeApiClientFailure } from './use-api-client-tree-actions'

type ExportTarget = { kind: 'collection' | 'environment'; id: string; name: string }

export type ExportDialogState =
  | { phase: 'closed' }
  | { phase: 'secrets-warning'; target: ExportTarget }
  | { phase: 'error'; message: string }

function safeFileName(name: string): string {
  return `${name.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'postman'}.json`
}

export function useApiClientExport(worktreeId: string): {
  state: ExportDialogState
  exportCollection: (collectionId: string) => Promise<void>
  exportEnvironment: (environmentId: string) => Promise<void>
  confirmSecretsExport: () => Promise<void>
  close: () => void
} {
  const snapshot = useAppStore((store) => store.apiClientSnapshotsByWorktree[worktreeId])
  const [state, setState] = useState<ExportDialogState>({ phase: 'closed' })

  const writeFile = useCallback(
    async (target: ExportTarget): Promise<void> => {
      const api = window.api.apiClient
      const filePath = await api.pickExportFile(safeFileName(target.name))
      if (!filePath) {
        return
      }
      const result = await api.exportFile({
        worktreeId,
        kind: target.kind,
        id: target.id,
        filePath
      })
      if (result.ok) {
        toast.success(translate('apiClient.export.success', 'Exported.'))
      } else {
        setState({ phase: 'error', message: describeApiClientFailure(result) })
      }
    },
    [worktreeId]
  )

  const exportCollection = useCallback(
    async (collectionId: string): Promise<void> => {
      const collection = snapshot?.collections.find((candidate) => candidate.id === collectionId)
      if (collection) {
        await writeFile({ kind: 'collection', id: collection.id, name: collection.name })
      }
    },
    [snapshot, writeFile]
  )

  const exportEnvironment = useCallback(
    async (environmentId: string): Promise<void> => {
      const environment = snapshot?.environments.find((candidate) => candidate.id === environmentId)
      if (!environment) {
        return
      }
      const target: ExportTarget = {
        kind: 'environment',
        id: environment.id,
        name: environment.name
      }
      // Why a warning first: Postman files hold secret values as plain text.
      if (environment.variables.some((variable) => variable.type === 'secret')) {
        setState({ phase: 'secrets-warning', target })
        return
      }
      await writeFile(target)
    },
    [snapshot, writeFile]
  )

  const confirmSecretsExport = useCallback(async (): Promise<void> => {
    if (state.phase !== 'secrets-warning') {
      return
    }
    const { target } = state
    setState({ phase: 'closed' })
    await writeFile(target)
  }, [state, writeFile])

  return {
    state,
    exportCollection,
    exportEnvironment,
    confirmSecretsExport,
    close: () => setState({ phase: 'closed' })
  }
}
