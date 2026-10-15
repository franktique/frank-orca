import { Save } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { ShortcutKeyCombo } from '../../ShortcutKeyCombo'
import { useSqlSavedQueryState } from '../use-sql-saved-query-state'

/** Loaded query name, unsaved-changes dot, and Save (Alt/Option-click saves a copy). */
export default function SqlSaveControls({
  worktreeId,
  tabId,
  onSave
}: {
  worktreeId: string
  tabId: string
  onSave: (asNew: boolean) => void
}): React.JSX.Element {
  const hasContent = useAppStore((state) => (state.sqlTabsById[tabId]?.draftText ?? '').length > 0)
  const { query, unsaved } = useSqlSavedQueryState(worktreeId, tabId)
  const mod = navigator.userAgent.includes('Mac') ? '⌘' : 'Ctrl'
  const alt = navigator.userAgent.includes('Mac') ? '⌥' : 'Alt'
  return (
    <>
      {query ? (
        <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          <span className="max-w-48 truncate">{query.name}</span>
          {unsaved ? (
            <span
              role="img"
              aria-label={translate('sqlClient.saved.unsaved', 'Unsaved changes')}
              title={translate('sqlClient.saved.unsaved', 'Unsaved changes')}
              data-unsaved
              className="size-1.5 shrink-0 rounded-full bg-foreground"
            />
          ) : null}
        </span>
      ) : null}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            disabled={!hasContent}
            onClick={(event) => onSave(event.altKey)}
          >
            <Save />
            {translate('sqlClient.saved.save', 'Save')}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <span className="flex flex-col gap-1">
            <span className="flex items-center gap-2">
              {translate('sqlClient.saved.saveHint', 'Save')}
              <ShortcutKeyCombo keys={[mod, 'S']} />
            </span>
            <span className="flex items-center gap-2">
              {translate('sqlClient.saved.saveAsHint', 'Save as new')}
              <ShortcutKeyCombo keys={[mod, alt, 'S']} />
            </span>
          </span>
        </TooltipContent>
      </Tooltip>
    </>
  )
}
