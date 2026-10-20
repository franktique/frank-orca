import React, { useEffect, useMemo } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { buildGlobalOrder } from '../../../../../shared/agent-explanations/explanation-labels'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'

const isMac = (): boolean => navigator.userAgent.includes('Mac')

// Cmd+Alt on Mac, Ctrl+Alt elsewhere; Period/Comma keep the chord free of Monaco's Alt+Arrow bindings.
export function explanationNavShortcutLabel(direction: 1 | -1): string {
  const key = direction === 1 ? '.' : ','
  return isMac() ? `⌘⌥${key}` : `Ctrl+Alt+${key}`
}

export function useExplanationNavShortcuts(workspaceId: string): void {
  const step = useAppStore((s) => s.stepExplanationItem)
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const modifier = isMac() ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey
      if (!modifier || !event.altKey || event.shiftKey) {
        return
      }
      if (event.code === 'Period' || event.code === 'Comma') {
        event.preventDefault()
        step(workspaceId, event.code === 'Period' ? 1 : -1)
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [step, workspaceId])
}

export function ExplanationNavFooter({
  workspaceId,
  itemId
}: {
  workspaceId: string
  itemId: string
}): React.JSX.Element | null {
  const explanation = useAppStore(
    (s) => s.explanationsByWorkspace[workspaceId]?.explanation ?? null
  )
  const step = useAppStore((s) => s.stepExplanationItem)
  const position = useMemo(() => {
    if (!explanation) {
      return null
    }
    const order = buildGlobalOrder(explanation)
    const index = order.findIndex((entry) => entry.itemId === itemId)
    return index === -1 ? null : { label: order[index].label, index, total: order.length }
  }, [explanation, itemId])
  if (!position) {
    return null
  }
  return (
    <div className="flex items-center gap-1 pt-0.5" data-testid="explanation-nav">
      <Button
        variant="ghost"
        size="icon-xs"
        disabled={position.index === 0}
        aria-label={translate(
          'auto.components.right.sidebar.explanations.nav.previous',
          'Previous explanation'
        )}
        title={`${translate('auto.components.right.sidebar.explanations.nav.previous', 'Previous explanation')} (${explanationNavShortcutLabel(-1)})`}
        data-testid="explanation-nav-previous"
        onClick={() => step(workspaceId, -1)}
      >
        <ChevronUp />
      </Button>
      <Button
        variant="ghost"
        size="icon-xs"
        disabled={position.index === position.total - 1}
        aria-label={translate(
          'auto.components.right.sidebar.explanations.nav.next',
          'Next explanation'
        )}
        title={`${translate('auto.components.right.sidebar.explanations.nav.next', 'Next explanation')} (${explanationNavShortcutLabel(1)})`}
        data-testid="explanation-nav-next"
        onClick={() => step(workspaceId, 1)}
      >
        <ChevronDown />
      </Button>
      <span className="text-xs text-muted-foreground" data-testid="explanation-nav-position">
        {translate(
          'auto.components.right.sidebar.explanations.nav.position',
          '{{label}} · {{current}} of {{total}}',
          { label: position.label, current: position.index + 1, total: position.total }
        )}
      </span>
    </div>
  )
}
