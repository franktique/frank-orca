import React from 'react'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { CommentMarkdownAsync } from '@/components/sidebar/comment-markdown-lazy'
import { translate } from '@/i18n/i18n'

type ExplanationCardProps = {
  label: string
  changeTitle: string
  text: string
  /** Rendered between the header and the body, e.g. the outdated badge. */
  badge?: React.ReactNode
  /** Rendered below the text: navigation, questions. */
  children?: React.ReactNode
  onClose?: () => void
}

export function ExplanationCard({
  label,
  changeTitle,
  text,
  badge,
  children,
  onClose
}: ExplanationCardProps): React.JSX.Element {
  return (
    <div
      data-testid="explanation-card"
      data-explanation-label={label}
      className="relative z-10 mx-2 my-1 flex flex-col gap-1.5 rounded-md border border-border bg-card px-3 py-2 text-card-foreground"
    >
      <div className="flex items-center gap-2">
        <span className="rounded-full bg-muted px-1.5 text-[11px] font-semibold">{label}</span>
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{changeTitle}</span>
        {badge}
        {onClose ? (
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={translate(
              'auto.components.right.sidebar.explanations.card.close',
              'Close explanation'
            )}
            onClick={onClose}
          >
            <X />
          </Button>
        ) : null}
      </div>
      <ScrollArea className="max-h-48" viewportClassName="max-h-48">
        <CommentMarkdownAsync content={text} className="text-[13px] [&_p]:my-1" />
      </ScrollArea>
      {children}
    </div>
  )
}
