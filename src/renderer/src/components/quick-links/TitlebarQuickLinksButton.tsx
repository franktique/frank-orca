import { useState } from 'react'
import { useAppStore } from '@/store'
import { useConfirmationDialog } from '@/components/confirmation-dialog-context'
import { translate } from '@/i18n/i18n'
import type { QuickLink } from '../../../../shared/quick-link-types'
import { createQuickLinkDraft, QuickLinkDialog } from './QuickLinkDialog'
import { openQuickLink, quickLinkDestinations } from './open-quick-link'
import { QuickLinksMenu } from './QuickLinksMenu'

const EMPTY_LINKS: QuickLink[] = []

export function TitlebarQuickLinksButton(): React.JSX.Element {
  const links = useAppStore((s) => s.settings?.quickLinks ?? EMPTY_LINKS)
  const openLinksInApp = useAppStore((s) => s.settings?.openLinksInApp === true)
  const activeWorktreeId = useAppStore((s) => s.activeWorktreeId)
  const confirm = useConfirmationDialog()
  const [editor, setEditor] = useState<{ mode: 'add' | 'edit'; link: QuickLink } | null>(null)

  const handleDelete = async (link: QuickLink): Promise<void> => {
    const confirmed = await confirm({
      title: translate(
        'auto.components.quick.links.TitlebarQuickLinksButton.deleteTitle',
        'Delete "{{value0}}"?',
        { value0: link.label }
      ),
      description: translate(
        'auto.components.quick.links.TitlebarQuickLinksButton.deleteDescription',
        'This quick link will be removed from your saved list.'
      ),
      confirmLabel: translate(
        'auto.components.quick.links.TitlebarQuickLinksButton.delete',
        'Delete'
      ),
      confirmVariant: 'destructive'
    })
    if (confirmed) {
      void useAppStore.getState().deleteQuickLink(link.id)
    }
  }

  return (
    <>
      <QuickLinksMenu
        links={links}
        destinations={quickLinkDestinations(openLinksInApp, activeWorktreeId)}
        onOpenLink={(link, destination) => openQuickLink(link.url, destination, activeWorktreeId)}
        onAddLink={() => setEditor({ mode: 'add', link: createQuickLinkDraft() })}
        onEditLink={(link) => setEditor({ mode: 'edit', link })}
        onDeleteLink={(link) => void handleDelete(link)}
      />
      <QuickLinkDialog
        open={editor !== null}
        mode={editor?.mode ?? 'add'}
        link={editor?.link ?? createQuickLinkDraft()}
        onOpenChange={(open) => !open && setEditor(null)}
        onSave={(link) => void useAppStore.getState().upsertQuickLink(link)}
      />
    </>
  )
}
