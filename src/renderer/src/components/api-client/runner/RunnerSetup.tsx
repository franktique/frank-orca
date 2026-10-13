import { Play } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { translate } from '@/i18n/i18n'
import type { ApiNodeId, Environment } from '../../../../../shared/api-client/api-client-types'
import { API_CLIENT_LIMITS } from '../../../../../shared/api-client/api-client-types'
import type { RunnerSetup as RunnerSetupValue } from '@/store/slices/api-client-runner'

const NO_ENVIRONMENT = '__none__'

export type RunnerRequestRow = { id: ApiNodeId; name: string; method: string; folderPath: string[] }

type RunnerSetupProps = {
  requests: readonly RunnerRequestRow[]
  environments: readonly Environment[]
  setup: RunnerSetupValue
  running: boolean
  onChange: (patch: Partial<RunnerSetupValue>) => void
  onRun: () => void
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, Number.isFinite(value) ? value : min))

export default function RunnerSetup({
  requests,
  environments,
  setup,
  running,
  onChange,
  onRun
}: RunnerSetupProps): React.JSX.Element {
  const included = requests.filter((request) => !setup.excluded[request.id])
  const toggle = (id: ApiNodeId, checked: boolean): void => {
    const { [id]: _removed, ...rest } = setup.excluded
    onChange({ excluded: checked ? rest : { ...rest, [id]: true } })
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label htmlFor="api-client-run-environment">
            {translate('apiClient.runner.environment', 'Environment')}
          </Label>
          <Select
            value={setup.environmentId ?? NO_ENVIRONMENT}
            onValueChange={(value) =>
              onChange({ environmentId: value === NO_ENVIRONMENT ? null : value })
            }
          >
            <SelectTrigger id="api-client-run-environment" className="w-52">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_ENVIRONMENT}>
                {translate('apiClient.environments.none', 'No environment')}
              </SelectItem>
              {environments.map((environment) => (
                <SelectItem key={environment.id} value={environment.id}>
                  {environment.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="api-client-run-iterations">
            {translate('apiClient.runner.iterations', 'Iterations')}
          </Label>
          <Input
            id="api-client-run-iterations"
            type="number"
            min={1}
            max={API_CLIENT_LIMITS.iterationsMax}
            className="w-24"
            value={setup.iterations}
            onChange={(event) =>
              onChange({
                iterations: clamp(
                  Math.trunc(Number(event.target.value)),
                  1,
                  API_CLIENT_LIMITS.iterationsMax
                )
              })
            }
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="api-client-run-delay">
            {translate('apiClient.runner.delay', 'Delay (ms)')}
          </Label>
          <Input
            id="api-client-run-delay"
            type="number"
            min={0}
            max={API_CLIENT_LIMITS.delayMsMax}
            className="w-28"
            value={setup.delayMs}
            onChange={(event) =>
              onChange({
                delayMs: clamp(
                  Math.trunc(Number(event.target.value)),
                  0,
                  API_CLIENT_LIMITS.delayMsMax
                )
              })
            }
          />
        </div>
        <div className="flex items-center gap-2 pb-2">
          <Checkbox
            id="api-client-run-stop-on-failure"
            checked={setup.stopOnFailure}
            onCheckedChange={(checked) => onChange({ stopOnFailure: checked === true })}
          />
          <Label htmlFor="api-client-run-stop-on-failure">
            {translate('apiClient.runner.stopOnFailure', 'Stop on first failure')}
          </Label>
        </div>
        <Button disabled={running || included.length === 0} onClick={onRun}>
          <Play />
          {translate('apiClient.runner.run', 'Run')}
        </Button>
      </div>

      <section aria-label={translate('apiClient.runner.requests', 'Requests')}>
        <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
          <span>
            {translate('apiClient.runner.included', '{{count}} of {{total}} requests selected', {
              count: included.length,
              total: requests.length
            })}
          </span>
          <span className="flex gap-2">
            <Button variant="link" size="xs" onClick={() => onChange({ excluded: {} })}>
              {translate('apiClient.runner.selectAll', 'Select all')}
            </Button>
            <Button
              variant="link"
              size="xs"
              onClick={() =>
                onChange({
                  excluded: Object.fromEntries(
                    requests.map((request) => [request.id, true as const])
                  )
                })
              }
            >
              {translate('apiClient.runner.selectNone', 'Select none')}
            </Button>
          </span>
        </div>
        <ul className="scrollbar-sleek max-h-56 space-y-0.5 overflow-y-auto">
          {requests.map((request) => (
            <li key={request.id} className="flex items-center gap-2 px-1 py-0.5 text-xs">
              <Checkbox
                checked={!setup.excluded[request.id]}
                aria-label={request.name}
                onCheckedChange={(checked) => toggle(request.id, checked === true)}
              />
              <span className="shrink-0 font-mono text-muted-foreground">{request.method}</span>
              <span className="truncate">{[...request.folderPath, request.name].join(' / ')}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
