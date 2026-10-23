import { useCallback, useEffect, useMemo, useState } from 'react'
import type { RunSetupModel } from '../../../../../preload/api/test-run-api'
import type {
  DatabaseModeChoice,
  RunKind
} from '../../../../../shared/test-orchestrator/test-orchestrator-types'
import {
  computeStartBlockers,
  nonLocalHosts,
  type ResolvedTargets,
  type StartBlocker
} from './test-run-start-readiness'

const RESOLVE_DEBOUNCE_MS = 300

export type TestRunSetupState = {
  setup: RunSetupModel | null
  loadError: string | null
  typed: Record<string, string>
  setTyped: (name: string, value: string) => void
  rememberInputs: boolean
  rememberSecrets: boolean
  setRememberInputs: (value: boolean) => void
  setRememberSecrets: (value: boolean) => void
  targets: ResolvedTargets | null
  confirmedHosts: string[]
  toggleHost: (host: string, confirmed: boolean) => void
  database: DatabaseModeChoice | null
  setDatabase: (choice: DatabaseModeChoice | null) => void
  approvedSteps: string[]
  toggleApproval: (stepId: string, approved: boolean) => void
  blockers: StartBlocker[]
  starting: boolean
  startError: string | null
  start: (kind: RunKind) => Promise<void>
  clearRememberedSecrets: () => Promise<void>
  reload: () => void
}

/** Prepare, target-resolution and start plumbing for the setup screen. */
export function useTestRunSetup(args: {
  worktreeId: string
  collectionId: string
  environmentId: string | null
  databaseModeAvailable: boolean
}): TestRunSetupState {
  const { worktreeId, collectionId, environmentId, databaseModeAvailable } = args
  const [setup, setSetup] = useState<RunSetupModel | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [reloadTick, setReloadTick] = useState(0)
  const [typed, setTypedValues] = useState<Record<string, string>>({})
  const [rememberInputs, setRememberInputs] = useState(true)
  const [rememberSecrets, setRememberSecrets] = useState(false)
  const [resolved, setResolved] = useState<{ key: string; targets: ResolvedTargets } | null>(null)
  const [confirmedHosts, setConfirmedHosts] = useState<string[]>([])
  const [database, setDatabase] = useState<DatabaseModeChoice | null>(null)
  const [approvedSteps, setApprovedSteps] = useState<string[]>([])
  const [starting, setStarting] = useState(false)
  const [startError, setStartError] = useState<string | null>(null)

  useEffect(() => {
    if (!environmentId) {
      setSetup(null)
      return
    }
    let cancelled = false
    void window.api.testRun.prepare({ worktreeId, collectionId, environmentId }).then((result) => {
      if (cancelled) {
        return
      }
      if (!result.ok) {
        setLoadError(result.message)
        return
      }
      setLoadError(null)
      setSetup(result.setup)
      // Why: only seed names the user has not typed into, so a refresh never overwrites edits.
      setTypedValues((current) => ({
        ...Object.fromEntries(
          result.setup.inputs
            .filter((input) => !input.secret && input.value)
            .map((input) => [input.name, input.value ?? ''])
        ),
        ...current
      }))
    })
    return () => {
      cancelled = true
    }
  }, [worktreeId, collectionId, environmentId, reloadTick])

  const filledInputs = useMemo(
    () => Object.fromEntries(Object.entries(typed).filter(([, value]) => value.trim() !== '')),
    [typed]
  )
  const resolveKey = useMemo(
    () => JSON.stringify([environmentId, filledInputs]),
    [environmentId, filledInputs]
  )

  useEffect(() => {
    if (!environmentId || !setup) {
      return
    }
    let cancelled = false
    const timer = setTimeout(() => {
      void window.api.testRun
        .resolveTargets({ worktreeId, collectionId, environmentId, inputs: filledInputs })
        .then((result) => {
          if (cancelled) {
            return
          }
          if (result.ok) {
            setResolved({ key: resolveKey, targets: result })
            const hosts = nonLocalHosts(result)
            setConfirmedHosts((current) => current.filter((host) => hosts.includes(host)))
          }
        })
    }, RESOLVE_DEBOUNCE_MS)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [worktreeId, collectionId, environmentId, setup, filledInputs, resolveKey])

  // Why: a result for older inputs must not unlock Start for the current ones.
  const targets = resolved?.key === resolveKey ? resolved.targets : null
  const blockers = useMemo(
    () =>
      computeStartBlockers({
        environmentId,
        inputs: setup?.inputs ?? [],
        typed,
        targets,
        confirmedHosts,
        needsDatabaseMode: databaseModeAvailable && Boolean(setup?.hasQueries),
        databaseChosen: database !== null
      }),
    [environmentId, setup, typed, targets, confirmedHosts, databaseModeAvailable, database]
  )

  const start = useCallback(
    async (kind: RunKind): Promise<void> => {
      if (!environmentId) {
        return
      }
      setStarting(true)
      setStartError(null)
      const result = await window.api.testRun.start({
        worktreeId,
        collectionId,
        environmentId,
        kind,
        inputs: filledInputs,
        remember: { inputs: rememberInputs, secrets: rememberSecrets },
        database: setup?.hasQueries ? database : null,
        confirmedHosts,
        approvedDataChanges: approvedSteps
      })
      setStarting(false)
      if (!result.ok) {
        setStartError(result.message)
      }
    },
    [
      worktreeId,
      collectionId,
      environmentId,
      filledInputs,
      rememberInputs,
      rememberSecrets,
      setup?.hasQueries,
      database,
      confirmedHosts,
      approvedSteps
    ]
  )

  return {
    setup,
    loadError,
    typed,
    setTyped: (name, value) => setTypedValues((current) => ({ ...current, [name]: value })),
    rememberInputs,
    rememberSecrets,
    setRememberInputs,
    setRememberSecrets,
    targets,
    confirmedHosts,
    toggleHost: (host, confirmed) =>
      setConfirmedHosts((current) =>
        confirmed ? [...new Set([...current, host])] : current.filter((entry) => entry !== host)
      ),
    database,
    setDatabase,
    approvedSteps,
    toggleApproval: (stepId, approved) =>
      setApprovedSteps((current) =>
        approved ? [...new Set([...current, stepId])] : current.filter((entry) => entry !== stepId)
      ),
    blockers,
    starting,
    startError,
    start,
    clearRememberedSecrets: async () => {
      await window.api.testRun.clearRememberedSecrets({ worktreeId, collectionId })
      setReloadTick((tick) => tick + 1)
    },
    reload: () => setReloadTick((tick) => tick + 1)
  }
}
