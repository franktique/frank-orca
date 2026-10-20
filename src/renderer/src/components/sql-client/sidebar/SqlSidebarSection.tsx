import { ChevronRight } from 'lucide-react'
import { useState } from 'react'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'

export default function SqlSidebarSection({
  title,
  actions,
  defaultOpen = true,
  children
}: {
  title: string
  actions?: React.ReactNode
  defaultOpen?: boolean
  children: React.ReactNode
}): React.JSX.Element {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="border-b border-border">
      <Collapsible open={open} onOpenChange={setOpen}>
        <div className="flex items-center justify-between gap-2 px-3 py-1.5">
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="flex min-w-0 items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground"
            >
              <ChevronRight
                className={cn('size-3 shrink-0 transition-transform', open && 'rotate-90')}
                aria-hidden="true"
              />
              <span className="truncate">{title}</span>
            </button>
          </CollapsibleTrigger>
          {actions ? <div className="flex items-center gap-1">{actions}</div> : null}
        </div>
        <CollapsibleContent>
          <div className="pb-2">{children}</div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  )
}
