import { useEffect, useState } from 'react'
import { ChevronDown, Loader2, Pause, Play, Square, Video } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import { isWebClientLocation } from '@/lib/web-client-location'
import type { MarkupCaptureSource } from '../annotate/markup-base-image'
import { formatRecordingElapsed } from './recording-clock'
import {
  isRecordingFormatSupported,
  readPreferredRecordingFormat,
  RECORDING_FORMATS,
  writePreferredRecordingFormat,
  type RecordingFormat
} from './recording-format'
import { MAX_PAGE_RECORDING_MS, useBrowserPageRecorder } from './use-browser-page-recorder'

const FORMAT_NAMES: Record<RecordingFormat, string> = { gif: 'GIF', mp4: 'MP4', webm: 'WebM' }

function formatHint(format: RecordingFormat): string | null {
  if (!isRecordingFormatSupported(format)) {
    return translate(
      'auto.components.browser-pane.recording.formatUnsupported',
      'Not supported on this system'
    )
  }
  if (format === 'mp4') {
    return translate('auto.components.browser-pane.recording.formatMp4Hint', 'Smallest file')
  }
  return null
}

/** Records the visible page: Record (GIF/MP4/WebM) → Pause/Resume + Stop → save dialog. */
export function RecordPageControl({
  getSource,
  disabled = false,
  className = 'h-7 w-7'
}: {
  getSource: () => MarkupCaptureSource | null
  disabled?: boolean
  className?: string
}): React.JSX.Element | null {
  const recorder = useBrowserPageRecorder(getSource)
  const [preferredFormat, setPreferredFormat] = useState(readPreferredRecordingFormat)
  const [formatMenuOpen, setFormatMenuOpen] = useState(false)

  // Why: clicks inside the <webview> never reach the renderer, so Radix outside-click misses them.
  useEffect(() => {
    if (!formatMenuOpen) {
      return
    }
    const close = (): void => setFormatMenuOpen(false)
    window.addEventListener('blur', close)
    return () => window.removeEventListener('blur', close)
  }, [formatMenuOpen])

  // Why: paired web clients have no local save dialog to stream the recording into.
  if (isWebClientLocation()) {
    return null
  }

  if (recorder.status === 'idle' || recorder.status === 'saving') {
    const saving = recorder.status === 'saving'
    const label = saving
      ? translate('auto.components.browser-pane.recording.saving', 'Saving recording…')
      : translate('auto.components.browser-pane.recording.start', 'Record {{value0}}', {
          value0: FORMAT_NAMES[preferredFormat]
        })
    const formatMenuLabel = translate(
      'auto.components.browser-pane.recording.formatMenu',
      'Recording format'
    )
    return (
      <span className="inline-flex items-center">
        <Tooltip>
          <TooltipTrigger asChild>
            {/* Why: disabled <button> drops hover events, so wrap in a span so the tooltip still fires. */}
            <span className="inline-flex">
              <Button
                size="icon"
                variant="ghost"
                className={className}
                onClick={() => recorder.start(preferredFormat)}
                disabled={disabled || saving}
                aria-label={label}
              >
                {saving ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Video className="size-4" />
                )}
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={4}>
            {label}
          </TooltipContent>
        </Tooltip>
        <DropdownMenu open={formatMenuOpen} onOpenChange={setFormatMenuOpen}>
          <DropdownMenuTrigger asChild>
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-4"
              disabled={saving}
              aria-label={formatMenuLabel}
              title={formatMenuLabel}
            >
              <ChevronDown className="size-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>{formatMenuLabel}</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={preferredFormat}
              onValueChange={(value) => {
                const next = RECORDING_FORMATS.find((format) => format === value)
                if (next) {
                  setPreferredFormat(next)
                  writePreferredRecordingFormat(next)
                }
              }}
            >
              {RECORDING_FORMATS.map((format) => {
                const hint = formatHint(format)
                return (
                  <DropdownMenuRadioItem
                    key={format}
                    value={format}
                    disabled={!isRecordingFormatSupported(format)}
                  >
                    {FORMAT_NAMES[format]}
                    {hint ? (
                      <span className="ml-auto pl-3 text-xs text-muted-foreground">{hint}</span>
                    ) : null}
                  </DropdownMenuRadioItem>
                )
              })}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </span>
    )
  }

  const formatName = FORMAT_NAMES[recorder.format ?? preferredFormat]
  const paused = recorder.status === 'paused'
  const elapsed = formatRecordingElapsed(recorder.elapsedMs)
  const statusLabel = paused
    ? translate('auto.components.browser-pane.recording.paused', 'Recording paused')
    : translate('auto.components.browser-pane.recording.recording', 'Recording {{value0}}', {
        value0: formatName
      })
  const pauseLabel = paused
    ? translate('auto.components.browser-pane.recording.resume', 'Resume recording')
    : translate('auto.components.browser-pane.recording.pause', 'Pause recording')
  const stopLabel = translate(
    'auto.components.browser-pane.recording.stop',
    'Stop and save {{value0}}',
    {
      value0: formatName
    }
  )

  return (
    <div
      className="flex h-7 items-center gap-0.5 rounded-md border border-border pl-2"
      role="group"
      aria-label={statusLabel}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="flex items-center gap-1.5 pr-1">
            <span
              className={cn(
                'size-2 rounded-full',
                paused ? 'bg-muted-foreground' : 'animate-pulse bg-destructive'
              )}
            />
            <span className="text-xs tabular-nums text-foreground">{elapsed}</span>
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom" sideOffset={4}>
          {translate(
            'auto.components.browser-pane.recording.status',
            '{{value0}} · {{value1}} / {{value2}} · {{value3}} frames',
            {
              value0: statusLabel,
              value1: elapsed,
              value2: formatRecordingElapsed(MAX_PAGE_RECORDING_MS),
              value3: recorder.frameCount
            }
          )}
        </TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6"
            onClick={paused ? recorder.resume : recorder.pause}
            aria-label={pauseLabel}
          >
            {paused ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom" sideOffset={4}>
          {pauseLabel}
        </TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6"
            onClick={() => void recorder.stop()}
            aria-label={stopLabel}
          >
            <Square className="size-3.5 fill-current" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom" sideOffset={4}>
          {stopLabel}
        </TooltipContent>
      </Tooltip>
    </div>
  )
}
