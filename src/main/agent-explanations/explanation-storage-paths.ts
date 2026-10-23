/**
 * Storage layout for agent change explanations (specs/002): one JSON file per
 * workspace under `userData/agent-explanations/`, plus a `corrupt/` quarantine
 * dir. Mirrors src/main/api-client/api-client-storage-paths.ts.
 */
import { join } from 'node:path'
import { getAppEnvironment } from '../../shared/app-environment'
import { hashWorktreeId } from '../terminal-history-id'

export const EXPLANATION_CORRUPT_DIR_NAME = 'corrupt'

export function getExplanationRoot(): string {
  return join(getAppEnvironment().getPath('userData'), 'agent-explanations')
}

export type ExplanationWorkspacePaths = {
  root: string
  file: string
  corruptDir: string
  /** Quarantine name `<hash>-<ts>.json`; the caller owns the timestamp format. */
  corruptFile: (timestamp: number | string) => string
}

/** `root` is a parameter so tests can use a temp dir. */
export function getExplanationWorkspacePaths(
  workspaceId: string,
  root: string = getExplanationRoot()
): ExplanationWorkspacePaths {
  const hash = hashWorktreeId(workspaceId)
  return {
    root,
    file: join(root, `${hash}.json`),
    corruptDir: join(root, EXPLANATION_CORRUPT_DIR_NAME),
    corruptFile: (timestamp) =>
      join(root, EXPLANATION_CORRUPT_DIR_NAME, `${hash}-${timestamp}.json`)
  }
}
