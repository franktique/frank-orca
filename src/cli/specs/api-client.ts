import type { CommandSpec } from '../args'
import { GLOBAL_FLAGS } from '../args'

export const API_CLIENT_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['api', 'list'],
    summary: 'List API Client collections, folders and requests with their ids',
    usage: 'orca api list [--worktree <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'worktree']
  },
  {
    path: ['api', 'envs'],
    summary: 'List API Client environments (secret values are masked)',
    usage: 'orca api envs [--worktree <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'worktree']
  },
  {
    path: ['api', 'run'],
    summary: 'Run an API Client request, folder or collection and print the results',
    usage:
      'orca api run <id> [--env <id|name|none>] [--iterations <n>] [--delay <ms>] [--stop-on-failure] [--timeout <ms>] [--full-body] [--worktree <selector>] [--json]',
    allowedFlags: [
      ...GLOBAL_FLAGS,
      'worktree',
      'id',
      'env',
      'iterations',
      'delay',
      'stop-on-failure',
      'timeout',
      'full-body'
    ],
    positionalArgs: ['id']
  },
  {
    path: ['api', 'result'],
    summary: 'Show the latest stored result of a request',
    usage: 'orca api result <requestId> [--full-body] [--worktree <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'worktree', 'requestId', 'full-body'],
    positionalArgs: ['requestId']
  },
  {
    path: ['api', 'show'],
    summary: 'Open a request in the API Client tab',
    usage: 'orca api show <requestId> [--worktree <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'worktree', 'requestId'],
    positionalArgs: ['requestId']
  }
]
