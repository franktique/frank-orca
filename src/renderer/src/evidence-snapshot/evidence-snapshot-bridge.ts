import type { EvidenceSnapshotPaintedMessage } from '../../../shared/test-orchestrator/evidence-snapshot-card'

export type EvidenceSnapshotBridge = {
  onRender: (listener: (message: unknown) => void) => () => void
  painted: (message: EvidenceSnapshotPaintedMessage) => void
}

/** Reads the preload-exposed bridge; null when the page runs without the preload. */
export function getEvidenceSnapshotBridge(): EvidenceSnapshotBridge | null {
  const bridge: unknown = Reflect.get(window, 'evidenceSnapshot')
  if (typeof bridge !== 'object' || bridge === null) {
    return null
  }
  const onRender: unknown = Reflect.get(bridge, 'onRender')
  const painted: unknown = Reflect.get(bridge, 'painted')
  if (typeof onRender !== 'function' || typeof painted !== 'function') {
    return null
  }
  return {
    onRender: (listener) => {
      const off: unknown = Reflect.apply(onRender, bridge, [listener])
      return typeof off === 'function' ? () => Reflect.apply(off, undefined, []) : () => undefined
    },
    painted: (message) => {
      Reflect.apply(painted, bridge, [message])
    }
  }
}
