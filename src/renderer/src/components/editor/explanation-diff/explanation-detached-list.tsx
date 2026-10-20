import React from 'react'
import { translate } from '@/i18n/i18n'
import { ExplanationCard } from './ExplanationCard'
import type { ExplanationFileItem } from './explanation-file-items'

type ExplanationDetachedListProps = {
  items: readonly ExplanationFileItem[]
  /** Shown above the cards, e.g. the host-disconnected notice. */
  notice?: string
  renderItemFooter?: (entry: ExplanationFileItem) => React.ReactNode
}

/** Items with no line to point at (file-level, deleted lines, or an unreadable file): cards without circles. */
export function ExplanationDetachedList({
  items,
  notice,
  renderItemFooter
}: ExplanationDetachedListProps): React.JSX.Element | null {
  if (items.length === 0 && !notice) {
    return null
  }
  const fileLevel = items.filter(
    (entry) => entry.kind === 'detached' && entry.reason === 'file-level'
  )
  const gone = items.filter((entry) => entry.kind === 'detached' && entry.reason === 'detached')
  const renderCard = (entry: ExplanationFileItem): React.JSX.Element => (
    <ExplanationCard
      key={entry.item.id}
      label={entry.label}
      changeTitle={entry.changeTitle}
      text={entry.item.text}
    >
      {renderItemFooter?.(entry)}
    </ExplanationCard>
  )
  return (
    <div
      data-testid="explanation-detached-list"
      className="scrollbar-sleek max-h-56 shrink-0 overflow-y-auto border-b border-border bg-muted/30 py-1"
    >
      {notice ? (
        <div className="px-3 py-1 text-xs text-muted-foreground" data-testid="explanation-notice">
          {notice}
        </div>
      ) : null}
      {fileLevel.map(renderCard)}
      {gone.length > 0 ? (
        <>
          <div
            data-testid="explanation-detached-heading"
            className="px-3 pb-0.5 pt-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
          >
            {translate(
              'auto.components.right.sidebar.explanations.card.detachedHeading',
              'Detached'
            )}
          </div>
          <div className="px-3 pb-1 text-xs text-muted-foreground">
            {translate(
              'auto.components.right.sidebar.explanations.card.detachedHint',
              'The code these explanations pointed at has changed or is gone.'
            )}
          </div>
          {gone.map(renderCard)}
        </>
      ) : null}
    </div>
  )
}
