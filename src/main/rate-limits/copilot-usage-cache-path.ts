import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * Resolve the Copilot CLI's own user-cache file, which carries the quota
 * snapshot VS Code's Copilot popup shows. Orca never writes this file; the
 * CLI refreshes it whenever it runs.
 */
export function resolveCopilotUsageCachePath(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  homeDir: string = homedir()
): string {
  if (platform === 'darwin') {
    // Verified against a real Copilot CLI install (2026-09-17).
    return join(homeDir, 'Library', 'Caches', 'copilot', 'copilot-user-cache.json')
  }
  if (platform === 'win32') {
    // UNVERIFIED — best-guess %LOCALAPPDATA% convention; confirm against a real
    // Windows Copilot CLI install. A wrong path resolves to `unavailable`.
    const localAppData = env.LOCALAPPDATA?.trim()
    return join(
      localAppData || join(homeDir, 'AppData', 'Local'),
      'copilot',
      'copilot-user-cache.json'
    )
  }
  // UNVERIFIED — best-guess XDG convention; confirm against a real Linux
  // Copilot CLI install. A wrong path resolves to `unavailable`.
  const xdgCache = env.XDG_CACHE_HOME?.trim()
  return join(xdgCache || join(homeDir, '.cache'), 'copilot', 'copilot-user-cache.json')
}
