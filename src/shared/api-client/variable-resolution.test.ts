import { describe, expect, it } from 'vitest'
import {
  buildScopeChain,
  resolveTemplate,
  type DynamicVariableSource,
  type VariableScope
} from './variable-resolution'

const source: DynamicVariableSource = {
  uuid: () => '00000000-0000-4000-8000-000000000000',
  nowMs: () => 1_700_000_000_123,
  randomInt: () => 42
}

const v = (key: string, value: string | null, enabled = true) => ({ key, value, enabled })

describe('resolveTemplate', () => {
  it('prefers script → environment → inner folder → outer folder → collection', () => {
    const scopes = buildScopeChain({
      scriptVariables: [v('who', 'script')],
      environment: [v('who', 'env'), v('envOnly', 'E')],
      folders: [
        { name: 'outer', variables: [v('who', 'outer'), v('outerOnly', 'O')] },
        { name: 'inner', variables: [v('who', 'inner'), v('innerOnly', 'I')] }
      ],
      collection: [v('who', 'collection'), v('collectionOnly', 'C')]
    })
    expect(resolveTemplate('{{who}}', scopes).text).toBe('script')
    expect(
      resolveTemplate('{{envOnly}}{{innerOnly}}{{outerOnly}}{{collectionOnly}}', scopes).text
    ).toBe('EIOC')
    const withoutScript = buildScopeChain({
      folders: [
        { name: 'outer', variables: [v('who', 'outer')] },
        { name: 'inner', variables: [v('who', 'inner')] }
      ],
      collection: [v('who', 'collection')]
    })
    expect(resolveTemplate('{{who}}', withoutScript).text).toBe('inner')
  })

  it('ignores disabled variables and lets the last enabled duplicate win', () => {
    const scopes: VariableScope[] = [
      { name: 'env', variables: [v('a', 'first'), v('a', 'second'), v('a', 'disabled', false)] }
    ]
    expect(resolveTemplate('{{a}}', scopes).text).toBe('second')
    const onlyDisabled: VariableScope[] = [{ name: 'env', variables: [v('b', 'x', false)] }]
    expect(resolveTemplate('{{b}}', onlyDisabled).unresolved).toHaveLength(1)
  })

  it('tolerates whitespace inside the braces', () => {
    const scopes: VariableScope[] = [{ name: 'env', variables: [v('name', 'x')] }]
    expect(resolveTemplate('{{ name }}-{{name }}-{{ name}}', scopes).text).toBe('x-x-x')
  })

  it('leaves unknown names literal and reports their spans', () => {
    const scopes: VariableScope[] = [{ name: 'env', variables: [v('known', 'k')] }]
    const result = resolveTemplate('a {{known}} b {{missing}} c', scopes)
    expect(result.text).toBe('a k b {{missing}} c')
    expect(result.unresolved).toEqual([{ name: 'missing', start: 14, end: 25 }])
  })

  it('generates dynamic variables and leaves unknown $ names literal', () => {
    const result = resolveTemplate(
      '{{$guid}}|{{$timestamp}}|{{$isoTimestamp}}|{{$randomInt}}|{{$nope}}',
      [],
      source
    )
    expect(result.text).toBe(
      '00000000-0000-4000-8000-000000000000|1700000000|2023-11-14T22:13:20.123Z|42|{{$nope}}'
    )
    expect(result.unresolved.map((u) => u.name)).toEqual(['$nope'])
  })

  it('treats a secret that could not be decrypted as unresolved', () => {
    const scopes: VariableScope[] = [{ name: 'env', variables: [v('token', null)] }]
    expect(resolveTemplate('{{token}}', scopes).unresolved).toHaveLength(1)
  })

  it('resolves variables that reference other variables without looping forever', () => {
    const scopes: VariableScope[] = [
      {
        name: 'env',
        variables: [v('base', 'http://x'), v('url', '{{base}}/a'), v('loop', '{{loop}}')]
      }
    ]
    expect(resolveTemplate('{{url}}', scopes).text).toBe('http://x/a')
    expect(resolveTemplate('{{loop}}', scopes).text).toContain('{{loop}}')
  })
})
