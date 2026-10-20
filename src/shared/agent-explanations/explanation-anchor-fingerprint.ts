import type { AnchorFingerprint, LineAnchor, ResolvedAnchor } from './explanation-types'

// Context captured around an anchor (research R5): up to 2 lines above and
// below, trailing whitespace trimmed.
const CONTEXT_LINES = 2

function normalizeLine(line: string): string {
  return line.replace(/\s+$/, '')
}

function splitSideContent(text: string): string[] {
  return text.replace(/\r\n?/g, '\n').split('\n')
}

export function captureFingerprint(
  sideLines: string[],
  startLine: number,
  endLine: number
): AnchorFingerprint {
  // startLine/endLine are 1-based inclusive.
  const first = startLine - 1
  const lastExclusive = endLine
  const beforeStart = Math.max(0, first - CONTEXT_LINES)
  const afterEnd = Math.min(sideLines.length, lastExclusive + CONTEXT_LINES)
  return {
    lines: sideLines.slice(first, lastExclusive).map(normalizeLine),
    before: sideLines.slice(beforeStart, first).map(normalizeLine),
    after: sideLines.slice(lastExclusive, afterEnd).map(normalizeLine)
  }
}

// diffIdentity fast path (data-model.md): a pure synchronous FNV-1a over the
// \n-normalized text plus its line count, so main and renderer can share it
// with no crypto dependency.
export function hashSideContent(text: string): string {
  const normalized = text.replace(/\r\n?/g, '\n')
  const lineCount = normalized === '' ? 1 : normalized.split('\n').length
  let hash = 0x811c9dc5
  for (let i = 0; i < normalized.length; i++) {
    hash ^= normalized.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  const hex = (hash >>> 0).toString(16).padStart(8, '0')
  return `fnv1a:${hex}:${lineCount}`
}

function whitespaceNormalized(lines: string[]): string {
  return lines.map((line) => line.trim()).join('\n')
}

function exactMatches(sideLines: string[], wanted: string[]): number[] {
  const matches: number[] = []
  if (wanted.length === 0) {
    return matches
  }
  for (let i = 0; i + wanted.length <= sideLines.length; i++) {
    let matched = true
    for (let j = 0; j < wanted.length; j++) {
      if (normalizeLine(sideLines[i + j]) !== wanted[j]) {
        matched = false
        break
      }
    }
    if (matched) {
      matches.push(i)
    }
  }
  return matches
}

function contextScore(
  sideLines: string[],
  matchStart: number,
  wanted: string[],
  context: string[],
  contextAfter: boolean
): number {
  // Higher is closer: how many context lines line up around this match.
  let score = 0
  if (contextAfter) {
    for (let i = 0; i < context.length; i++) {
      const sideLine = sideLines[matchStart + wanted.length + i]
      if (sideLine === undefined) {
        break
      }
      if (normalizeLine(sideLine) !== context[i]) {
        break
      }
      score++
    }
  } else {
    for (let i = 0; i < context.length; i++) {
      const sideLine = sideLines[matchStart - 1 - i]
      if (sideLine === undefined) {
        break
      }
      if (normalizeLine(sideLine) !== context[context.length - 1 - i]) {
        break
      }
      score++
    }
  }
  return score
}

function pickNearest(
  sideLines: string[],
  matches: number[],
  fingerprint: AnchorFingerprint,
  originalStartLine: number
): number {
  if (matches.length === 1) {
    return matches[0]
  }
  let best = matches[0]
  let bestScore = -Infinity
  for (const start of matches) {
    const score =
      contextScore(sideLines, start, fingerprint.lines, fingerprint.before, false) * 2 +
      contextScore(sideLines, start, fingerprint.lines, fingerprint.after, true) * 2
    // Context decides; ties go to the match closest to the original position.
    const distance = Math.abs(start + 1 - originalStartLine)
    if (
      score > bestScore ||
      (score === bestScore && distance < Math.abs(best + 1 - originalStartLine))
    ) {
      bestScore = score
      best = start
    }
  }
  return best
}

// Relocation order (research R5): same diffIdentity or same lines → fresh;
// exact block match → nearest with context tie-break → outdated;
// whitespace-normalized match → outdated; else detached.
export function relocateAnchor(
  anchor: LineAnchor,
  currentSideContent: string,
  diffIdentity?: string
): ResolvedAnchor {
  const wantedLength = anchor.endLine - anchor.startLine + 1
  const currentLines = splitSideContent(currentSideContent)

  if (
    anchor.fingerprint.diffIdentity !== undefined &&
    diffIdentity !== undefined &&
    anchor.fingerprint.diffIdentity === diffIdentity
  ) {
    return { state: 'fresh', line: anchor.startLine, endLine: anchor.endLine }
  }

  const anchored = currentLines.slice(anchor.startLine - 1, anchor.startLine - 1 + wantedLength)
  if (
    anchored.length === wantedLength &&
    anchored.every((line, i) => normalizeLine(line) === anchor.fingerprint.lines[i])
  ) {
    return { state: 'fresh', line: anchor.startLine, endLine: anchor.endLine }
  }

  const wanted = anchor.fingerprint.lines
  if (wanted.length === 0) {
    return { state: 'detached' }
  }

  const matches = exactMatches(currentLines, wanted)
  if (matches.length > 0) {
    const start = pickNearest(currentLines, matches, anchor.fingerprint, anchor.startLine)
    return { state: 'outdated', line: start + 1, endLine: start + wantedLength }
  }

  const normalizedWanted = whitespaceNormalized(wanted)
  for (let i = 0; i + wanted.length <= currentLines.length; i++) {
    const candidate = whitespaceNormalized(currentLines.slice(i, i + wanted.length))
    if (candidate === normalizedWanted) {
      return { state: 'outdated', line: i + 1, endLine: i + wanted.length }
    }
  }

  return { state: 'detached' }
}
