import { lazy, Suspense } from 'react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { translate } from '@/i18n/i18n'
import type { Body, BodyMode, KeyValue } from '../../../../../shared/api-client/api-client-types'
import type { VariableScope } from '../../../../../shared/api-client/variable-resolution'
import KeyValueTable from './KeyValueTable'
import UnresolvedVariablesNotice from './UnresolvedVariablesNotice'

const ApiClientCodeEditor = lazy(() => import('../ApiClientCodeEditor'))

const EDITABLE_MODES: readonly BodyMode[] = ['none', 'raw', 'urlencoded', 'formdata']
const RAW_LANGUAGES = ['json', 'text', 'xml', 'html', 'javascript'] as const

type BodyEditorProps = {
  body: Body | undefined
  scopes: readonly VariableScope[]
  onChange: (body: Body) => void
}

function modeLabel(mode: BodyMode): string {
  switch (mode) {
    case 'none':
      return translate('apiClient.body.none', 'None')
    case 'raw':
      return translate('apiClient.body.raw', 'Raw')
    case 'urlencoded':
      return translate('apiClient.body.urlencoded', 'x-www-form-urlencoded')
    case 'formdata':
      return translate('apiClient.body.formdata', 'Form data')
    case 'file':
      return translate('apiClient.body.file', 'File')
    case 'graphql':
      return translate('apiClient.body.graphql', 'GraphQL')
  }
}

export default function BodyEditor({ body, scopes, onChange }: BodyEditorProps): React.JSX.Element {
  const current: Body = body ?? { mode: 'none' }
  const modes = EDITABLE_MODES.includes(current.mode)
    ? EDITABLE_MODES
    : [...EDITABLE_MODES, current.mode]
  const readOnlyMode = current.mode === 'file' || current.mode === 'graphql'

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex items-center gap-2">
        <Select
          value={current.mode}
          onValueChange={(mode) => {
            const next = modes.find((candidate) => candidate === mode)
            if (next) {
              onChange({ ...current, mode: next })
            }
          }}
        >
          <SelectTrigger
            className="w-56"
            aria-label={translate('apiClient.body.mode', 'Body type')}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {modes.map((mode) => (
              <SelectItem key={mode} value={mode}>
                {modeLabel(mode)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {current.mode === 'raw' ? (
          <Select
            value={current.language ?? 'text'}
            onValueChange={(language) => onChange({ ...current, language })}
          >
            <SelectTrigger
              className="w-36"
              aria-label={translate('apiClient.body.language', 'Language')}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RAW_LANGUAGES.map((language) => (
                <SelectItem key={language} value={language}>
                  {language}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
      </div>

      {readOnlyMode ? (
        <p className="text-xs text-muted-foreground">
          {translate(
            'apiClient.body.sentAsRaw',
            'This body type cannot be edited here. It is sent as raw text and kept for export.'
          )}
        </p>
      ) : null}

      {current.mode === 'none' ? (
        <p className="text-xs text-muted-foreground">
          {translate('apiClient.body.noBody', 'This request has no body.')}
        </p>
      ) : null}

      {current.mode === 'raw' || readOnlyMode ? (
        <div className="min-h-0 flex-1">
          <Suspense fallback={null}>
            <ApiClientCodeEditor
              label={translate('apiClient.body.rawEditor', 'Request body')}
              value={
                current.mode === 'graphql' ? (current.graphql?.query ?? '') : (current.raw ?? '')
              }
              language={current.language ?? 'text'}
              readOnly={readOnlyMode}
              onChange={(raw) => onChange({ ...current, raw })}
            />
          </Suspense>
        </div>
      ) : null}

      {current.mode === 'raw' ? (
        <UnresolvedVariablesNotice texts={[current.raw ?? '']} scopes={scopes} />
      ) : null}

      {current.mode === 'urlencoded' || current.mode === 'formdata' ? (
        <KeyValueTable
          label={modeLabel(current.mode)}
          rows={(current.mode === 'urlencoded' ? current.urlencoded : current.formdata) ?? []}
          scopes={scopes}
          onChange={(rows: KeyValue[]) =>
            onChange(
              current.mode === 'urlencoded'
                ? { ...current, urlencoded: rows }
                : { ...current, formdata: rows }
            )
          }
        />
      ) : null}
    </div>
  )
}
