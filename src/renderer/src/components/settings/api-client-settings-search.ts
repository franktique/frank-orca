import type { SettingsSearchEntry } from './settings-search'
import { createLocalizedCatalog } from '@/i18n/localized-catalog'
import { translate } from '@/i18n/i18n'
import { translateSearchKeyword } from './settings-search-keywords'

export const getApiClientSettingsSearchEntries = createLocalizedCatalog(
  (): SettingsSearchEntry[] => [
    {
      title: translate('apiClient.settings.sslTitle', 'API Client SSL verification'),
      description: translate(
        'apiClient.settings.sslDescription',
        'Verify server certificates for API Client requests. A request can override this.'
      ),
      keywords: [
        ...translateSearchKeyword('apiClient.settings.keywordApi', 'api client'),
        ...translateSearchKeyword('apiClient.settings.keywordPostman', 'postman'),
        ...translateSearchKeyword('apiClient.settings.keywordSsl', 'ssl'),
        ...translateSearchKeyword('apiClient.settings.keywordTls', 'tls'),
        ...translateSearchKeyword('apiClient.settings.keywordCertificate', 'certificate'),
        ...translateSearchKeyword('apiClient.settings.keywordInsecure', 'insecure')
      ]
    }
  ]
)
