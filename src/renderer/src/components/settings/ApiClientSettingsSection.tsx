import type React from 'react'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import { Label } from '../ui/label'
import { SearchableSetting } from './SearchableSetting'
import { SettingsSwitch } from './SettingsFormControls'
import { getApiClientSettingsSearchEntries } from './api-client-settings-search'
import { translate } from '@/i18n/i18n'

type ApiClientSettingsSectionProps = {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
}

export function ApiClientSettingsSection({
  settings,
  updateSettings
}: ApiClientSettingsSectionProps): React.JSX.Element {
  const [entry] = getApiClientSettingsSearchEntries()
  const verifySsl = settings.apiClientSslVerification !== false
  return (
    <SearchableSetting
      {...entry}
      className="space-y-1 py-2"
      id="advanced-api-client-ssl-verification"
    >
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0 shrink space-y-1">
          <Label id="advanced-api-client-ssl-verification-label">
            {translate('apiClient.settings.sslLabel', 'Verify SSL certificates')}
          </Label>
          <p className="text-xs text-muted-foreground">
            {translate(
              'apiClient.settings.sslHelp',
              'Turn off to send API Client requests to servers with self-signed or invalid certificates.'
            )}
          </p>
        </div>
        <SettingsSwitch
          checked={verifySsl}
          onChange={() => updateSettings({ apiClientSslVerification: !verifySsl })}
          ariaLabelledBy="advanced-api-client-ssl-verification-label"
        />
      </div>
    </SearchableSetting>
  )
}
