import { lazy, Suspense, useMemo, useState } from 'react'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { translate } from '@/i18n/i18n'
import type { ResponseSnapshot } from '../../../../../shared/api-client/api-client-types'
import {
  formatBytes,
  isJsonContentType,
  PRETTY_PRINT_MAX_CHARS,
  prettyPrintJson
} from './response-formatting'

const ApiClientCodeEditor = lazy(() => import('../ApiClientCodeEditor'))

type ViewMode = 'pretty' | 'raw'

function languageFor(contentType: string | null): string {
  if (isJsonContentType(contentType)) {
    return 'json'
  }
  if (contentType && /xml/i.test(contentType)) {
    return 'xml'
  }
  return contentType && /html/i.test(contentType) ? 'html' : 'plaintext'
}

export default function ResponseBody({
  response
}: {
  response: ResponseSnapshot
}): React.JSX.Element {
  const { body } = response
  const text = body.encoding === 'utf8' ? (body.text ?? '') : ''
  const isJson = body.encoding === 'utf8' && isJsonContentType(response.contentType)
  const pretty = useMemo(
    () => (isJson && text.length <= PRETTY_PRINT_MAX_CHARS ? prettyPrintJson(text) : null),
    [isJson, text]
  )
  // Pretty is the default only for JSON small enough to format without a hitch.
  const [mode, setMode] = useState<ViewMode>(pretty !== null ? 'pretty' : 'raw')

  if (body.encoding === 'base64') {
    return (
      <p className="text-xs text-muted-foreground" role="status">
        {translate(
          'apiClient.response.binary',
          'Binary response ({{type}}, {{size}}). It is not shown as text.',
          { type: response.contentType ?? 'unknown type', size: formatBytes(response.sizeBytes) }
        )}
      </p>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <Tabs value={mode} onValueChange={(next) => setMode(next === 'raw' ? 'raw' : 'pretty')}>
        <TabsList>
          <TabsTrigger value="pretty" disabled={pretty === null}>
            {translate('apiClient.response.pretty', 'Pretty')}
          </TabsTrigger>
          <TabsTrigger value="raw">{translate('apiClient.response.raw', 'Raw')}</TabsTrigger>
        </TabsList>
      </Tabs>
      {body.truncated ? (
        <p className="text-xs text-muted-foreground" role="status">
          {translate(
            'apiClient.response.truncated',
            'The body is larger than 10 MB, so only the first 10 MB is shown.'
          )}
        </p>
      ) : null}
      <div className="min-h-0 flex-1">
        <Suspense fallback={null}>
          <ApiClientCodeEditor
            label={translate('apiClient.response.body', 'Response body')}
            value={mode === 'pretty' && pretty !== null ? pretty : text}
            language={mode === 'pretty' ? 'json' : languageFor(response.contentType)}
            readOnly
          />
        </Suspense>
      </div>
    </div>
  )
}
