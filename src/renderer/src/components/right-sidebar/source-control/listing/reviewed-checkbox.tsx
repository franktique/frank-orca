import React from 'react'
import { Check } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'

/**
 * Local-only "reviewed" checkbox for the Source Control panel's manual code-review tracking.
 * Never committed to the repo.
 *
 * Not the shadcn `Checkbox` primitive: this needs a checked/unchecked style that reacts to a
 * plain boolean prop, and pairing shadcn's `Checkbox` with `TooltipTrigger asChild` makes Radix's
 * Slot composition write the Tooltip's own `data-state` (open/closed) onto the shared DOM node,
 * clobbering the Checkbox's own `data-state` (checked/unchecked) — so a `data-[state=checked]:`
 * selector on it never matches. This mirrors `PRViewedCheckbox.tsx`'s hand-rolled approach instead.
 */
export function ReviewedCheckbox({
  checked,
  onToggle,
  filePath
}: {
  checked: boolean
  onToggle: () => void
  filePath: string
}): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          role="checkbox"
          aria-checked={checked}
          aria-label={translate(
            'auto.components.right.sidebar.SourceControl.reviewedCheckboxLabel',
            '{{value0}} {{value1}} as reviewed',
            { value0: checked ? 'Unmark' : 'Mark', value1: filePath }
          )}
          onClick={(event) => {
            event.stopPropagation()
            onToggle()
          }}
          // Why workspace-status-review: the design-system lint rejects the sidebar's raw
          // bg-emerald-500 (used for the "active" status dot) as an un-tokenized palette
          // color; this is its nearest semantic token, and "review" green is the right
          // meaning for a reviewed-file mark besides.
          className={cn(
            'flex size-4 shrink-0 items-center justify-center rounded-[4px] border transition-colors',
            checked
              ? 'border-workspace-status-review bg-workspace-status-review text-background'
              : 'border-border bg-background text-transparent'
          )}
        >
          <Check className="size-3" strokeWidth={3} />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top">
        {checked
          ? translate(
              'auto.components.right.sidebar.SourceControl.reviewedCheckboxUnmark',
              'Unmark reviewed'
            )
          : translate(
              'auto.components.right.sidebar.SourceControl.reviewedCheckboxMark',
              'Mark reviewed'
            )}
      </TooltipContent>
    </Tooltip>
  )
}
