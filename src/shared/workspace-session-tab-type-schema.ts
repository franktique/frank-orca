import { z } from 'zod'

export const tabContentTypeSchema = z.enum([
  'terminal',
  'editor',
  'diff',
  'conflict-review',
  'check-details',
  'agent-session',
  'browser',
  'simulator',
  'api-client',
  'sql'
])

export const workspaceVisibleTabTypeSchema = z.enum([
  'terminal',
  'editor',
  'agent-session',
  'browser',
  'simulator',
  'api-client',
  'sql'
])
