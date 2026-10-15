import { Loader2, Play, Plus, Square } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { ShortcutKeyCombo } from '../../ShortcutKeyCombo'
import { runSqlEditor } from '../editor/sql-editor-registry'
import ConnectionSelect from './ConnectionSelect'

export default function SqlToolbar({
  worktreeId,
  tabId,
  saveSlot
}: {
  worktreeId: string
  tabId: string
  saveSlot?: React.ReactNode
}): React.JSX.Element {
  const hasConnection = useAppStore((state) => Boolean(state.sqlTabsById[tabId]?.connectionId))
  const running = useAppStore((state) => state.sqlRunByTab[tabId]?.state === 'running')
  const updateTab = useAppStore((state) => state.updateSqlTab)
  const clearResult = useAppStore((state) => state.clearSqlTabResult)
  const cancel = useAppStore((state) => state.cancelSqlTabRun)
  const mod = navigator.userAgent.includes('Mac') ? '⌘' : 'Ctrl'

  const startNew = (): void => {
    updateTab(tabId, { draftText: '', savedQueryId: null, savedQueryRevision: null })
    clearResult(tabId)
  }

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
      <ConnectionSelect worktreeId={worktreeId} tabId={tabId} />
      <Button variant="outline" size="sm" onClick={startNew}>
        <Plus />
        {translate('sqlClient.toolbar.new', 'New')}
      </Button>
      {running ? (
        <Button variant="outline" size="sm" onClick={() => void cancel(tabId)}>
          <Loader2 className="animate-spin" />
          <Square />
          {translate('sqlClient.toolbar.cancel', 'Cancel')}
        </Button>
      ) : (
        <Tooltip>
          <TooltipTrigger asChild>
            {/* Why a wrapper: a disabled button swallows pointer events, so it cannot anchor the hint. */}
            <span>
              <Button size="sm" disabled={!hasConnection} onClick={() => runSqlEditor(tabId)}>
                <Play />
                {translate('sqlClient.toolbar.run', 'Run')}
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            {hasConnection ? (
              <span className="flex items-center gap-2">
                {translate('sqlClient.toolbar.runHint', 'Run selection or all')}
                <ShortcutKeyCombo keys={[mod, 'Enter']} />
              </span>
            ) : (
              translate('sqlClient.toolbar.selectConnection', 'Select a connection to run')
            )}
          </TooltipContent>
        </Tooltip>
      )}
      <div className="ml-auto flex items-center gap-2">{saveSlot}</div>
    </div>
  )
}
