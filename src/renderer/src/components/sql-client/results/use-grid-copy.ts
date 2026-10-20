import { useCallback, useEffect, useRef, useState } from 'react'
import { translate } from '@/i18n/i18n'

const FEEDBACK_MS = 1500

/** Clipboard writes for the grid, with a brief per-cell flash and a screen-reader announcement. */
export function useGridCopy(): {
  copiedCell: string | null
  announcement: string
  copy: (text: string, cellKey: string | null, announcement: string) => void
} {
  const [copiedCell, setCopiedCell] = useState<string | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const timer = useRef<number | null>(null)

  useEffect(
    () => () => {
      if (timer.current !== null) {
        window.clearTimeout(timer.current)
      }
    },
    []
  )

  const copy = useCallback((text: string, cellKey: string | null, message: string): void => {
    void window.api.ui.writeClipboardText(text).then(
      () => {
        setCopiedCell(cellKey)
        setAnnouncement(message)
        if (timer.current !== null) {
          window.clearTimeout(timer.current)
        }
        timer.current = window.setTimeout(() => {
          timer.current = null
          setCopiedCell(null)
          setAnnouncement('')
        }, FEEDBACK_MS)
      },
      () => setAnnouncement(translate('sqlClient.grid.copyFailed', 'Copy failed'))
    )
  }, [])

  return { copiedCell, announcement, copy }
}
