import { useEffect, useMemo } from 'react'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import type { RunScope } from '../../../../../shared/api-client/api-client-types'
import {
  findNode,
  flattenFolderPath,
  flattenRequestsDepthFirst
} from '../../../../../shared/api-client/collection-tree'
import { runnerScopeKey } from '@/store/slices/api-client-runner'
import RunnerResults from './RunnerResults'
import RunnerSetup, { type RunnerRequestRow } from './RunnerSetup'
import RunSummary from './RunSummary'

export default function RunnerView({
  worktreeId,
  scope
}: {
  worktreeId: string
  scope: RunScope
}): React.JSX.Element {
  const snapshot = useAppStore((state) => state.apiClientSnapshotsByWorktree[worktreeId])
  const scopeKey = runnerScopeKey(worktreeId, scope)
  const state = useAppStore((current) => current.apiClientRunnerByScope[scopeKey])
  const load = useAppStore((current) => current.loadApiClientRun)
  const update = useAppStore((current) => current.updateApiClientRunnerSetup)
  const setFilter = useAppStore((current) => current.setApiClientRunnerFilter)
  const start = useAppStore((current) => current.startApiClientRun)
  const stop = useAppStore((current) => current.stopApiClientRun)
  const clear = useAppStore((current) => current.clearApiClientRun)
  const activeEnvironmentId = snapshot?.activeEnvironmentId ?? null

  useEffect(() => {
    void load(worktreeId, scope)
  }, [load, scope, worktreeId])

  const collection = snapshot?.collections.find((candidate) => candidate.id === scope.collectionId)
  const requests = useMemo<RunnerRequestRow[]>(() => {
    if (!collection) {
      return []
    }
    const folderNode = scope.folderId ? findNode(collection, scope.folderId)?.node : undefined
    const container = folderNode?.kind === 'folder' ? folderNode : collection
    return flattenRequestsDepthFirst(container).map((request) => ({
      id: request.id,
      name: request.name,
      method: request.method,
      folderPath: (flattenFolderPath(collection, request.id)?.folderPath ?? []).slice(
        scope.folderId
          ? (flattenFolderPath(collection, scope.folderId)?.folderPath.length ?? 0) + 1
          : 0
      )
    }))
  }, [collection, scope.folderId])

  if (!collection) {
    return (
      <div className="flex flex-1 items-center justify-center p-6 text-sm text-muted-foreground">
        {translate('apiClient.runner.missing', 'This collection no longer exists.')}
      </div>
    )
  }
  const setup = state?.setup ?? {
    excluded: {},
    iterations: 1,
    delayMs: 0,
    stopOnFailure: false,
    environmentId: activeEnvironmentId
  }
  const run = state?.run ?? null
  const running = state?.running ?? false

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-3">
      <RunnerSetup
        requests={requests}
        environments={snapshot?.environments ?? []}
        setup={setup}
        running={running}
        onChange={(patch) => update(worktreeId, scope, patch)}
        onRun={() =>
          void start(
            worktreeId,
            scope,
            requests.filter((request) => !setup.excluded[request.id]).map((request) => request.id)
          )
        }
      />
      {run ? (
        <>
          <RunnerResults
            results={run.results}
            filter={state?.filter ?? 'all'}
            running={running}
            onFilterChange={(filter) => setFilter(worktreeId, scope, filter)}
            onStop={() => void stop(worktreeId, scope)}
          />
          {run.state !== 'running' ? (
            <RunSummary run={run} onClear={() => void clear(worktreeId, scope)} />
          ) : null}
        </>
      ) : null}
    </div>
  )
}
