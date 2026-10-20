import { describe, expect, it } from 'vitest'
import {
  captureFingerprint,
  hashSideContent
} from '../../../../../shared/agent-explanations/explanation-anchor-fingerprint'
import type { ExplanationSet } from '../../../../../shared/agent-explanations/explanation-types'
import { resolveExplanationFileItems } from './explanation-file-items'

const original = 'one\ntwo\nthree\nfour\n'

function setWith(content: string): ExplanationSet {
  const lines = content.split('\n')
  return {
    id: 'e',
    workspaceId: 'wt',
    revision: 1,
    producer: { agentName: 'a' },
    generatedAt: 1,
    changeSetBase: { kind: 'uncommitted-only', baseRef: null, mergeBase: 'abc', headOid: null },
    changes: [
      {
        index: 0,
        title: 'T',
        summary: '',
        files: [
          {
            path: 'a.ts',
            status: 'modified',
            position: 1,
            items: [
              {
                id: 'i',
                position: 1,
                text: 'x',
                anchor: {
                  side: 'new',
                  startLine: 3,
                  endLine: 3,
                  fingerprint: {
                    ...captureFingerprint(lines, 3, 3),
                    diffIdentity: hashSideContent(content)
                  }
                }
              }
            ]
          }
        ]
      }
    ],
    questions: [],
    publishWarnings: []
  }
}

const resolve = (current: string) =>
  resolveExplanationFileItems(setWith(original), 'a.ts', { original: '', modified: current })[0]

describe('resolveExplanationFileItems', () => {
  it('is fresh when the file is unchanged', () => {
    expect(resolve(original)).toMatchObject({ kind: 'line', state: 'fresh', line: 3 })
  })

  it('is outdated when the anchored lines moved', () => {
    expect(resolve(`new top\n${original}`)).toMatchObject({
      kind: 'line',
      state: 'outdated',
      line: 4
    })
  })

  it('is detached when the anchored code is gone', () => {
    expect(resolve('one\ntwo\nfour\n')).toMatchObject({ kind: 'detached', reason: 'detached' })
  })
})
