import { useRef, useState } from 'react'
import type { QuickLink } from '../../../../shared/quick-link-types'
import {
  MAX_QUICK_LINK_LABEL_LENGTH,
  MAX_QUICK_LINK_URL_LENGTH,
  normalizeQuickLinkUrl
} from '../../../../shared/quick-links'
import { createBrowserUuid } from '@/lib/browser-uuid'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { getScreenSubmitShortcutLabel, isScreenSubmitShortcut } from '@/lib/screen-submit-shortcut'
import { translate } from '@/i18n/i18n'

type QuickLinkDialogProps = {
  open: boolean
  mode: 'add' | 'edit'
  link: QuickLink
  onOpenChange: (open: boolean) => void
  onSave: (link: QuickLink) => void
}

export function createQuickLinkDraft(): QuickLink {
  return { id: `quick-link-${createBrowserUuid()}`, label: '', url: '' }
}

export function QuickLinkDialog({
  open,
  mode,
  link,
  onOpenChange,
  onSave
}: QuickLinkDialogProps): React.JSX.Element {
  const [draft, setDraft] = useState<QuickLink>(link)
  const syncedLinkRef = useRef<QuickLink | null>(null)

  // Why: re-seed the local draft whenever the dialog (re)opens for a new link.
  if (open && syncedLinkRef.current !== link) {
    syncedLinkRef.current = link
    setDraft({ ...link })
  } else if (!open && syncedLinkRef.current !== null) {
    syncedLinkRef.current = null
  }

  const normalizedUrl = normalizeQuickLinkUrl(draft.url)
  const showUrlError = draft.url.trim().length > 0 && normalizedUrl === null
  const canSave = draft.label.trim().length > 0 && normalizedUrl !== null

  const save = (): void => {
    if (!canSave || !normalizedUrl) {
      return
    }
    onSave({ id: draft.id, label: draft.label.trim(), url: normalizedUrl })
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-lg"
        onKeyDown={(event) => {
          const plainEnterInField =
            event.key === 'Enter' && event.target instanceof HTMLInputElement
          if ((isScreenSubmitShortcut(event) || plainEnterInField) && canSave) {
            event.preventDefault()
            save()
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>
            {mode === 'edit'
              ? translate(
                  'auto.components.quick.links.QuickLinkDialog.editTitle',
                  'Edit Quick Link'
                )
              : translate('auto.components.quick.links.QuickLinkDialog.addTitle', 'Add Quick Link')}
          </DialogTitle>
          <DialogDescription>
            {translate(
              'auto.components.quick.links.QuickLinkDialog.description',
              'Saved links appear in the titlebar menu; pick one to open it in the Orca or system browser.'
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label htmlFor="quick-link-label">
            {translate('auto.components.quick.links.QuickLinkDialog.labelField', 'Label')}
          </Label>
          <Input
            id="quick-link-label"
            autoFocus
            value={draft.label}
            maxLength={MAX_QUICK_LINK_LABEL_LENGTH}
            placeholder={translate(
              'auto.components.quick.links.QuickLinkDialog.labelPlaceholder',
              'Team dashboard'
            )}
            onChange={(event) => setDraft((current) => ({ ...current, label: event.target.value }))}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="quick-link-url">
            {translate('auto.components.quick.links.QuickLinkDialog.urlField', 'URL')}
          </Label>
          <Input
            id="quick-link-url"
            value={draft.url}
            maxLength={MAX_QUICK_LINK_URL_LENGTH}
            aria-invalid={showUrlError}
            placeholder="https://example.com"
            onChange={(event) => setDraft((current) => ({ ...current, url: event.target.value }))}
          />
          {showUrlError ? (
            <p className="text-xs text-destructive">
              {translate(
                'auto.components.quick.links.QuickLinkDialog.invalidUrl',
                'Enter a valid http or https URL.'
              )}
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            {translate('auto.components.quick.links.QuickLinkDialog.cancel', 'Cancel')}
          </Button>
          <Button type="button" disabled={!canSave} onClick={save}>
            {translate('auto.components.quick.links.QuickLinkDialog.save', 'Save')}
            <span className="ml-1.5 text-[11px] opacity-60">{getScreenSubmitShortcutLabel()}</span>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
