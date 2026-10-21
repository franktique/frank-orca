import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { translate } from '@/i18n/i18n'
import type { RunSetupInput } from '../../../../../preload/api/test-run-api'

type TestRunInputsFormProps = {
  inputs: readonly RunSetupInput[]
  typed: Record<string, string>
  rememberInputs: boolean
  rememberSecrets: boolean
  onTyped: (name: string, value: string) => void
  onRememberInputs: (value: boolean) => void
  onRememberSecrets: (value: boolean) => void
  onClearRememberedSecrets: () => void
}

export default function TestRunInputsForm({
  inputs,
  typed,
  rememberInputs,
  rememberSecrets,
  onTyped,
  onRememberInputs,
  onRememberSecrets,
  onClearRememberedSecrets
}: TestRunInputsFormProps): React.JSX.Element | null {
  if (inputs.length === 0) {
    return null
  }
  const hasSecrets = inputs.some((input) => input.secret)
  const hasRememberedSecrets = inputs.some((input) => input.secret && input.hasRemembered)
  return (
    <section
      className="space-y-3"
      aria-label={translate('apiClient.testRun.inputs.title', 'Inputs')}
    >
      <h3 className="text-sm font-medium">
        {translate('apiClient.testRun.inputs.title', 'Inputs')}
      </h3>
      <div className="grid gap-3 sm:grid-cols-2">
        {inputs.map((input) => {
          const id = `test-run-input-${input.name}`
          const remembered = input.secret && input.hasRemembered && !typed[input.name]
          return (
            <div key={input.name} className="space-y-1">
              <Label htmlFor={id}>
                {input.name}
                {input.required ? null : (
                  <span className="text-muted-foreground">
                    {translate('apiClient.testRun.inputs.optional', ' (optional)')}
                  </span>
                )}
              </Label>
              <Input
                id={id}
                type={input.secret ? 'password' : 'text'}
                autoComplete="off"
                value={typed[input.name] ?? ''}
                placeholder={
                  remembered
                    ? translate('apiClient.testRun.inputs.remembered', 'Remembered')
                    : undefined
                }
                onChange={(event) => onTyped(input.name, event.target.value)}
              />
              {remembered ? (
                <p className="text-xs text-muted-foreground">
                  {translate(
                    'apiClient.testRun.inputs.rememberedHint',
                    'A remembered value will be used unless you type a new one.'
                  )}
                </p>
              ) : null}
            </div>
          )
        })}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex items-center gap-2">
          <Checkbox
            id="test-run-remember-inputs"
            checked={rememberInputs}
            onCheckedChange={(checked) => onRememberInputs(checked === true)}
          />
          <Label htmlFor="test-run-remember-inputs">
            {translate('apiClient.testRun.inputs.rememberInputs', 'Remember inputs')}
          </Label>
        </div>
        {hasSecrets ? (
          <div className="flex items-center gap-2">
            <Checkbox
              id="test-run-remember-secrets"
              checked={rememberSecrets}
              onCheckedChange={(checked) => onRememberSecrets(checked === true)}
            />
            <Label htmlFor="test-run-remember-secrets">
              {translate('apiClient.testRun.inputs.rememberSecrets', 'Remember secrets')}
            </Label>
          </div>
        ) : null}
        {hasRememberedSecrets ? (
          <Button variant="outline" size="xs" onClick={onClearRememberedSecrets}>
            {translate('apiClient.testRun.inputs.clearSecrets', 'Clear remembered secrets')}
          </Button>
        ) : null}
      </div>
    </section>
  )
}
