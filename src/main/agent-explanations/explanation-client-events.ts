/**
 * Store → client-event forwarding for agent change explanations (specs/002):
 * a publish/clear anywhere becomes `explanationsChanged` on the runtime's
 * client-event bus, for paired clients (T022).
 */
import type { RuntimeClientEventBus } from '../runtime/runtime-client-event-bus'
import { getExplanationStore, type ExplanationStore } from './explanation-store'

/** One subscription for the process-lifetime store; per-client capability
 *  gating happens where the event stream is written, not here. */
export function forwardExplanationStoreEvents(
  clientEvents: Pick<RuntimeClientEventBus, 'emit'>,
  store: Pick<ExplanationStore, 'subscribe'> = getExplanationStore()
): () => void {
  return store.subscribe(({ workspaceId, revision }) =>
    clientEvents.emit({ type: 'explanationsChanged', workspaceId, revision })
  )
}
