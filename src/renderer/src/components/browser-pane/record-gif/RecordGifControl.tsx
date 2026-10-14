import { Loader2, Pause, Play, Square, Video } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import { isWebClientLocation } from '@/lib/web-client-location'
import type { MarkupCaptureSource } from '../annotate/markup-base-image'
import { formatGifRecordingElapsed } from './gif-recording-clock'
import { MAX_GIF_RECORDING_MS, useBrowserGifRecorder } from './use-browser-gif-recorder'

/** Records the visible page into a GIF: Record → Pause/Resume + Stop → save dialog. */
export function RecordGifControl({
  getSource,
  disabled = false,
  className = 'h-7 w-7'
}: {
  getSource: () => MarkupCaptureSource | null
  disabled?: boolean
  className?: string
}): React.JSX.Element | null {
  const recorder = useBrowserGifRecorder(getSource)

  // Why: paired web clients have no local save dialog to stream the GIF into.
  if (isWebClientLocation()) {
    return null
  }

  if (recorder.status === 'idle' || recorder.status === 'saving') {
    const saving = recorder.status === 'saving'
    const label = saving
      ? translate('auto.components.browser-pane.recordGif.saving', 'Saving GIF…')
      : translate('auto.components.browser-pane.recordGif.start', 'Record GIF')
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          {/* Why: disabled <button> drops hover events, so wrap in a span so the tooltip still fires. */}
          <span className="inline-flex">
            <Button
              size="icon"
              variant="ghost"
              className={className}
              onClick={recorder.start}
              disabled={disabled || saving}
              aria-label={label}
            >
              {saving ? <Loader2 className="size-4 animate-spin" /> : <Video className="size-4" />}
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom" sideOffset={4}>
          {label}
        </TooltipContent>
      </Tooltip>
    )
  }

  const paused = recorder.status === 'paused'
  const elapsed = formatGifRecordingElapsed(recorder.elapsedMs)
  const statusLabel = paused
    ? translate('auto.components.browser-pane.recordGif.paused', 'Recording paused')
    : translate('auto.components.browser-pane.recordGif.recording', 'Recording GIF')
  const pauseLabel = paused
    ? translate('auto.components.browser-pane.recordGif.resume', 'Resume recording')
    : translate('auto.components.browser-pane.recordGif.pause', 'Pause recording')
  const stopLabel = translate('auto.components.browser-pane.recordGif.stop', 'Stop and save GIF')

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
            'auto.components.browser-pane.recordGif.status',
            '{{value0}} · {{value1}} / {{value2}} · {{value3}} frames',
            {
              value0: statusLabel,
              value1: elapsed,
              value2: formatGifRecordingElapsed(MAX_GIF_RECORDING_MS),
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
