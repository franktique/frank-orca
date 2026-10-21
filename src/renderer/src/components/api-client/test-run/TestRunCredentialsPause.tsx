import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { translate } from '@/i18n/i18n'
import type { PauseAnswer } from '../../../../../shared/test-orchestrator/test-orchestrator-types'

type TestRunCredentialsPauseProps = {
  inputs: { name: string; secret: boolean }[]
  onAnswer: (answer: PauseAnswer) => void
}

export default function TestRunCredentialsPause({
  inputs,
  onAnswer
}: TestRunCredentialsPauseProps): React.JSX.Element {
  const [values, setValues] = useState<Record<string, string>>({})
  const filled = inputs.every((input) => (values[input.name] ?? '').trim() !== '')
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        {translate(
          'apiClient.testRun.pause.credentialsHint',
          'Enter fresh values to resume the run, or stop it.'
        )}
      </p>
      {inputs.map((input) => {
        const id = `test-run-credential-${input.name}`
        return (
          <div key={input.name} className="space-y-1">
            <Label htmlFor={id}>{input.name}</Label>
            <Input
              id={id}
              type={input.secret ? 'password' : 'text'}
              autoComplete="off"
              value={values[input.name] ?? ''}
              onChange={(event) =>
                setValues((current) => ({ ...current, [input.name]: event.target.value }))
              }
            />
          </div>
        )
      })}
      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={!filled}
          onClick={() => onAnswer({ kind: 'credentials', action: 'resume', values })}
        >
          {translate('apiClient.testRun.pause.resume', 'Resume')}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => onAnswer({ kind: 'credentials', action: 'stop' })}
        >
          {translate('apiClient.testRun.pause.stop', 'Stop')}
        </Button>
      </div>
    </div>
  )
}
