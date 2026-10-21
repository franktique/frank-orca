import { useEffect, useRef } from 'react'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import { selectViewedRequest } from '@/store/slices/api-client-execution'
import ApiClientUnsavedDialog from './ApiClientUnsavedDialog'
import EnvironmentSelector from './EnvironmentSelector'
import ApiConsolePanel from './console/ApiConsolePanel'
import EnvironmentEditor from './environment-editor/EnvironmentEditor'
import RequestEditor from './request-editor/RequestEditor'
import RunnerView from './runner/RunnerView'
import ResponseViewer from './response-viewer/ResponseViewer'
import TestRunView from './test-run/TestRunView'

const MIN_SPLIT = 0.2
const MAX_SPLIT = 0.8

type ApiClientPaneProps = {
  tabId: string
  worktreeId: string
  isVisible: boolean
}

export default function ApiClientPane({
  tabId,
  worktreeId
}: ApiClientPaneProps): React.JSX.Element {
  const tab = useAppStore((state) => state.apiClientTabsById[tabId])
  const ensureTabState = useAppStore((state) => state.ensureApiClientTabState)
  const loadSnapshot = useAppStore((state) => state.loadApiClientSnapshot)
  const loadConsole = useAppStore((state) => state.loadApiClientConsole)
  const loadResult = useAppStore((state) => state.loadApiClientResult)
  const clearConsole = useAppStore((state) => state.clearApiClientConsole)
  const setLayout = useAppStore((state) => state.setApiClientTabLayout)
  const viewed = useAppStore((state) => selectViewedRequest(state, tabId))
  const entries = useAppStore((state) => state.apiClientConsoleByWorktree[worktreeId])
  const result = useAppStore((state) =>
    viewed ? state.apiClientResultsByWorktree[worktreeId]?.[viewed.id] : undefined
  )
  const regionRef = useRef<HTMLDivElement>(null)
  const viewedRequestId = viewed?.id

  useEffect(() => {
    ensureTabState(tabId, worktreeId)
    void loadSnapshot(worktreeId)
    void loadConsole(worktreeId)
  }, [ensureTabState, loadConsole, loadSnapshot, tabId, worktreeId])

  // The latest result belongs to the request, so it shows again whenever the request does (FR-003b).
  useEffect(() => {
    if (viewedRequestId) {
      void loadResult(worktreeId, viewedRequestId)
    }
  }, [loadResult, viewedRequestId, worktreeId])

  const splitRatio = tab?.splitRatio ?? 0.5

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col" data-api-client-tab-id={tabId}>
      <header className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <h2 className="truncate text-sm font-medium">
          {viewed?.name ?? translate('apiClient.tab.title', 'API Client')}
        </h2>
        <EnvironmentSelector worktreeId={worktreeId} />
      </header>

      <div ref={regionRef} className="flex min-h-0 flex-1 flex-col">
        {viewed ? (
          <>
            <div
              className="min-h-0 overflow-hidden"
              style={{ flexBasis: `${splitRatio * 100}%`, flexGrow: 0 }}
            >
              <RequestEditor
                key={viewed.id}
                tabId={tabId}
                worktreeId={worktreeId}
                request={viewed}
              />
            </div>
            <div
              role="separator"
              aria-orientation="horizontal"
              aria-label={translate('apiClient.pane.resizeSplit', 'Resize request and response')}
              className="group flex h-2 shrink-0 cursor-row-resize items-center"
              onMouseDown={(event) => {
                event.preventDefault()
                const region = regionRef.current?.getBoundingClientRect()
                if (!region) {
                  return
                }
                const onMove = (move: MouseEvent): void =>
                  setLayout(tabId, {
                    splitRatio: Math.min(
                      MAX_SPLIT,
                      Math.max(MIN_SPLIT, (move.clientY - region.top) / region.height)
                    )
                  })
                const onUp = (): void => {
                  window.removeEventListener('mousemove', onMove)
                  window.removeEventListener('mouseup', onUp)
                }
                window.addEventListener('mousemove', onMove)
                window.addEventListener('mouseup', onUp)
              }}
            >
              <div className="h-px w-full bg-border transition-colors group-hover:bg-ring/50" />
            </div>
            <div className="min-h-0 flex-1 overflow-hidden">
              <ResponseViewer result={result} />
            </div>
          </>
        ) : tab?.view.kind === 'runner' ? (
          <RunnerView worktreeId={worktreeId} scope={tab.view.scope} />
        ) : tab?.view.kind === 'test-run' ? (
          <TestRunView
            key={tab.view.collectionId}
            worktreeId={worktreeId}
            collectionId={tab.view.collectionId}
          />
        ) : tab?.view.kind === 'environment' ? (
          <EnvironmentEditor
            key={tab.view.environmentId}
            tabId={tabId}
            worktreeId={worktreeId}
            environmentId={tab.view.environmentId}
          />
        ) : (
          <div className="flex flex-1 items-center justify-center p-6 text-sm text-muted-foreground">
            {translate('apiClient.emptyState', 'Import a Postman collection or create a request.')}
          </div>
        )}
      </div>

      <ApiConsolePanel
        entries={entries ?? []}
        collapsed={tab?.consoleCollapsed ?? false}
        height={tab?.consoleHeight ?? 200}
        onCollapsedChange={(consoleCollapsed) => setLayout(tabId, { consoleCollapsed })}
        onHeightChange={(consoleHeight) => setLayout(tabId, { consoleHeight })}
        onClear={() => void clearConsole(worktreeId)}
      />
      <ApiClientUnsavedDialog tabId={tabId} />
    </div>
  )
}
