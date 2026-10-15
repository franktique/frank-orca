import { useAppStore } from '@/store'
import ResultFooter from './ResultFooter'
import {
  CancelledResultState,
  CommandResultState,
  EmptyResultState,
  ErrorResultState,
  RunningResultState
} from './ResultStates'
import SqlResultsGrid from './SqlResultsGrid'

/** Switches the results area between the empty, running, error, command and row states. */
export default function SqlResults({ tabId }: { tabId: string }): React.JSX.Element {
  const run = useAppStore((state) => state.sqlRunByTab[tabId])
  const cancel = useAppStore((state) => state.cancelSqlTabRun)

  if (run?.state === 'running') {
    return <RunningResultState startedAt={run.startedAt} onCancel={() => void cancel(tabId)} />
  }
  if (run?.state !== 'done') {
    return <EmptyResultState />
  }
  const { result } = run
  switch (result.kind) {
    case 'rows':
      return (
        <div className="flex h-full min-h-0 flex-col">
          <div className="min-h-0 flex-1">
            {/* Keyed by the result so column widths and selection reset with every run. */}
            <SqlResultsGrid key={run.runId} columns={result.columns} rows={result.rows} />
          </div>
          <ResultFooter
            count={result.rowCount}
            countLabel="rows"
            elapsedMs={result.elapsedMs}
            rowCapApplied={result.rowCapApplied}
            sizeLimitReached={result.sizeLimitReached}
          />
        </div>
      )
    case 'command':
      return (
        <div className="flex h-full min-h-0 flex-col">
          <div className="min-h-0 flex-1">
            <CommandResultState command={result.command} affectedRows={result.affectedRows} />
          </div>
          {result.affectedRows !== null ? (
            <ResultFooter
              count={result.affectedRows}
              countLabel="affected"
              elapsedMs={result.elapsedMs}
            />
          ) : null}
        </div>
      )
    case 'error':
      return <ErrorResultState error={result.error} />
    case 'cancelled':
      return <CancelledResultState />
    case 'timed-out':
      return <CancelledResultState />
  }
}
