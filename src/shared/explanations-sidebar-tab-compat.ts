import { AGENT_EXPLANATIONS_RUNTIME_CAPABILITY, type RuntimeCapability } from './protocol-version'

// Hosts and clients update independently, and ui.set rejects an unknown tab id outright,
// so the Explanations tab is sent as Source Control to peers that predate the capability.
export function downlevelExplanationsSidebarTab<T extends { rightSidebarTab?: string }>(
  ui: T,
  peerCapabilities: readonly RuntimeCapability[] | undefined
): T {
  if (
    ui.rightSidebarTab !== 'explanations' ||
    peerCapabilities?.includes(AGENT_EXPLANATIONS_RUNTIME_CAPABILITY)
  ) {
    return ui
  }
  return { ...ui, rightSidebarTab: 'source-control' }
}
