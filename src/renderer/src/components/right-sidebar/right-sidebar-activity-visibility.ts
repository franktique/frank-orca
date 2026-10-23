import type { ActivityBarItem } from './activity-bar-buttons'

type RightSidebarActivityVisibilityState = {
  isFolder: boolean
  isFolderWorkspace: boolean
  isSshRepo: boolean
  hasExplanation: boolean
}

export function getVisibleRightSidebarActivityItems(
  items: ActivityBarItem[],
  { isFolder, isFolderWorkspace, isSshRepo, hasExplanation }: RightSidebarActivityVisibilityState
): ActivityBarItem[] {
  return items.filter(
    (item) =>
      (!item.gitOnly || !isFolder) &&
      (!item.folderOnly || isFolderWorkspace) &&
      (!item.sshOnly || isSshRepo) &&
      (!item.requiresExplanation || hasExplanation)
  )
}
