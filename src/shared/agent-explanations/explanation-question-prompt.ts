import { itemLabel } from './explanation-labels'
import type { ExplanationSet, FollowUpQuestion } from './explanation-types'

/**
 * A self-contained prompt for the agent that wrote the explanation: it names the change and
 * file, quotes the code the explanation pointed at and the explanation itself, then asks.
 * Returns null when the question's item is no longer in the set.
 */
export function buildExplanationQuestionPrompt(
  set: ExplanationSet,
  question: Pick<FollowUpQuestion, 'itemId' | 'body'>
): string | null {
  for (const change of set.changes) {
    for (const file of change.files) {
      const item = file.items.find((candidate) => candidate.id === question.itemId)
      if (!item) {
        continue
      }
      const label = itemLabel(change.index, file.position, item.position)
      const lines = [
        `I have a question about your explanation ${label} ("${change.title}") of the changes in ${file.path}.`,
        ''
      ]
      if ('fileLevel' in item.anchor) {
        lines.push(`Where: the file as a whole (${file.path}).`)
      } else {
        const { side, startLine, endLine, fingerprint } = item.anchor
        const range = startLine === endLine ? `line ${startLine}` : `lines ${startLine}-${endLine}`
        lines.push(
          `Where: ${file.path}, ${range} of the ${side === 'old' ? 'original' : 'updated'} version.`
        )
        if (fingerprint.lines.length > 0) {
          lines.push(
            '',
            'The code your explanation pointed at:',
            '```',
            ...fingerprint.lines,
            '```'
          )
        }
      }
      lines.push('', 'Your explanation:', quote(item.text), '', 'My question:', question.body)
      return lines.join('\n')
    }
  }
  return null
}

function quote(text: string): string {
  return text
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n')
}
