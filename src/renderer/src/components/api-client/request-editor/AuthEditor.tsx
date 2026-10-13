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
import type { Auth, AuthType } from '../../../../../shared/api-client/api-client-types'
import { SUPPORTED_AUTH_TYPES } from '../../../../../shared/api-client/api-client-types'
import type { VariableScope } from '../../../../../shared/api-client/variable-resolution'
import UnresolvedVariablesNotice from './UnresolvedVariablesNotice'

const FIELDS: Partial<Record<AuthType, { name: string; label: () => string; secret?: boolean }[]>> =
  {
    bearer: [{ name: 'token', label: () => translate('apiClient.auth.token', 'Token') }],
    basic: [
      { name: 'username', label: () => translate('apiClient.auth.username', 'Username') },
      {
        name: 'password',
        label: () => translate('apiClient.auth.password', 'Password'),
        secret: true
      }
    ],
    apikey: [
      { name: 'key', label: () => translate('apiClient.auth.keyName', 'Key') },
      { name: 'value', label: () => translate('apiClient.auth.keyValue', 'Value'), secret: true }
    ]
  }

const TYPE_LABELS: Partial<Record<AuthType, () => string>> = {
  inherit: () => translate('apiClient.auth.inherit', 'Inherit from parent'),
  noauth: () => translate('apiClient.auth.noauth', 'No auth'),
  bearer: () => translate('apiClient.auth.bearer', 'Bearer token'),
  basic: () => translate('apiClient.auth.basic', 'Basic auth'),
  apikey: () => translate('apiClient.auth.apikey', 'API key')
}

const typeLabel = (type: AuthType): string => TYPE_LABELS[type]?.() ?? type

type AuthEditorProps = {
  auth: Auth | undefined
  scopes: readonly VariableScope[]
  onChange: (auth: Auth | undefined) => void
}

export default function AuthEditor({ auth, scopes, onChange }: AuthEditorProps): React.JSX.Element {
  const current: Auth = auth ?? { type: 'inherit', params: {} }
  const supported = SUPPORTED_AUTH_TYPES.includes(current.type)
  const types = supported ? SUPPORTED_AUTH_TYPES : [...SUPPORTED_AUTH_TYPES, current.type]
  const fields = FIELDS[current.type] ?? []

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <Label htmlFor="api-client-auth-type">
          {translate('apiClient.auth.type', 'Auth type')}
        </Label>
        <Select
          value={current.type}
          onValueChange={(type) => {
            const next = types.find((candidate) => candidate === type)
            if (!next) {
              return
            }
            onChange(next === 'inherit' ? undefined : { ...current, type: next })
          }}
        >
          <SelectTrigger id="api-client-auth-type" className="w-64">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {types.map((type) => (
              <SelectItem key={type} value={type} disabled={!SUPPORTED_AUTH_TYPES.includes(type)}>
                {typeLabel(type)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {!supported ? (
        <p className="text-xs text-muted-foreground" role="status">
          {translate(
            'apiClient.auth.unsupported',
            'This auth type is not supported yet. It is kept for export, and sending is blocked.'
          )}
        </p>
      ) : null}

      {fields.map((field) => (
        <div key={field.name} className="space-y-1">
          <Label htmlFor={`api-client-auth-${field.name}`}>{field.label()}</Label>
          <Input
            id={`api-client-auth-${field.name}`}
            value={current.params[field.name] ?? ''}
            type={field.secret ? 'password' : 'text'}
            className="max-w-md"
            onChange={(event) =>
              onChange({
                ...current,
                params: { ...current.params, [field.name]: event.target.value }
              })
            }
          />
        </div>
      ))}

      <UnresolvedVariablesNotice
        texts={fields.map((field) => current.params[field.name] ?? '')}
        scopes={scopes}
      />

      {current.type === 'apikey' ? (
        <div className="space-y-1">
          <Label htmlFor="api-client-auth-in">{translate('apiClient.auth.addTo', 'Add to')}</Label>
          <Select
            value={current.params.in === 'query' ? 'query' : 'header'}
            onValueChange={(where) =>
              onChange({ ...current, params: { ...current.params, in: where } })
            }
          >
            <SelectTrigger id="api-client-auth-in" className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="header">{translate('apiClient.auth.header', 'Header')}</SelectItem>
              <SelectItem value="query">
                {translate('apiClient.auth.query', 'Query params')}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
      ) : null}
    </div>
  )
}
