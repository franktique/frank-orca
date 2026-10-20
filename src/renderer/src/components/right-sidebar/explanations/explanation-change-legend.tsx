import React from 'react'
import { toChangeLetter } from '../../../../../shared/agent-explanations/explanation-labels'
import type { Change } from '../../../../../shared/agent-explanations/explanation-types'
import { CommentMarkdownAsync } from '@/components/sidebar/comment-markdown-lazy'
import { translate } from '@/i18n/i18n'

type ExplanationChangeLegendProps = {
  changes: readonly Change[]
  focusedChangeIndex: number | null
  onFocusChange: (changeIndex: number | null) => void
}

export function ExplanationChangeLegend({
  changes,
  focusedChangeIndex,
  onFocusChange
}: ExplanationChangeLegendProps): React.JSX.Element {
  return (
    <div className="flex flex-col gap-0.5 px-2 pb-2" role="list">
      {changes.map((change) => {
        const selected = focusedChangeIndex === change.index
        const letter = toChangeLetter(change.index)
        return (
          <button
            key={change.index}
            type="button"
            role="listitem"
            aria-pressed={selected}
            data-testid="explanation-legend-row"
            data-current={selected ? 'true' : undefined}
            title={translate(
              'auto.components.right.sidebar.explanations.legend.focus',
              'Show only the files in change {{letter}}',
              { letter }
            )}
            className="flex w-full cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent/40 data-[current=true]:bg-accent"
            onClick={() => onFocusChange(selected ? null : change.index)}
          >
            <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-foreground">
              {letter}
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="truncate text-[13px] font-medium text-foreground">
                {change.title}
              </span>
              {change.summary ? (
                <CommentMarkdownAsync
                  content={change.summary}
                  className="text-xs text-muted-foreground [&_p]:m-0"
                />
              ) : null}
            </span>
          </button>
        )
      })}
    </div>
  )
}
