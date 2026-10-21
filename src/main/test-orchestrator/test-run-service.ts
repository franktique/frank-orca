// Run-side of the test orchestrator service: setup, start, stop, pauses, results (US1).
import type { ApiNodeId } from '../../shared/api-client/api-client-types'
import type { RunSetupModel } from '../../preload/api/test-run-api'
import type {
  answerPauseParamsSchema,
  clearRememberedSecretsParamsSchema,
  forgetCapturesParamsSchema,
  getRunParamsSchema,
  getStepDetailParamsSchema,
  prepareParamsSchema,
  resolveTargetsParamsSchema,
  startRunParamsSchema,
  stopRunParamsSchema,
  testDatabaseParamsSchema
} from '../../shared/test-orchestrator/test-orchestrator-ipc-schemas'
import type { StepResult, TestRun } from '../../shared/test-orchestrator/test-orchestrator-types'
import { lateEvidenceCapture, type EvidenceCaptureSlot } from './late-evidence-capture'
import { TestRunOrchestrator } from './test-run-orchestrator'
import type { StepEvidenceCapture } from './test-run-step-executor'
import { resolvePlanContext, type PlanContext } from './test-run-plan-context'
import {
  failure,
  type Failure,
  type Params,
  type QueryHooksResult,
  type TestRunRuntime,
  type TestRunServiceDeps
} from './test-run-service-types'
import {
  buildSetupModel,
  mergeRememberedInputs,
  saveRememberChoices,
  toRunDatabaseMode
} from './test-run-setup'
import { checkRunStart, resolveTargets } from './test-run-start-checks'

const planKey = (worktreeId: string, collectionId: string): string =>
  `${worktreeId}\u0000${collectionId}`

export class TestRunService {
  private orchestrator: TestRunOrchestrator | null = null
  private readonly captureSlots = new Map<string, EvidenceCaptureSlot>()
  private readonly runTargets = new Map<string, { worktreeId: string; collectionId: ApiNodeId }>()

  constructor(private readonly deps: TestRunServiceDeps) {}

  private getOrchestrator(): TestRunOrchestrator {
    const { runtime } = this.deps
    if (!runtime) {
      throw new Error('Test runs are not available in this process.')
    }
    this.orchestrator ??= new TestRunOrchestrator({
      sendRequest: runtime.sendRequest,
      emit: runtime.emit,
      openEvidence: runtime.openEvidence && this.openEvidenceWithCapture(runtime.openEvidence),
      store: this.deps.store,
      now: runtime.now,
      changedThrottleMs: runtime.changedThrottleMs
    })
    return this.orchestrator
  }

  private openEvidenceWithCapture(
    open: NonNullable<TestRunRuntime['openEvidence']>
  ): NonNullable<TestRunRuntime['openEvidence']> {
    return async (run, input) => {
      const sink = await open(run, input)
      const slot = this.captureSlots.get(planKey(input.worktreeId, input.collectionId))
      if (slot) {
        slot.current = sink.capture
      }
      return sink
    }
  }

  private async loadContext(
    worktreeId: string,
    collectionId: ApiNodeId,
    environmentId: ApiNodeId,
    approvedStepIds?: ReadonlySet<string>
  ): Promise<{ ok: true; context: PlanContext } | Failure> {
    const state = await this.deps.apiClient.store.getState(worktreeId)
    const resolved = resolvePlanContext({
      state,
      collectionId,
      environmentId,
      testMap: await this.deps.getTestMap(worktreeId, collectionId),
      approvedStepIds
    })
    return resolved.ok ? resolved : failure('not-found', resolved.message)
  }

  async prepare(
    params: Params<typeof prepareParamsSchema>
  ): Promise<{ ok: true; setup: RunSetupModel } | Failure> {
    const { worktreeId, collectionId, environmentId } = params
    const loaded = await this.loadContext(worktreeId, collectionId, environmentId)
    if (!loaded.ok) {
      return loaded
    }
    const remembered = await this.deps.store.getPlanSettings(worktreeId, collectionId)
    const uncleaned = await this.deps.store.ledger.listUncleaned(worktreeId, collectionId)
    return {
      ok: true,
      setup: buildSetupModel({
        context: loaded.context,
        settings: remembered.value,
        unavailableSecretInputs: remembered.unavailableSecretInputs,
        uncleanedCaptures: uncleaned.length,
        activeRunId: this.orchestrator?.activeRunId(worktreeId, collectionId) ?? null
      })
    }
  }

  async resolveTargets(params: Params<typeof resolveTargetsParamsSchema>) {
    const { worktreeId, collectionId, environmentId } = params
    const loaded = await this.loadContext(worktreeId, collectionId, environmentId)
    if (!loaded.ok) {
      return loaded
    }
    const remembered = await this.deps.store.getPlanSettings(worktreeId, collectionId)
    const targets = resolveTargets(
      loaded.context,
      mergeRememberedInputs(remembered.value, params.inputs)
    )
    return {
      ok: true as const,
      hosts: targets.hosts,
      unresolved: targets.unresolved,
      ...(targets.refused ? { refused: targets.refused } : {})
    }
  }

  async clearRememberedSecrets(
    params: Params<typeof clearRememberedSecretsParamsSchema>
  ): Promise<{ ok: true }> {
    const { worktreeId, collectionId } = params
    const { value } = await this.deps.store.getPlanSettings(worktreeId, collectionId)
    if (value && Object.keys(value.secretInputs).length > 0) {
      await this.deps.store.savePlanSettings(worktreeId, collectionId, {
        ...value,
        secretInputs: {}
      })
    }
    return { ok: true }
  }

  async start(
    params: Params<typeof startRunParamsSchema>
  ): Promise<{ ok: true; runId: string } | Failure> {
    const { worktreeId, collectionId, environmentId } = params
    const orchestrator = this.getOrchestrator()
    if (orchestrator.activeRunId(worktreeId, collectionId)) {
      return failure('busy', 'A test run is already active for this plan.')
    }
    const loaded = await this.loadContext(
      worktreeId,
      collectionId,
      environmentId,
      new Set(params.approvedDataChanges)
    )
    if (!loaded.ok) {
      return loaded
    }
    const { context } = loaded
    const remembered = await this.deps.store.getPlanSettings(worktreeId, collectionId)
    const effective = mergeRememberedInputs(remembered.value, params.inputs)
    const checked = checkRunStart(context, effective, params.confirmedHosts)
    if (!checked.ok) {
      return checked
    }
    const slotKey = planKey(worktreeId, collectionId)
    const slot: EvidenceCaptureSlot = {}
    this.captureSlots.set(slotKey, slot)
    const release = async (prepared: QueryHooksResult): Promise<void> => {
      this.captureSlots.delete(slotKey)
      await prepared.dispose?.().catch(() => undefined)
    }
    const prepared = await this.prepareHooks(params, context, lateEvidenceCapture(slot))
    if (!prepared.ok) {
      this.captureSlots.delete(slotKey)
      return prepared
    }
    await saveRememberChoices(this.deps.store, worktreeId, remembered.readOnly, {
      existing: remembered.value,
      collectionId,
      environmentId,
      inputs: checked.inputs,
      effective,
      remember: params.remember,
      databaseMode: params.database ?? undefined
    })

    const cleanupOnly = params.kind === 'cleanup-only'
    const result = orchestrator.start({
      worktreeId,
      collectionId,
      environmentId,
      kind: params.kind,
      // Why: cleanup-only skips every other phase; the cleanup-only flow (US7) fills in the ledger side.
      steps: cleanupOnly ? context.steps.filter((step) => step.phase === 'cleanup') : context.steps,
      testMap: context.testMap,
      environment: context.environment,
      collectionVariables: context.collection.variables,
      inputs: checked.inputs.map(({ name, value, secret }) => ({
        name,
        value: effective[name] ?? value,
        secret
      })),
      targetHosts: checked.hosts,
      databaseMode: toRunDatabaseMode(params.database, prepared.connectionName),
      planName: context.collection.name,
      hooks: prepared.hooks
    })
    if (!result.ok) {
      await release(prepared)
      return failure(result.code, result.message)
    }
    this.runTargets.set(result.runId, { worktreeId, collectionId })
    void result.finished.finally(() => {
      this.runTargets.delete(result.runId)
      return release(prepared)
    })
    return { ok: true, runId: result.runId }
  }

  private async prepareHooks(
    params: Params<typeof startRunParamsSchema>,
    context: PlanContext,
    capture: StepEvidenceCapture
  ): Promise<QueryHooksResult | Failure> {
    const create = this.deps.runtime?.createQueryHooks
    if (!create) {
      return { ok: true }
    }
    return create({
      worktreeId: params.worktreeId,
      collectionId: params.collectionId,
      context,
      database: params.database,
      browserPageId: params.browserPageId,
      capture
    })
  }

  async testDatabase(
    params: Params<typeof testDatabaseParamsSchema>
  ): Promise<{ ok: true } | Failure> {
    const check = this.deps.runtime?.testDatabase
    return check ? check(params) : failure('not-found', 'Database checks are not available.')
  }

  async forgetCaptures(
    params: Params<typeof forgetCapturesParamsSchema>
  ): Promise<{ ok: true } | Failure> {
    const { worktreeId, collectionId } = params
    // Why: an active run may still be appending to the ledger it would be forgetting.
    if (this.orchestrator?.activeRunId(worktreeId, collectionId)) {
      return failure('busy', 'A test run is active for this plan.')
    }
    await this.deps.store.ledger.forget(worktreeId, collectionId)
    return { ok: true }
  }

  stop(params: Params<typeof stopRunParamsSchema>): { ok: true } | Failure {
    const target = this.runTargets.get(params.runId)
    if (!target || target.worktreeId !== params.worktreeId) {
      return failure('not-found', 'That run is no longer active.')
    }
    this.getOrchestrator().stop(target.worktreeId, target.collectionId)
    return { ok: true }
  }

  answerPause(params: Params<typeof answerPauseParamsSchema>): { ok: true } | Failure {
    const target = this.runTargets.get(params.runId)
    if (!target || target.worktreeId !== params.worktreeId) {
      return failure('no-pause', 'That pause is no longer waiting.')
    }
    const answered = this.getOrchestrator().answerPause(
      target.worktreeId,
      target.collectionId,
      params.pauseId,
      params.answer
    )
    return answered.ok ? { ok: true } : failure(answered.code, answered.message)
  }

  /** The live run if one is active, otherwise the latest stored run. */
  async getRun(params: Params<typeof getRunParamsSchema>): Promise<TestRun | null> {
    const { worktreeId, collectionId } = params
    const live = this.orchestrator?.getRun(worktreeId, collectionId)
    return live ?? (await this.deps.store.getRun(worktreeId, collectionId)).value
  }

  async getStepDetail(
    params: Params<typeof getStepDetailParamsSchema>
  ): Promise<{ ok: true; step: StepResult } | Failure> {
    const run = await this.getRun(params)
    const step = run?.id === params.runId ? run.steps[params.stepIndex] : undefined
    return step ? { ok: true, step } : failure('not-found', 'That step is no longer available.')
  }
}
