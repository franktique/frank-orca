import { getRegisteredSshState, listRegisteredSshTargets } from '../../../ssh/ssh-target-registry'
import { getPublicSshState } from '../../public-ssh-state'
import { defineMethod, defineStreamingMethod } from '../core'
import { ClientEventsUnsubscribeParams } from '../../../../shared/rpc-contract/client-events-params'
import { AGENT_EXPLANATIONS_RUNTIME_CAPABILITY } from '../../../../shared/protocol-version'

let clientEventSubscriptionSeq = 0

export const CLIENT_EVENT_METHODS = [
  defineStreamingMethod({
    name: 'runtime.clientEvents.subscribe',
    params: null,
    handler: async (_params, { runtime, connectionId, clientKind, clientCapabilities }, emit) => {
      await new Promise<void>((resolve) => {
        // Why: mobile discards terminalSideEffects; excluding it stops the
        // per-OSC batch frames from crossing the relay.
        const unsubscribe = runtime.onClientEvent(
          (event) => {
            // Why: clients that never advertised explanations cannot decode the event
            // (mixed host/client versions are normal); drop it before the wire.
            if (
              event.type === 'explanationsChanged' &&
              clientCapabilities?.includes(AGENT_EXPLANATIONS_RUNTIME_CAPABILITY) !== true
            ) {
              return
            }
            emit(event)
          },
          { consumesTerminalSideEffects: clientKind !== 'mobile' }
        )

        const seq = ++clientEventSubscriptionSeq
        const subscriptionId = `runtime-client-events-${connectionId ?? 'inproc'}-${seq}`
        runtime.registerSubscriptionCleanup(
          subscriptionId,
          () => {
            unsubscribe()
            emit({ type: 'end' })
            resolve()
          },
          connectionId
        )

        // Why: listener-first snapshotting closes the subscribe race while restoring state missed during disconnects.
        for (const event of runtime.getTerminalSleepClientEventSnapshot?.() ?? []) {
          emit(event)
        }
        for (const event of runtime.getNativeChatLaunchDraftResolutionClientEventSnapshot?.() ??
          []) {
          emit(event)
        }
        const sshStates = listRegisteredSshTargets().flatMap((target) => {
          const state = getPublicSshState(getRegisteredSshState(target.id) ?? null)
          return state ? [{ targetId: target.id, state }] : []
        })
        // Why: attaching the listener before snapshotting closes the reload gap without exposing HUB-private target configuration.
        emit({ type: 'ready', subscriptionId, snapshot: { sshStates } })
      })
    }
  }),
  defineMethod({
    name: 'runtime.clientEvents.unsubscribe',
    params: ClientEventsUnsubscribeParams,
    handler: async (params, { runtime, connectionId }) => {
      const expectedPrefix = `runtime-client-events-${connectionId ?? 'inproc'}-`
      if (!params.subscriptionId.startsWith(expectedPrefix)) {
        return { unsubscribed: false }
      }
      runtime.cleanupSubscription(params.subscriptionId)
      return { unsubscribed: true }
    }
  })
]
