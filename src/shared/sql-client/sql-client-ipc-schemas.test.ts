import { describe, expect, it } from 'vitest'
import {
  connectionInputSchema,
  connectionUpdateInputSchema,
  sqlConnectionViewSchema,
  worktreeOnlyParamsSchema
} from './sql-client-ipc-schemas'

describe('sql client ipc schemas', () => {
  it('applies connection defaults', () => {
    const parsed = connectionInputSchema.parse({
      name: 'db',
      host: 'localhost',
      user: 'u',
      database: 'd',
      password: ''
    })
    expect(parsed.port).toBe(5432)
    expect(parsed.sslMode).toBe('prefer')
  })

  it('distinguishes an omitted password from a cleared one on update', () => {
    expect('password' in connectionUpdateInputSchema.parse({ name: 'x' })).toBe(false)
    expect(connectionUpdateInputSchema.parse({ password: '' }).password).toBe('')
  })

  it('rejects out-of-range ports', () => {
    expect(() =>
      connectionInputSchema.parse({
        name: 'a',
        host: 'h',
        user: 'u',
        database: 'd',
        port: 0,
        password: ''
      })
    ).toThrow()
  })

  it('requires a worktree id', () => {
    expect(worktreeOnlyParamsSchema.safeParse({}).success).toBe(false)
  })

  it('never accepts a password or cipher in a connection view', () => {
    const view = {
      id: 'c1',
      name: 'db',
      host: 'localhost',
      port: 5432,
      user: 'u',
      database: 'd',
      sslMode: 'prefer',
      createdAt: 't',
      updatedAt: 't',
      revision: 1,
      passwordState: 'set',
      agentAccess: 'full',
      status: { state: 'idle' }
    }
    expect(sqlConnectionViewSchema.safeParse(view).success).toBe(true)
    expect(sqlConnectionViewSchema.safeParse({ ...view, password: 'x' }).success).toBe(false)
    expect(sqlConnectionViewSchema.safeParse({ ...view, password: { cipher: 'x' } }).success).toBe(
      false
    )
    expect(sqlConnectionViewSchema.safeParse({ ...view, cipher: 'x' }).success).toBe(false)
  })
})
