import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  TAB_CREATE_MENU_QUERY_MAX_BYTES,
  buildTabCreateMenuOptions,
  findMatchingTabCreateMenuOptions,
  isTabCreateMenuQueryTooLarge,
  type TabCreateMenuOption
} from './tab-create-menu-options'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('tab create menu options', () => {
  const defaultOptions = buildTabCreateMenuOptions({
    terminalOnly: false,
    hasNewBrowser: true,
    hasNewMarkdown: true,
    hasOpenMarkdown: true,
    hasApiClient: false,
    hasSimulator: true,
    simulatorIsGoTo: false
  })

  it('matches mobile emulator aliases to the simulator menu action', () => {
    expect(
      findMatchingTabCreateMenuOptions('mobile emulator', defaultOptions).map(
        (option) => option.kind
      )
    ).toEqual(['new-simulator'])
  })

  it('matches go-to simulator when the workspace already has one', () => {
    const options = buildTabCreateMenuOptions({
      terminalOnly: false,
      hasNewBrowser: true,
      hasNewMarkdown: true,
      hasOpenMarkdown: false,
      hasApiClient: false,
      hasSimulator: true,
      simulatorIsGoTo: true
    })

    expect(
      findMatchingTabCreateMenuOptions('simulator', options).map((option) => option.kind)
    ).toEqual(['go-to-simulator'])
  })

  it('matches terminal and browser quick actions', () => {
    expect(
      findMatchingTabCreateMenuOptions('new terminal', defaultOptions).map((option) => option.kind)
    ).toEqual(['new-terminal'])
    expect(
      findMatchingTabCreateMenuOptions('browser', defaultOptions).map((option) => option.kind)
    ).toEqual(['new-browser'])
  })

  it('keeps terminal and markdown results when client-impossible actions are omitted', () => {
    const options = buildTabCreateMenuOptions({
      terminalOnly: false,
      hasNewBrowser: false,
      hasNewMarkdown: true,
      hasOpenMarkdown: true,
      hasApiClient: false,
      hasSimulator: false,
      simulatorIsGoTo: false
    })

    expect(options.map((option) => option.kind)).toEqual([
      'new-terminal',
      'new-markdown',
      'open-markdown'
    ])
    expect(findMatchingTabCreateMenuOptions('browser', options)).toEqual([])
    expect(findMatchingTabCreateMenuOptions('mobile emulator', options)).toEqual([])
  })

  it('preserves default Windows shell order for tied terminal matches', () => {
    const options = buildTabCreateMenuOptions({
      terminalOnly: false,
      hasNewBrowser: false,
      hasNewMarkdown: false,
      hasOpenMarkdown: false,
      hasApiClient: false,
      hasSimulator: false,
      simulatorIsGoTo: false,
      windowsShellEntries: [
        { label: 'PowerShell', shell: 'powershell.exe' },
        { label: 'CMD Prompt', shell: 'cmd.exe' }
      ]
    })

    expect(
      findMatchingTabCreateMenuOptions('new terminal', options).map((option) => option.shell)
    ).toEqual(['powershell.exe', 'cmd.exe'])
  })

  it('returns no matches for an empty query', () => {
    expect(findMatchingTabCreateMenuOptions('', defaultOptions)).toEqual([])
    expect(findMatchingTabCreateMenuOptions('   ', defaultOptions)).toEqual([])
  })

  it('matches accepted pasted queries without whitespace regex replacement', () => {
    const replace = vi.spyOn(String.prototype, 'replace')
    const nonBreakingSpace = String.fromCharCode(160)
    const query = ['\tnew', nonBreakingSpace, '  terminal\n'].join('')

    expect(
      findMatchingTabCreateMenuOptions(query, defaultOptions).map((option) => option.kind)
    ).toEqual(['new-terminal'])
    expect(
      replace.mock.calls.filter(
        ([pattern]) => pattern instanceof RegExp && pattern.source === '\\s+'
      )
    ).toHaveLength(0)
  })

  it('rejects oversized pasted queries before scoring menu options', () => {
    const oversizedQuery = 'secret-tab-create-menu'.repeat(TAB_CREATE_MENU_QUERY_MAX_BYTES)
    const option = {
      id: 'new-terminal',
      kind: 'new-terminal',
      get label(): string {
        throw new Error('oversized tab-create menu queries must not scan labels')
      },
      get keywords(): readonly string[] {
        throw new Error('oversized tab-create menu queries must not scan keywords')
      }
    } as TabCreateMenuOption

    expect(isTabCreateMenuQueryTooLarge(oversizedQuery)).toBe(true)
    expect(findMatchingTabCreateMenuOptions(oversizedQuery, [option])).toEqual([])
  })

  it('offers a New API Client entry only when the workspace allows it', () => {
    const base = {
      terminalOnly: false,
      hasNewBrowser: false,
      hasNewMarkdown: false,
      hasOpenMarkdown: false,
      hasSimulator: false,
      simulatorIsGoTo: false
    }
    const enabled = buildTabCreateMenuOptions({ ...base, hasApiClient: true })
    const disabled = buildTabCreateMenuOptions({ ...base, hasApiClient: false })

    expect(enabled.map((option) => option.kind)).toContain('new-api-client')
    expect(disabled.map((option) => option.kind)).not.toContain('new-api-client')
    expect(
      findMatchingTabCreateMenuOptions('postman', enabled).map((option) => option.kind)
    ).toEqual(['new-api-client'])
  })
})
