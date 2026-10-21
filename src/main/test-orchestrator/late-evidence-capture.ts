// Why: query hooks are built before the run's evidence session exists, so they get a late-bound capture.
import type { StepEvidenceCapture } from './test-run-step-executor'

export type EvidenceCaptureSlot = { current?: StepEvidenceCapture }

export function lateEvidenceCapture(slot: EvidenceCaptureSlot): StepEvidenceCapture {
  const target = (): StepEvidenceCapture => {
    if (!slot.current) {
      throw new Error('Run evidence is not available.')
    }
    return slot.current
  }
  return {
    renderer: { render: (card) => target().renderer.render(card) },
    writeImage: (order, stepId, role, png) => target().writeImage(order, stepId, role, png)
  }
}
