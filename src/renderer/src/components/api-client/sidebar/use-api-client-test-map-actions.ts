import { useCallback, useState } from 'react'
import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import type { TestMapLoadWarnings } from '../../../../../preload/api/test-run-api'
import type { TestMapIssue } from '../../../../../shared/test-orchestrator/test-orchestrator-types'
import { describeApiClientFailure } from './use-api-client-tree-actions'

export type TestMapDialogState =
  | { phase: 'closed' }
  | { phase: 'replace'; collectionId: string; filePath: string }
  | { phase: 'invalid'; message: string; issues: TestMapIssue[] }
  | { phase: 'warnings'; warnings: TestMapLoadWarnings }
  | { phase: 'remove'; collectionId: string; name: string }

function hasWarnings(warnings: TestMapLoadWarnings): boolean {
  return (
    warnings.unmatched.length > 0 ||
    warnings.ambiguous.length > 0 ||
    warnings.unknownFields.length > 0
  )
}

export function useApiClientTestMapActions(worktreeId: string): {
  state: TestMapDialogState
  load: (collectionId: string) => Promise<void>
  confirmReplace: () => Promise<void>
  exportMap: (collectionId: string) => Promise<void>
  askRemove: (collectionId: string, name: string) => void
  confirmRemove: () => Promise<void>
  close: () => void
} {
  const loadMap = useAppStore((store) => store.loadApiClientTestMap)
  const [state, setState] = useState<TestMapDialogState>({ phase: 'closed' })

  const runLoad = useCallback(
    async (collectionId: string, filePath: string, replace: boolean): Promise<void> => {
      const result = await window.api.testRun.loadTestMap({
        worktreeId,
        collectionId,
        filePath,
        ...(replace ? { replace } : {})
      })
      if (result.ok) {
        void loadMap(worktreeId, collectionId)
        if (hasWarnings(result.warnings)) {
          setState({ phase: 'warnings', warnings: result.warnings })
        } else {
          setState({ phase: 'closed' })
          toast.success(translate('apiClient.testMap.loaded', 'Test map loaded.'))
        }
      } else if (result.code === 'conflict') {
        setState({ phase: 'replace', collectionId, filePath })
      } else if (result.code === 'invalid-test-map') {
        setState({ phase: 'invalid', message: result.message, issues: result.issues ?? [] })
      } else {
        setState({ phase: 'closed' })
        toast.error(describeApiClientFailure(result))
      }
    },
    [loadMap, worktreeId]
  )

  const load = useCallback(
    async (collectionId: string): Promise<void> => {
      const picked = await window.api.testRun.pickTestMapFile()
      if (picked) {
        await runLoad(collectionId, picked.filePath, false)
      }
    },
    [runLoad]
  )

  const confirmReplace = useCallback(async (): Promise<void> => {
    if (state.phase === 'replace') {
      await runLoad(state.collectionId, state.filePath, true)
    }
  }, [runLoad, state])

  const exportMap = useCallback(
    async (collectionId: string): Promise<void> => {
      const target = { worktreeId, collectionId }
      const picked = await window.api.testRun.pickExportFile(target)
      if (!picked) {
        return
      }
      const result = await window.api.testRun.exportTestMap({ ...target, ...picked })
      if (result.ok) {
        toast.success(translate('apiClient.testMap.exported', 'Test map exported.'))
      } else {
        toast.error(describeApiClientFailure(result))
      }
    },
    [worktreeId]
  )

  const confirmRemove = useCallback(async (): Promise<void> => {
    if (state.phase !== 'remove') {
      return
    }
    const { collectionId } = state
    setState({ phase: 'closed' })
    const result = await window.api.testRun.removeTestMap({ worktreeId, collectionId })
    if (result.ok) {
      void loadMap(worktreeId, collectionId)
    } else {
      toast.error(describeApiClientFailure(result))
    }
  }, [loadMap, state, worktreeId])

  return {
    state,
    load,
    confirmReplace,
    exportMap,
    askRemove: (collectionId, name) => setState({ phase: 'remove', collectionId, name }),
    confirmRemove,
    close: () => setState({ phase: 'closed' })
  }
}
