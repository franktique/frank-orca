import { describe, expect, it } from 'vitest'
import { isLocalHost } from './host-locality'

describe('isLocalHost', () => {
  it.each([
    'localhost',
    'LocalHost',
    'api.localhost',
    '127.0.0.1',
    '127.1.2.3',
    '::1',
    '[::1]',
    '0:0:0:0:0:0:0:1',
    '::ffff:127.0.0.1',
    '0.0.0.0',
    ' localhost '
  ])('%s is local', (host) => {
    expect(isLocalHost(host)).toBe(true)
  })

  it.each([
    '192.168.1.10',
    '128.0.0.1',
    '127.0.0.1.example.com',
    '999.0.0.1',
    '127.0.0.256',
    'localhost.example.com',
    'host.docker.internal',
    'example.com',
    ''
  ])('%s is not local', (host) => {
    expect(isLocalHost(host)).toBe(false)
  })
})
