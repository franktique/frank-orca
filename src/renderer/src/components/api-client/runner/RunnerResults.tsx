import { useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Square } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { translate } from '@/i18n/i18n'
import type { RunRequestResult } from '../../../../../shared/api-client/api-client-types'
import type { RunnerFilter } from '@/store/slices/api-client-runner'
import { formatDuration } from '../response-viewer/response-formatting'
import RunResultDetail from './RunResultDetail'

const ROW_HEIGHT_PX = 32

type RunnerResultsProps = {
  results: readonly RunRequestResult[]
  filter: RunnerFilter
  running: boolean
  onFilterChange: (filter: RunnerFilter) => void
  onStop: () => void
}

const isPassing = (result: RunRequestResult): boolean =>
  !result.error && result.tests.every((test) => test.passed)

export default function RunnerResults({
  results,
  filter,
  running,
  onFilterChange,
  onStop
}: RunnerResultsProps): React.JSX.Element {
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const keyed = useMemo(
    () =>
      results.map((result, index) => ({
        result,
        key: `${result.iteration}:${result.requestId}:${index}`
      })),
    [results]
  )
  const visible = useMemo(
    () =>
      keyed.filter(({ result }) =>
        filter === 'all' ? true : filter === 'passed' ? isPassing(result) : !isPassing(result)
      ),
    [keyed, filter]
  )
  const virtualizer = useVirtualizer({
    count: visible.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT_PX,
    overscan: 10
  })
  const selected = keyed.find((entry) => entry.key === selectedKey)

  return (
    <section
      className="flex min-h-0 flex-1 flex-col gap-2"
      aria-label={translate('apiClient.runner.results', 'Results')}
    >
      <div className="flex items-center justify-between gap-2">
        <Tabs
          value={filter}
          onValueChange={(value) =>
            onFilterChange(value === 'passed' || value === 'failed' ? value : 'all')
          }
        >
          <TabsList>
            <TabsTrigger value="all">{translate('apiClient.runner.filterAll', 'All')}</TabsTrigger>
            <TabsTrigger value="passed">
              {translate('apiClient.runner.filterPassed', 'Passed')}
            </TabsTrigger>
            <TabsTrigger value="failed">
              {translate('apiClient.runner.filterFailed', 'Failed')}
            </TabsTrigger>
          </TabsList>
        </Tabs>
        {running ? (
          <Button variant="outline" size="sm" onClick={onStop}>
            <Square />
            {translate('apiClient.runner.stop', 'Stop')}
          </Button>
        ) : null}
      </div>
      <div ref={scrollRef} className="scrollbar-sleek min-h-0 flex-1 overflow-y-auto" role="list">
        <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((item) => {
            const { result, key } = visible[item.index]
            const passed = result.tests.filter((test) => test.passed).length
            return (
              <button
                key={key}
                type="button"
                role="listitem"
                data-selected={key === selectedKey ? 'true' : undefined}
                className="absolute left-0 flex w-full items-center gap-2 px-2 text-left text-xs hover:bg-accent data-[selected=true]:bg-accent"
                style={{ top: item.start, height: item.size }}
                onClick={() => setSelectedKey(key === selectedKey ? null : key)}
              >
                <Badge variant={isPassing(result) ? 'secondary' : 'destructive'}>
                  {result.status ?? translate('apiClient.runner.error', 'Error')}
                </Badge>
                <span className="min-w-0 flex-1 truncate">
                  {result.requestName}
                  {result.iteration > 1 || visible.some((entry) => entry.result.iteration > 1)
                    ? ` · #${result.iteration}`
                    : ''}
                </span>
                <span className="shrink-0 text-muted-foreground">
                  {translate('apiClient.runner.testsCount', '{{passed}}/{{total}} tests', {
                    passed,
                    total: result.tests.length
                  })}
                </span>
                <span className="shrink-0 text-muted-foreground">
                  {formatDuration(result.durationMs)}
                </span>
              </button>
            )
          })}
        </div>
      </div>
      {selected ? (
        <div className="scrollbar-sleek max-h-64 overflow-y-auto rounded-md border border-border p-3">
          <RunResultDetail result={selected.result} />
        </div>
      ) : null}
    </section>
  )
}
