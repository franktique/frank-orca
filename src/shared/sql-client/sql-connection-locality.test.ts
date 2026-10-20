import { describe, expect, it } from 'vitest'
import { getSqlAgentAccess } from './sql-connection-locality'

describe('getSqlAgentAccess', () => {
  it.each([
    'localhost',
    'LocalHost',
    '127.0.0.1',
    '127.1.2.3',
    '::1',
    '[::1]',
    '/var/run/postgresql'
  ])('%s is full', (host) => {
    expect(getSqlAgentAccess(host)).toBe('full')
  })

  it.each([
    '192.168.1.10',
    '10.0.0.5',
    '0.0.0.0',
    'host.docker.internal',
    'db.example.com',
    'C:\\pgsocket',
    '128.0.0.1',
    '127.0.0.1.example.com',
    '999.0.0.1'
  ])('%s is read-only', (host) => {
    expect(getSqlAgentAccess(host)).toBe('read-only')
  })
})
