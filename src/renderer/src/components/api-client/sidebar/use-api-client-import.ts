import { useCallback, useState } from 'react'
import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import type { SecretProtection } from '../../../../../shared/api-client/api-client-types'
import { describeApiClientFailure } from './use-api-client-tree-actions'

export type ImportDialogState =
  | { phase: 'closed' }
  | { phase: 'working' }
  | { phase: 'duplicate'; filePath: string; message: string }
  | { phase: 'error'; message: string }
  | { phase: 'done'; warnings: string[]; secretProtection?: SecretProtection }

export function useApiClientImport(worktreeId: string): {
  state: ImportDialogState
  startImport: () => Promise<void>
  resolveDuplicate: (mode: 'replace' | 'keep-both') => Promise<void>
  close: () => void
} {
  const [state, setState] = useState<ImportDialogState>({ phase: 'closed' })

  const run = useCallback(
    async (filePath: string, onDuplicate?: 'replace' | 'keep-both'): Promise<void> => {
      setState({ phase: 'working' })
      const result = await window.api.apiClient.importFile({ worktreeId, filePath, onDuplicate })
      if (result.ok) {
        // Why a toast when clean: nothing to read, so no dialog to dismiss.
        if (result.warnings.length === 0 && !result.secretProtection) {
          setState({ phase: 'closed' })
          toast.success(translate('apiClient.import.success', 'Imported.'))
          return
        }
        setState({
          phase: 'done',
          warnings: [...new Set(result.warnings)],
          ...(result.secretProtection ? { secretProtection: result.secretProtection } : {})
        })
        return
      }
      if (result.code === 'duplicate-name') {
        setState({ phase: 'duplicate', filePath, message: result.message })
        return
      }
      setState({ phase: 'error', message: describeApiClientFailure(result) })
    },
    [worktreeId]
  )

  const startImport = useCallback(async (): Promise<void> => {
    const filePath = await window.api.apiClient.pickImportFile()
    if (filePath) {
      await run(filePath)
    }
  }, [run])

  const resolveDuplicate = useCallback(
    async (mode: 'replace' | 'keep-both'): Promise<void> => {
      if (state.phase === 'duplicate') {
        await run(state.filePath, mode)
      }
    },
    [run, state]
  )

  return { state, startImport, resolveDuplicate, close: () => setState({ phase: 'closed' }) }
}
