import type { ApiNodeId } from '../../shared/api-client/api-client-types'
import type {
  TEST_RUN_ERROR_CODES,
  testMapChangedEventSchema,
  testRunChangedEventSchema,
  testRunFinishedEventSchema,
  testRunPausedEventSchema,
  answerPauseParamsSchema,
  exportTestMapParamsSchema,
  loadTestMapParamsSchema,
  resolveTargetsParamsSchema,
  saveQueriesParamsSchema,
  startRunParamsSchema,
  testDatabaseParamsSchema
} from '../../shared/test-orchestrator/test-orchestrator-ipc-schemas'
import type {
  Phase,
  StepResult,
  TestMap,
  TestMapIssue,
  TestMapRef,
  TestRun,
  VerificationQuery
} from '../../shared/test-orchestrator/test-orchestrator-types'
import type { z } from 'zod'

export type TestRunFailure = {
  ok: false
  code: (typeof TEST_RUN_ERROR_CODES)[number]
  message: string
  issues?: TestMapIssue[]
  screenshot?: string
}
export type TestRunResult<T extends object = object> = ({ ok: true } & T) | TestRunFailure

export type TestRunTarget = { worktreeId: string; collectionId: ApiNodeId }

export type TestMapLoadWarnings = {
  unmatched: TestMapRef[]
  ambiguous: { ref: TestMapRef; candidates: TestMapRef[] }[]
  unknownFields: string[]
}

export type RunSetupInput = {
  name: string
  secret: boolean
  required: boolean
  value?: string
  hasRemembered: boolean
}

export type RunSetupModel = {
  steps: {
    stepId: string
    title: string
    phase: Phase
    queries: VerificationQuery[]
    problems: string[]
  }[]
  inputs: RunSetupInput[]
  hasQueries: boolean
  dataChangingSteps: { stepId: string; queryIds: string[] }[]
  rememberedMode: string | null
  uncleanedCaptures: number
  activeRunId?: string
}

export type TestRunChangedEvent = z.infer<typeof testRunChangedEventSchema>
export type TestRunPausedEvent = z.infer<typeof testRunPausedEventSchema>
export type TestRunFinishedEvent = z.infer<typeof testRunFinishedEventSchema>
export type TestMapChangedEvent = z.infer<typeof testMapChangedEventSchema>

export type TestRunApi = {
  pickTestMapFile: () => Promise<{ filePath: string } | null>
  loadTestMap: (
    args: z.infer<typeof loadTestMapParamsSchema>
  ) => Promise<TestRunResult<{ map: TestMap; warnings: TestMapLoadWarnings }>>
  getTestMap: (args: TestRunTarget) => Promise<TestMap | null>
  saveQueries: (args: z.infer<typeof saveQueriesParamsSchema>) => Promise<TestRunResult>
  pickExportFile: (args: TestRunTarget) => Promise<{ filePath: string } | null>
  exportTestMap: (args: z.infer<typeof exportTestMapParamsSchema>) => Promise<TestRunResult>
  removeTestMap: (args: TestRunTarget) => Promise<TestRunResult>
  prepare: (
    args: TestRunTarget & { environmentId: ApiNodeId }
  ) => Promise<TestRunResult<{ setup: RunSetupModel }>>
  resolveTargets: (args: z.infer<typeof resolveTargetsParamsSchema>) => Promise<
    TestRunResult<{
      hosts: { host: string; local: boolean }[]
      unresolved: string[]
      refused?: { host: string; allowedHosts: string[] }
    }>
  >
  testDatabase: (args: z.infer<typeof testDatabaseParamsSchema>) => Promise<TestRunResult>
  listConsoleTabs: (args: {
    worktreeId: string
  }) => Promise<TestRunResult<{ tabs: { browserPageId: string; title: string; url: string }[] }>>
  clearRememberedSecrets: (args: TestRunTarget) => Promise<TestRunResult>
  start: (args: z.infer<typeof startRunParamsSchema>) => Promise<TestRunResult<{ runId: string }>>
  stop: (args: { worktreeId: string; runId: string }) => Promise<TestRunResult>
  answerPause: (args: z.infer<typeof answerPauseParamsSchema>) => Promise<TestRunResult>
  getRun: (args: TestRunTarget) => Promise<TestRun | null>
  getStepDetail: (
    args: TestRunTarget & { runId: string; stepIndex: number }
  ) => Promise<TestRunResult<{ step: StepResult }>>
  forgetCaptures: (args: TestRunTarget) => Promise<TestRunResult>
  onChanged: (callback: (event: TestRunChangedEvent) => void) => () => void
  onPaused: (callback: (event: TestRunPausedEvent) => void) => () => void
  onFinished: (callback: (event: TestRunFinishedEvent) => void) => () => void
  onTestMapChanged: (callback: (event: TestMapChangedEvent) => void) => () => void
}
