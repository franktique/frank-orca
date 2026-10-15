import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
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
import { SQL_CLIENT_LIMITS } from '../../../../../shared/sql-client/sql-client-schemas'
import type {
  SqlConnectionView,
  SqlSslMode
} from '../../../../../shared/sql-client/sql-client-types'

type FieldErrors = Partial<Record<'name' | 'host' | 'port' | 'user' | 'database', string>>

type FormValues = {
  name: string
  host: string
  port: string
  user: string
  database: string
  sslMode: SqlSslMode
  password: string
}

function initialValues(existing?: SqlConnectionView): FormValues {
  return {
    name: existing?.name ?? '',
    host: existing?.host ?? '',
    port: String(existing?.port ?? SQL_CLIENT_LIMITS.defaultPort),
    user: existing?.user ?? '',
    database: existing?.database ?? '',
    sslMode: existing?.sslMode ?? 'prefer',
    password: ''
  }
}

function validate(values: FormValues): FieldErrors {
  const required = translate('sqlClient.connection.required', 'Required')
  const errors: FieldErrors = {}
  const limits: [keyof FieldErrors, number][] = [
    ['name', SQL_CLIENT_LIMITS.connectionNameMax],
    ['host', SQL_CLIENT_LIMITS.hostMax],
    ['user', SQL_CLIENT_LIMITS.userMax],
    ['database', SQL_CLIENT_LIMITS.databaseMax]
  ]
  for (const [field, max] of limits) {
    const value = values[field].trim()
    if (value.length === 0) {
      errors[field] = required
    } else if (value.length > max) {
      errors[field] = translate('sqlClient.connection.tooLong', 'At most {{max}} characters', {
        max
      })
    }
  }
  const port = Number(values.port)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    errors.port = translate('sqlClient.connection.invalidPort', 'Enter a port from 1 to 65535')
  }
  return errors
}

type Props = {
  worktreeId: string
  existing?: SqlConnectionView
  encryptionAvailable: boolean
  protectionGapMessage?: string
  onClose: () => void
  onSaved: (connection: SqlConnectionView) => void
}

export default function ConnectionFormDialog({
  worktreeId,
  existing,
  encryptionAvailable,
  protectionGapMessage,
  onClose,
  onSaved
}: Props): React.JSX.Element {
  const [values, setValues] = useState<FormValues>(() => initialValues(existing))
  const [passwordTouched, setPasswordTouched] = useState(false)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [failure, setFailure] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState<'save' | 'test' | null>(null)

  const set = <K extends keyof FormValues>(key: K, value: FormValues[K]): void => {
    setValues((current) => ({ ...current, [key]: value }))
    setTestResult(null)
  }

  const fields = (): Omit<FormValues, 'port' | 'password'> & { port: number } => ({
    name: values.name.trim(),
    host: values.host.trim(),
    port: Number(values.port),
    user: values.user.trim(),
    database: values.database.trim(),
    sslMode: values.sslMode
  })

  const test = async (): Promise<void> => {
    const nextErrors = validate(values)
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) {
      return
    }
    setBusy('test')
    setTestResult(null)
    // An untouched password on an existing connection keeps the stored one.
    const input =
      passwordTouched || !existing ? { ...fields(), password: values.password } : fields()
    const result = await window.api.sqlClient.testConnection({
      worktreeId,
      ...(existing ? { id: existing.id } : {}),
      input
    })
    setBusy(null)
    setTestResult(
      result.ok
        ? {
            ok: true,
            text: translate('sqlClient.connection.testOk', 'Connected to PostgreSQL {{version}}', {
              version: result.serverVersion
            })
          }
        : { ok: false, text: result.message }
    )
  }

  const save = async (): Promise<void> => {
    const nextErrors = validate(values)
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) {
      return
    }
    setBusy('save')
    setFailure(null)
    const result = existing
      ? await window.api.sqlClient.updateConnection({
          worktreeId,
          id: existing.id,
          baseRevision: existing.revision,
          input: passwordTouched ? { ...fields(), password: values.password } : fields()
        })
      : await window.api.sqlClient.createConnection({
          worktreeId,
          input: { ...fields(), password: values.password }
        })
    setBusy(null)
    if (result.ok) {
      onSaved(result.connection)
    } else {
      setFailure(result.message)
    }
  }

  const textField = (
    key: 'name' | 'host' | 'user' | 'database',
    label: string,
    placeholder?: string
  ): React.JSX.Element => (
    <div className="space-y-1">
      <Label htmlFor={`sql-connection-${key}`}>{label}</Label>
      <Input
        id={`sql-connection-${key}`}
        value={values[key]}
        placeholder={placeholder}
        aria-invalid={errors[key] ? true : undefined}
        onChange={(event) => set(key, event.target.value)}
      />
      {errors[key] ? <p className="text-xs text-destructive">{errors[key]}</p> : null}
    </div>
  )

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {existing
              ? translate('sqlClient.connection.editTitle', 'Edit connection')
              : translate('sqlClient.connection.addTitle', 'Add connection')}
          </DialogTitle>
          <DialogDescription>
            {translate(
              'sqlClient.connection.description',
              'PostgreSQL connection, saved for every worktree of this project.'
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {textField('name', translate('sqlClient.connection.name', 'Name'))}
          <div className="grid grid-cols-[1fr_6rem] gap-2">
            {textField('host', translate('sqlClient.connection.host', 'Host'), 'localhost')}
            <div className="space-y-1">
              <Label htmlFor="sql-connection-port">
                {translate('sqlClient.connection.port', 'Port')}
              </Label>
              <Input
                id="sql-connection-port"
                inputMode="numeric"
                value={values.port}
                aria-invalid={errors.port ? true : undefined}
                onChange={(event) => set('port', event.target.value)}
              />
            </div>
          </div>
          {errors.port ? <p className="text-xs text-destructive">{errors.port}</p> : null}
          {textField('user', translate('sqlClient.connection.user', 'User'))}
          <div className="space-y-1">
            <Label htmlFor="sql-connection-password">
              {translate('sqlClient.connection.password', 'Password')}
            </Label>
            <Input
              id="sql-connection-password"
              type="password"
              autoComplete="off"
              value={values.password}
              placeholder={
                existing && existing.passwordState !== 'empty'
                  ? translate('sqlClient.connection.passwordUnchanged', 'Unchanged')
                  : undefined
              }
              onChange={(event) => {
                setPasswordTouched(true)
                set('password', event.target.value)
              }}
            />
            {existing?.passwordState === 'needs-reentry' ? (
              <p className="text-xs text-destructive">
                {translate(
                  'sqlClient.connection.needsReentry',
                  'The saved password can no longer be read. Enter it again.'
                )}
              </p>
            ) : null}
            {!encryptionAvailable || protectionGapMessage ? (
              <p className="text-xs text-muted-foreground" data-protection-gap>
                {protectionGapMessage ??
                  translate(
                    'sqlClient.connection.noEncryption',
                    'This computer cannot encrypt passwords, so the password is kept only until Orca quits.'
                  )}
              </p>
            ) : null}
          </div>
          {textField('database', translate('sqlClient.connection.database', 'Database'))}
          <div className="space-y-1">
            <Label htmlFor="sql-connection-ssl">
              {translate('sqlClient.connection.sslMode', 'SSL mode')}
            </Label>
            <Select
              value={values.sslMode}
              onValueChange={(value) =>
                set('sslMode', value === 'disable' || value === 'require' ? value : 'prefer')
              }
            >
              <SelectTrigger id="sql-connection-ssl" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="disable">
                  {translate('sqlClient.connection.sslDisable', 'Disable')}
                </SelectItem>
                <SelectItem value="prefer">
                  {translate('sqlClient.connection.sslPrefer', 'Prefer')}
                </SelectItem>
                <SelectItem value="require">
                  {translate('sqlClient.connection.sslRequire', 'Require')}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          {testResult ? (
            <p
              role="status"
              className={testResult.ok ? 'text-xs text-status-success' : 'text-xs text-destructive'}
            >
              {testResult.text}
            </p>
          ) : null}
          {failure ? (
            <p role="alert" className="text-xs text-destructive">
              {failure}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => void test()} disabled={busy !== null}>
            {busy === 'test' ? <Loader2 className="animate-spin" /> : null}
            {translate('sqlClient.connection.test', 'Test connection')}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            {translate('sqlClient.common.cancel', 'Cancel')}
          </Button>
          <Button onClick={() => void save()} disabled={busy !== null}>
            {translate('sqlClient.common.save', 'Save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
