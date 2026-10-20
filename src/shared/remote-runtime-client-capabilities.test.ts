import { describe, expect, it } from 'vitest'
import {
  AGENT_EXPLANATIONS_RUNTIME_CAPABILITY,
  RUNTIME_CAPABILITIES,
  type RuntimeCapability
} from './protocol-version'
import { remoteRuntimeClientCapabilities } from './remote-runtime-client-capabilities'

describe('remoteRuntimeClientCapabilities', () => {
  it('advertises agent-explanations.v1 so hosts do not treat new clients as old', () => {
    const capabilities: RuntimeCapability[] = remoteRuntimeClientCapabilities()
    expect(capabilities).toContain(AGENT_EXPLANATIONS_RUNTIME_CAPABILITY)
  })

  it('keeps additional capabilities alongside the built-in set without duplicates', () => {
    const extra = 'extra.capability.v1' as const
    const capabilities = remoteRuntimeClientCapabilities([extra])
    expect(capabilities.filter((capability) => capability === extra)).toHaveLength(1)
  })

  it('lists agent-explanations.v1 in RUNTIME_CAPABILITIES so hosts advertise it in getStatus', () => {
    expect(RUNTIME_CAPABILITIES).toContain(AGENT_EXPLANATIONS_RUNTIME_CAPABILITY)
  })
})
