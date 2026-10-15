import { describe, expect, it } from 'vitest'
import { quotePgIdentifier, quoteQualifiedName } from './pg-identifier-quoting'

describe('quotePgIdentifier', () => {
  it.each(['cases', 'surgical_case', '_hidden', 'a1', 'price$', 'wide_rows'])(
    'leaves %s bare',
    (name) => {
      expect(quotePgIdentifier(name)).toBe(name)
    }
  )

  it.each([
    ['SurgicalCase', '"SurgicalCase"'],
    ['has space', '"has space"'],
    ['1starts_with_digit', '"1starts_with_digit"'],
    ['café', '"café"'],
    ['', '""'],
    ['dash-ed', '"dash-ed"']
  ])('quotes %s', (name, expected) => {
    expect(quotePgIdentifier(name)).toBe(expected)
  })

  it('doubles embedded double quotes', () => {
    expect(quotePgIdentifier('say "hi"')).toBe('"say ""hi"""')
  })

  it.each(['user', 'order', 'select', 'table', 'group', 'limit', 'left', 'join', 'time', 'int'])(
    'quotes the keyword %s',
    (name) => {
      expect(quotePgIdentifier(name)).toBe(`"${name}"`)
    }
  )

  it('is case-sensitive about keywords only for lower-case input', () => {
    // Upper-case never matches the bare pattern, so it is quoted anyway.
    expect(quotePgIdentifier('SELECT')).toBe('"SELECT"')
  })
})

describe('quoteQualifiedName', () => {
  it('quotes each part and joins with dots', () => {
    expect(quoteQualifiedName('CaseManagement', 'SurgicalCase')).toBe(
      '"CaseManagement"."SurgicalCase"'
    )
    expect(quoteQualifiedName('public', 'users')).toBe('public.users')
    expect(quoteQualifiedName('public', 'user')).toBe('public."user"')
  })

  it('accepts a column as a third part', () => {
    expect(quoteQualifiedName('public', 'cases', 'Id')).toBe('public.cases."Id"')
  })
})
