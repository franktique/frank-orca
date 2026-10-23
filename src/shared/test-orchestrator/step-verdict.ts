import type { ExecutionOutcome, TestResult } from '../api-client/api-client-types'
import type { Expectation, StepResultKind } from './test-orchestrator-types'

export type StepVerdict = {
  result: Extract<StepResultKind, 'pass' | 'fail'>
  reason?: string
  expectedText: string
  actualText: string
}

const DEFAULT_ERROR_CODE_PATHS = ['code', 'errorCode', 'error.code', 'errors[0].code']

function readJsonPath(root: unknown, path: string): unknown {
  let current: unknown = root
  for (const part of path.split('.')) {
    const match = /^([^[\]]*)((?:\[\d+\])*)$/.exec(part)
    if (!match) {
      return undefined
    }
    const [, key, indexes] = match
    if (key) {
      if (typeof current !== 'object' || current === null || Array.isArray(current)) {
        return undefined
      }
      current = Object.entries(current).find(([name]) => name === key)?.[1]
    }
    for (const index of indexes.matchAll(/\[(\d+)\]/g)) {
      if (!Array.isArray(current)) {
        return undefined
      }
      current = current[Number(index[1])]
    }
  }
  return current
}

function readErrorCode(bodyText: string | undefined, errorCodePath?: string): string | null {
  if (!bodyText) {
    return null
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(bodyText)
  } catch {
    return null
  }
  for (const path of errorCodePath ? [errorCodePath] : DEFAULT_ERROR_CODE_PATHS) {
    const value = readJsonPath(parsed, path)
    if (typeof value === 'string' || typeof value === 'number') {
      return String(value)
    }
  }
  return null
}

function expectedStatuses(expect: Expectation): number[] {
  return Array.isArray(expect.status) ? expect.status : [expect.status]
}

function expectedTextFor(expect: Expectation | undefined, tests: readonly TestResult[]): string {
  if (expect) {
    const status = expectedStatuses(expect).join(' / ')
    return expect.errorCode ? `${status} · ${expect.errorCode}` : status
  }
  return tests.length > 0 ? tests.map((test) => test.name).join(', ') : '2xx'
}

export function decideStepVerdict(input: {
  outcome: ExecutionOutcome
  tests: readonly TestResult[]
  expect?: Expectation
}): StepVerdict {
  const { outcome, tests, expect } = input
  const expectedText = expectedTextFor(expect, tests)

  if (outcome.kind === 'error') {
    return { result: 'fail', reason: outcome.message, expectedText, actualText: outcome.message }
  }

  const { response } = outcome
  const errorCode = expect?.errorCode
    ? readErrorCode(response.body.text, expect.errorCodePath)
    : null
  const actualText = errorCode ? `${response.status} · ${errorCode}` : String(response.status)

  const failedTests = tests.filter((test) => !test.passed)
  if (failedTests.length > 0) {
    return {
      result: 'fail',
      reason: `Failed tests: ${failedTests.map((test) => test.name).join(', ')}`,
      expectedText,
      actualText
    }
  }

  if (expect) {
    if (!expectedStatuses(expect).includes(response.status)) {
      return {
        result: 'fail',
        reason: `Expected status ${expectedStatuses(expect).join(' / ')}, got ${response.status}`,
        expectedText,
        actualText
      }
    }
    if (expect.errorCode && errorCode !== expect.errorCode) {
      return {
        result: 'fail',
        reason: `Expected error code ${expect.errorCode}, got ${errorCode ?? 'none'}`,
        expectedText,
        actualText
      }
    }
    return { result: 'pass', expectedText, actualText }
  }

  if (tests.length > 0 || (response.status >= 200 && response.status < 300)) {
    return { result: 'pass', expectedText, actualText }
  }
  return {
    result: 'fail',
    reason: `Expected a 2xx status, got ${response.status}`,
    expectedText,
    actualText
  }
}

function describeExpectation(expect: Expectation): string {
  const status = expectedStatuses(expect).join(' / ')
  return expect.errorCode ? `${status} · ${expect.errorCode}` : status
}

function describeOutcome(outcome: ExecutionOutcome, expect: Expectation | undefined): string {
  if (outcome.kind === 'error') {
    return outcome.message
  }
  const { response } = outcome
  const code = expect?.errorCode ? readErrorCode(response.body.text, expect.errorCodePath) : null
  return code ? `${response.status} · ${code}` : String(response.status)
}

function outcomeSatisfies(outcome: ExecutionOutcome, expect: Expectation): boolean {
  if (outcome.kind === 'error' || !expectedStatuses(expect).includes(outcome.response.status)) {
    return false
  }
  return (
    !expect.errorCode ||
    readErrorCode(outcome.response.body.text, expect.errorCodePath) === expect.errorCode
  )
}

/** Matches expectations to outcomes one-to-one in any order (augmenting-path bipartite matching). */
export function decideExpectAllVerdict(input: {
  expectAll: readonly Expectation[]
  outcomes: readonly ExecutionOutcome[]
}): StepVerdict {
  const { expectAll, outcomes } = input
  const expectedText = expectAll.map(describeExpectation).join(' + ')
  const matchedBy: (number | null)[] = outcomes.map(() => null)

  const assign = (expIndex: number, visited: Set<number>): boolean => {
    for (const [outIndex, outcome] of outcomes.entries()) {
      if (visited.has(outIndex) || !outcomeSatisfies(outcome, expectAll[expIndex])) {
        continue
      }
      visited.add(outIndex)
      const current = matchedBy[outIndex]
      if (current === null || assign(current, visited)) {
        matchedBy[outIndex] = expIndex
        return true
      }
    }
    return false
  }

  const unmatched = expectAll.filter((_, expIndex) => !assign(expIndex, new Set()))
  const actualText = outcomes
    .map((outcome, outIndex) => {
      const matched = matchedBy[outIndex]
      return describeOutcome(
        outcome,
        matched === null ? expectAll.find((e) => e.errorCode) : expectAll[matched]
      )
    })
    .join(' + ')

  if (outcomes.length !== expectAll.length) {
    return {
      result: 'fail',
      reason: `Expected ${expectAll.length} responses, got ${outcomes.length}`,
      expectedText,
      actualText
    }
  }
  if (unmatched.length > 0) {
    return {
      result: 'fail',
      reason: `No response matched: ${unmatched.map(describeExpectation).join(', ')}`,
      expectedText,
      actualText
    }
  }
  return { result: 'pass', expectedText, actualText }
}
