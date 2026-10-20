import { describe, expect, it } from 'vitest'
import { downlevelExplanationsSidebarTab } from './explanations-sidebar-tab-compat'
import { AGENT_EXPLANATIONS_RUNTIME_CAPABILITY } from './protocol-version'

describe('downlevelExplanationsSidebarTab', () => {
  it('maps the explanations tab to source-control for peers without the capability', () => {
    expect(downlevelExplanationsSidebarTab({ rightSidebarTab: 'explanations' }, [])).toEqual({
      rightSidebarTab: 'source-control'
    })
    expect(downlevelExplanationsSidebarTab({ rightSidebarTab: 'explanations' }, undefined)).toEqual(
      { rightSidebarTab: 'source-control' }
    )
  })

  it('keeps the tab for peers that advertise the capability', () => {
    const ui = { rightSidebarTab: 'explanations' }
    expect(downlevelExplanationsSidebarTab(ui, [AGENT_EXPLANATIONS_RUNTIME_CAPABILITY])).toBe(ui)
  })

  it('leaves other tabs and absent tabs alone', () => {
    const ui = { rightSidebarTab: 'checks' }
    expect(downlevelExplanationsSidebarTab(ui, [])).toBe(ui)
    const empty = {}
    expect(downlevelExplanationsSidebarTab(empty, [])).toBe(empty)
  })
})
