import type { CommandSpec } from '../args'
import { GLOBAL_FLAGS } from '../args'

export const SQL_CLIENT_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['sql', 'connections'],
    summary: 'List the project’s SQL connections (passwords are never shown)',
    usage: 'orca sql connections [--worktree <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'worktree']
  },
  {
    path: ['sql', 'queries'],
    summary: 'List the project’s saved SQL queries and collections',
    usage: 'orca sql queries [--connection <id|name>] [--worktree <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'worktree', 'connection']
  },
  {
    path: ['sql', 'run'],
    summary:
      'Run SQL on a saved connection (any statement on local hosts, read-only elsewhere) and print the result',
    usage:
      'orca sql run --connection <id|name> (--sql <text> | --file <path> | --query <savedQueryId|name> | < stdin) [--timeout <seconds>] [--worktree <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'worktree', 'connection', 'sql', 'file', 'query', 'timeout']
  }
]
