import type { StateCreator } from 'zustand'
import { toast } from 'sonner'
import type { AppState } from '../types'
import type { QuickLink } from '../../../../shared/quick-link-types'
import { applyQuickLinkMutation, type QuickLinkMutation } from '../../../../shared/quick-links'
import { translate } from '@/i18n/i18n'

export type QuickLinksSlice = {
  upsertQuickLink: (link: QuickLink) => Promise<boolean>
  deleteQuickLink: (id: string) => Promise<boolean>
}

async function mutateQuickLinks(
  get: Parameters<StateCreator<AppState>>[1],
  mutation: QuickLinkMutation
): Promise<boolean> {
  try {
    const current = get().settings?.quickLinks ?? []
    await get().updateSettingsOrThrow({ quickLinks: applyQuickLinkMutation(current, mutation) })
    return true
  } catch (error) {
    toast.error(
      translate('auto.store.slices.quick.links.saveFailed', 'Failed to save quick link'),
      { description: error instanceof Error ? error.message : undefined }
    )
    return false
  }
}

export const createQuickLinksSlice: StateCreator<AppState, [], [], QuickLinksSlice> = (
  _set,
  get
) => ({
  upsertQuickLink: (link) => mutateQuickLinks(get, { type: 'upsert', link }),
  deleteQuickLink: (id) => mutateQuickLinks(get, { type: 'delete', id })
})
