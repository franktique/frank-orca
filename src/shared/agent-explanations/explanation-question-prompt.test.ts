import { describe, expect, it } from 'vitest'
import { buildExplanationQuestionPrompt } from './explanation-question-prompt'
import type { ExplanationSet } from './explanation-types'

const set: ExplanationSet = {
  id: 'e1',
  workspaceId: 'wt',
  revision: 1,
  producer: { agentName: 'claude' },
  generatedAt: 1,
  changeSetBase: { kind: 'uncommitted-only', baseRef: null, mergeBase: 'abc', headOid: null },
  changes: [
    {
      index: 1,
      title: 'Retry on failure',
      summary: '',
      files: [
        {
          path: 'src/net.ts',
          status: 'modified',
          position: 2,
          items: [
            {
              id: 'line-item',
              position: 3,
              anchor: {
                side: 'new',
                startLine: 10,
                endLine: 12,
                fingerprint: { lines: ['retry(3)', 'wait()', 'go()'], before: [], after: [] }
              },
              text: 'Retries three times.\nThen gives up.'
            },
            { id: 'file-item', position: 4, anchor: { fileLevel: true }, text: 'Binary asset.' }
          ]
        }
      ]
    }
  ],
  questions: [],
  publishWarnings: []
}

describe('buildExplanationQuestionPrompt', () => {
  it('names the change, file, side, range, code, explanation and question', () => {
    const prompt = buildExplanationQuestionPrompt(set, {
      itemId: 'line-item',
      body: 'Why three?'
    })
    expect(prompt).toContain('B2.3')
    expect(prompt).toContain('"Retry on failure"')
    expect(prompt).toContain('src/net.ts, lines 10-12 of the updated version')
    expect(prompt).toContain('```\nretry(3)\nwait()\ngo()\n```')
    expect(prompt).toContain('> Retries three times.\n> Then gives up.')
    expect(prompt?.endsWith('My question:\nWhy three?')).toBe(true)
  })

  it('describes a file-level item without code lines', () => {
    const prompt = buildExplanationQuestionPrompt(set, { itemId: 'file-item', body: 'Why?' })
    expect(prompt).toContain('the file as a whole (src/net.ts)')
    expect(prompt).not.toContain('```')
  })

  it('returns null when the item is gone', () => {
    expect(buildExplanationQuestionPrompt(set, { itemId: 'nope', body: 'x' })).toBeNull()
  })
})
