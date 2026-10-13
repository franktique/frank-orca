import type { ScriptInput, ScriptOutput } from './script-sandbox-types'

export type ScriptSandboxWorkerRequest = { id: number; input: ScriptInput }

export type ScriptSandboxWorkerResponse =
  | { id: number; ok: true; output: ScriptOutput }
  | { id: number; ok: false; error: string }
