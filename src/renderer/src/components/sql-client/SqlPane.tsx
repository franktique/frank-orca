import { useEffect, useRef, useState } from 'react'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import { SQL_CLIENT_LIMITS } from '../../../../shared/sql-client/sql-client-schemas'
import SqlEditor from './editor/SqlEditor'
import SqlResults from './results/SqlResults'
import SaveQueryDialog from './toolbar/SaveQueryDialog'
import SqlSaveControls from './toolbar/SqlSaveControls'
import SqlToolbar from './toolbar/SqlToolbar'
import { useSqlSnapshot } from './use-sql-project'
import { saveSqlTabAs, saveSqlTabInPlace } from '@/lib/sql-saved-query-actions'
import { toast } from 'sonner'

type SqlPaneProps = {
  tabId: string
  worktreeId: string
  isVisible: boolean
}

export default function SqlPane({ tabId, worktreeId }: SqlPaneProps): React.JSX.Element {
  const tab = useAppStore((state) => state.sqlTabsById[tabId])
  const ensureTabState = useAppStore((state) => state.ensureSqlTabState)
  const loadSnapshot = useAppStore((state) => state.loadSqlSnapshot)
  const updateTab = useAppStore((state) => state.updateSqlTab)
  const snapshot = useSqlSnapshot(worktreeId)
  const [saveDialogOpen, setSaveDialogOpen] = useState(false)
  const regionRef = useRef<HTMLDivElement>(null)
  // Dragging only moves local state; the ratio is written to the tab once on release.
  const [dragRatio, setDragRatio] = useState<number | null>(null)

  useEffect(() => {
    ensureTabState(tabId, worktreeId)
    void loadSnapshot(worktreeId)
  }, [ensureTabState, loadSnapshot, tabId, worktreeId])

  const splitRatio = dragRatio ?? tab?.splitRatio ?? SQL_CLIENT_LIMITS.defaultSplitRatio

  const requestSave = (asNew: boolean): void => {
    const current = useAppStore.getState().sqlTabsById[tabId]
    if (!current?.connectionId) {
      toast.error(
        translate('sqlClient.saved.needConnection', 'Select a connection to save a query')
      )
      return
    }
    if (current.draftText.length === 0) {
      return
    }
    if (current.savedQueryId && !asNew) {
      void saveSqlTabInPlace(tabId)
      return
    }
    setSaveDialogOpen(true)
  }

  const startDrag = (event: React.MouseEvent): void => {
    event.preventDefault()
    const region = regionRef.current?.getBoundingClientRect()
    if (!region) {
      return
    }
    let latest = splitRatio
    const onMove = (move: MouseEvent): void => {
      latest = Math.min(
        SQL_CLIENT_LIMITS.splitRatioMax,
        Math.max(SQL_CLIENT_LIMITS.splitRatioMin, (move.clientY - region.top) / region.height)
      )
      setDragRatio(latest)
    }
    const onUp = (): void => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      updateTab(tabId, { splitRatio: latest })
      setDragRatio(null)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  return (
    <div
      className="flex min-h-0 min-w-0 flex-1 flex-col"
      data-sql-tab-id={tabId}
      onKeyDown={(event) => {
        const modifier = navigator.userAgent.includes('Mac') ? event.metaKey : event.ctrlKey
        if (modifier && event.key.toLowerCase() === 's') {
          event.preventDefault()
          requestSave(event.altKey)
        }
      }}
    >
      <SqlToolbar
        worktreeId={worktreeId}
        tabId={tabId}
        saveSlot={<SqlSaveControls worktreeId={worktreeId} tabId={tabId} onSave={requestSave} />}
      />
      {tab?.draftTooLarge ? (
        <p role="status" className="border-b border-border px-3 py-1 text-xs text-muted-foreground">
          {translate(
            'sqlClient.pane.draftTooLarge',
            'This query is over 1 MB, so it is kept only until the tab closes.'
          )}
        </p>
      ) : null}
      <div ref={regionRef} className="flex min-h-0 flex-1 flex-col">
        <div
          className="min-h-0 overflow-hidden"
          style={{ flexBasis: `${splitRatio * 100}%`, flexGrow: 0 }}
        >
          <SqlEditor tabId={tabId} />
        </div>
        <div
          role="separator"
          aria-orientation="horizontal"
          aria-label={translate('sqlClient.pane.resizeSplit', 'Resize editor and results')}
          className="group flex h-2 shrink-0 cursor-row-resize items-center"
          onMouseDown={startDrag}
        >
          <div className="h-px w-full bg-border transition-colors group-hover:bg-ring/50" />
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">
          <SqlResults tabId={tabId} />
        </div>
      </div>
      {saveDialogOpen && tab ? (
        <SaveQueryDialog
          sql={tab.draftText}
          collections={(snapshot?.collections ?? []).filter(
            (collection) => collection.connectionId === tab.connectionId
          )}
          onSave={(input) => saveSqlTabAs(tabId, input)}
          onClose={() => setSaveDialogOpen(false)}
        />
      ) : null}
    </div>
  )
}
