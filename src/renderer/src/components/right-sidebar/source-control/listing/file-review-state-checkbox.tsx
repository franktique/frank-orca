import React from 'react'
import { Check, Trash } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import type { FileReviewDisplayState } from '../../../../../../shared/file-review-types'

/**
 * Local-only 3-state review checkbox for the Source Control panel's manual code-review
 * tracking. Never committed to the repo. Click cycles unreviewed -> reviewed (green check) ->
 * marked for deletion (red trash) -> unreviewed.
 *
 * Not the shadcn `Checkbox` primitive: this needs a style that reacts to a plain state prop, and
 * pairing shadcn's `Checkbox` with `TooltipTrigger asChild` makes Radix's Slot composition write
 * the Tooltip's own `data-state` (open/closed) onto the shared DOM node, clobbering the
 * Checkbox's own `data-state` (checked/unchecked) — so a `data-[state=checked]:` selector on it
 * never matches. This mirrors `PRViewedCheckbox.tsx`'s hand-rolled approach instead.
 */
export function FileReviewStateCheckbox({
  state,
  onCycle,
  filePath
}: {
  state: FileReviewDisplayState
  onCycle: () => void
  filePath: string
}): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          role="checkbox"
          aria-checked={state !== 'unreviewed'}
          aria-label={translate(
            'auto.components.right.sidebar.SourceControl.reviewedCheckboxLabel',
            '{{value0}} {{value1}}',
            { value0: fileReviewStateActionLabel(state), value1: filePath }
          )}
          onClick={(event) => {
            event.stopPropagation()
            onCycle()
          }}
          // Why workspace-status-review: the design-system lint rejects the sidebar's raw
          // bg-emerald-500 (used for the "active" status dot) as an un-tokenized palette
          // color; this is its nearest semantic token, and "review" green is the right
          // meaning for a reviewed-file mark besides.
          className={cn(
            'flex size-4 shrink-0 items-center justify-center rounded-[4px] border transition-colors',
            state === 'reviewed' &&
              'border-workspace-status-review bg-workspace-status-review text-background',
            state === 'markedForDeletion' &&
              'border-destructive bg-destructive text-destructive-foreground',
            state === 'unreviewed' && 'border-border bg-background text-transparent'
          )}
        >
          {state === 'reviewed' && <Check className="size-3" strokeWidth={3} />}
          {state === 'markedForDeletion' && <Trash className="size-2.5" strokeWidth={2.5} />}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top">{fileReviewStateActionLabel(state)}</TooltipContent>
    </Tooltip>
  )
}

// Why: tooltip/aria-label describe the action the *next* click will take, matching the cycle
// unreviewed -> reviewed -> markedForDeletion -> unreviewed.
function fileReviewStateActionLabel(state: FileReviewDisplayState): string {
  switch (state) {
    case 'unreviewed':
      return translate(
        'auto.components.right.sidebar.SourceControl.reviewedCheckboxMark',
        'Mark reviewed'
      )
    case 'reviewed':
      return translate(
        'auto.components.right.sidebar.SourceControl.reviewedCheckboxMarkForDeletion',
        'Mark for deletion'
      )
    case 'markedForDeletion':
      return translate(
        'auto.components.right.sidebar.SourceControl.reviewedCheckboxClearMark',
        'Clear mark'
      )
  }
}
