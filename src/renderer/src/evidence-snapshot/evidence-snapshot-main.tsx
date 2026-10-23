import '../lib/react-devtools-commit-hook-shim'
import '../assets/main.css'

import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { applyDocumentTheme } from '../lib/document-theme'
import {
  EVIDENCE_SNAPSHOT_WIDTH,
  evidenceSnapshotRenderMessageSchema,
  type EvidenceSnapshotRenderMessage
} from '../../../shared/test-orchestrator/evidence-snapshot-card'
import QueryEvidenceCard from './QueryEvidenceCard'
import RequestEvidenceCard from './RequestEvidenceCard'
import { getEvidenceSnapshotBridge } from './evidence-snapshot-bridge'

// Why: evidence looks the same whatever theme the user runs (R6).
applyDocumentTheme('light', { disableTransitions: false })

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()))
}

function EvidenceSnapshotRoot(): React.JSX.Element | null {
  const [message, setMessage] = useState<EvidenceSnapshotRenderMessage | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(
    () =>
      getEvidenceSnapshotBridge()?.onRender((raw) => {
        const parsed = evidenceSnapshotRenderMessageSchema.safeParse(raw)
        if (parsed.success) {
          setMessage(parsed.data)
        }
      }),
    []
  )

  useEffect(() => {
    if (!message) {
      return
    }
    let cancelled = false
    void (async () => {
      // Why: two frames so layout and paint settle before main captures the page.
      await nextFrame()
      await nextFrame()
      const container = containerRef.current
      if (cancelled || !container) {
        return
      }
      getEvidenceSnapshotBridge()?.painted({
        token: message.token,
        width: EVIDENCE_SNAPSHOT_WIDTH,
        height: Math.ceil(container.getBoundingClientRect().height)
      })
    })()
    return () => {
      cancelled = true
    }
  }, [message])

  if (!message) {
    return null
  }
  return (
    <div ref={containerRef} style={{ width: EVIDENCE_SNAPSHOT_WIDTH }}>
      {message.card.kind === 'query' ? (
        <QueryEvidenceCard card={message.card} />
      ) : (
        <RequestEvidenceCard card={message.card} />
      )}
    </div>
  )
}

const rootElement = document.getElementById('root')
if (!rootElement) {
  throw new Error('Evidence snapshot root element not found.')
}
createRoot(rootElement).render(<EvidenceSnapshotRoot />)
