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
import type { RequestSettings as RequestSettingsValue } from '../../../../../shared/api-client/api-client-types'

type TriState = 'inherit' | 'on' | 'off'

const toTriState = (value: boolean | undefined): TriState =>
  value === undefined ? 'inherit' : value ? 'on' : 'off'

const fromTriState = (value: string): boolean | undefined =>
  value === 'on' ? true : value === 'off' ? false : undefined

type RequestSettingsProps = {
  settings: RequestSettingsValue
  onChange: (settings: RequestSettingsValue) => void
}

function TriStateSelect({
  id,
  value,
  inheritLabel,
  onChange
}: {
  id: string
  value: boolean | undefined
  inheritLabel: string
  onChange: (value: boolean | undefined) => void
}): React.JSX.Element {
  return (
    <Select value={toTriState(value)} onValueChange={(next) => onChange(fromTriState(next))}>
      <SelectTrigger id={id} className="w-64">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="inherit">{inheritLabel}</SelectItem>
        <SelectItem value="on">{translate('apiClient.settings.on', 'On')}</SelectItem>
        <SelectItem value="off">{translate('apiClient.settings.off', 'Off')}</SelectItem>
      </SelectContent>
    </Select>
  )
}

export default function RequestSettings({
  settings,
  onChange
}: RequestSettingsProps): React.JSX.Element {
  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <Label htmlFor="api-client-request-ssl">
          {translate('apiClient.settings.requestSsl', 'SSL certificate verification')}
        </Label>
        <TriStateSelect
          id="api-client-request-ssl"
          value={settings.sslVerification}
          inheritLabel={translate('apiClient.settings.useAppSetting', 'Use the app setting')}
          onChange={(sslVerification) => onChange({ ...settings, sslVerification })}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="api-client-request-redirects">
          {translate('apiClient.settings.followRedirects', 'Follow redirects')}
        </Label>
        <TriStateSelect
          id="api-client-request-redirects"
          value={settings.followRedirects}
          inheritLabel={translate('apiClient.settings.defaultOn', 'Default (on)')}
          onChange={(followRedirects) => onChange({ ...settings, followRedirects })}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="api-client-request-timeout">
          {translate('apiClient.settings.timeout', 'Timeout (ms)')}
        </Label>
        <Input
          id="api-client-request-timeout"
          inputMode="numeric"
          className="w-40"
          value={settings.timeoutMs ?? ''}
          placeholder={translate('apiClient.settings.timeoutDefault', 'Default')}
          onChange={(event) => {
            const parsed = Number.parseInt(event.target.value, 10)
            onChange({
              ...settings,
              timeoutMs: Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
            })
          }}
        />
      </div>
    </div>
  )
}
