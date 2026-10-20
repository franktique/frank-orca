import type { CommandSpec } from '../args'
import { GLOBAL_FLAGS } from '../args'

export const EXPLANATION_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['explain', 'publish'],
    summary: 'Publish an explanation of the workspace changes from a JSON payload on stdin',
    usage: 'orca explain publish --input-stdin [--agent <name>] [--worktree <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'worktree', 'agent', 'input-stdin']
  },
  {
    path: ['explain', 'show'],
    summary: 'Show the agent explanation published for a workspace',
    usage: 'orca explain show [--worktree <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'worktree']
  },
  {
    path: ['explain', 'clear'],
    summary: 'Remove the agent explanation and its questions for a workspace',
    usage: 'orca explain clear [--worktree <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'worktree']
  },
  {
    path: ['explain', 'changes'],
    summary: 'Show the workspace change set agent explanations anchor against',
    usage: 'orca explain changes [--worktree <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'worktree']
  },
  {
    path: ['explain', 'schema'],
    summary: 'Print the explanation publish payload JSON Schema',
    usage: 'orca explain schema [--json]',
    allowedFlags: [...GLOBAL_FLAGS]
  }
]
