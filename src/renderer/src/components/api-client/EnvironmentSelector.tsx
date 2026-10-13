import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'

const NO_ENVIRONMENT = '__none__'

/** The worktree's active environment; every API Client tab of the worktree reads and sets the same one. */
export default function EnvironmentSelector({
  worktreeId
}: {
  worktreeId: string
}): React.JSX.Element {
  const snapshot = useAppStore((state) => state.apiClientSnapshotsByWorktree[worktreeId])
  const setActive = useAppStore((state) => state.setApiClientActiveEnvironment)
  return (
    <Select
      value={snapshot?.activeEnvironmentId ?? NO_ENVIRONMENT}
      onValueChange={(value) => void setActive(worktreeId, value === NO_ENVIRONMENT ? null : value)}
    >
      <SelectTrigger
        className="w-56"
        aria-label={translate('apiClient.environments.selector', 'Active environment')}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NO_ENVIRONMENT}>
          {translate('apiClient.environments.none', 'No environment')}
        </SelectItem>
        {(snapshot?.environments ?? []).map((environment) => (
          <SelectItem key={environment.id} value={environment.id}>
            {environment.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
