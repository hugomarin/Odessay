"use client"

import { ArrowUp, LoaderCircle, Pause, Play, Square, X } from "lucide-react"
import type { VoiceRecorderState } from "@/hooks/useVoiceRecorder"

const WAVEFORM_BAR_COUNT = 20

export function formatVoiceRecorderDuration(duration: number) {
  const safeDuration = Math.max(0, duration)
  const minutes = Math.floor(safeDuration / 60)
  const seconds = safeDuration % 60
  return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`
}

export function buildWaveformBars(waveformData: number[], count = WAVEFORM_BAR_COUNT) {
  const trimmed = waveformData.slice(-count)
  const leading = Array.from({ length: Math.max(0, count - trimmed.length) }, () => 0)
  return [...leading, ...trimmed]
}

type VoiceRecorderControlsProps = {
  state: VoiceRecorderState
  waveformData: number[]
  duration: number
  isSubmitting: boolean
  errorMessage?: string | null
  hideSubmit?: boolean
  onPause: () => void
  onResume: () => void
  onStop: () => void
  onSubmit: () => void
  /**
   * Re-run transcription with the recording that is already captured (ODE-409).
   * Rendered next to a failure so the writer can recover without re-recording.
   */
  onRetry?: () => void
  onDiscard: () => void
}

export function VoiceRecorderControls({
  state,
  waveformData,
  duration,
  isSubmitting,
  errorMessage = null,
  hideSubmit = false,
  onPause,
  onResume,
  onStop,
  onSubmit,
  onRetry,
  onDiscard,
}: VoiceRecorderControlsProps) {
  const bars = buildWaveformBars(waveformData)
  const canSubmit = state === "stopped" && !isSubmitting
  const canStop = state === "recording" || state === "paused"
  // A failed transcription keeps its blob, so the recording can be retried.
  // A failed *recording* has nothing to retry — only the message applies.
  const canRecover = Boolean(onRetry) && state === "stopped"

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-end justify-center gap-[3px] rounded-[10px] bg-bg/70 px-3 py-3">
        {bars.map((bar, index) => {
          const height = 6 + Math.round(bar * 26)
          return (
            <span
              key={`${index}-${bar}`}
              aria-hidden="true"
              className="w-[3px] shrink-0 rounded-full bg-cursor/80 transition-[height,opacity] duration-150"
              style={{
                height,
                opacity: state === "requesting" ? 0.35 : 1,
              }}
            />
          )
        })}
      </div>

      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col">
          <span className="font-sans text-[11px] uppercase tracking-[0.07em] text-ink-4">
            {state === "requesting" ? "Microphone" : "Voice note"}
          </span>
          <span className="font-sans text-[13px] text-ink-2">
            {state === "requesting"
              ? "Allow microphone access…"
              : state === "paused"
                ? `Paused at ${formatVoiceRecorderDuration(duration)}`
                : formatVoiceRecorderDuration(duration)}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onDiscard}
            className="inline-flex h-8 w-8 items-center justify-center rounded-[8px] text-ink-3 transition-colors hover:bg-muted hover:text-ink-2"
            aria-label="Discard recording"
          >
            <X className="h-4 w-4" strokeWidth={1.5} />
          </button>

          {state === "recording" ? (
            <button
              type="button"
              onClick={onPause}
              className="inline-flex h-8 w-8 items-center justify-center rounded-[8px] border-[0.5px] border-border text-ink transition-colors hover:bg-muted"
              aria-label="Pause recording"
            >
              <Pause className="h-4 w-4" strokeWidth={1.5} />
            </button>
          ) : state === "paused" ? (
            <button
              type="button"
              onClick={onResume}
              className="inline-flex h-8 w-8 items-center justify-center rounded-[8px] border-[0.5px] border-border text-ink transition-colors hover:bg-muted"
              aria-label="Resume recording"
            >
              <Play className="h-4 w-4" strokeWidth={1.5} />
            </button>
          ) : null}

          <button
            type="button"
            onClick={onStop}
            disabled={!canStop}
            className="inline-flex h-8 w-8 items-center justify-center rounded-[8px] transition-colors disabled:cursor-not-allowed disabled:opacity-40"
            style={canStop ? { background: "#ef4444", color: "#fff" } : { border: "0.5px solid var(--border)", color: "var(--ink)" }}
            aria-label="Stop recording"
          >
            <Square className="h-3.5 w-3.5 fill-current" strokeWidth={1.5} />
          </button>

          {hideSubmit ? (
            isSubmitting ? (
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-[8px] bg-ink text-bg opacity-90">
                <LoaderCircle className="h-4 w-4 animate-spin" strokeWidth={1.5} />
              </span>
            ) : null
          ) : (
            <button
              type="button"
              onClick={onSubmit}
              disabled={!canSubmit}
              className="inline-flex h-8 w-8 items-center justify-center rounded-[8px] bg-ink text-bg transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
              aria-label={isSubmitting ? "Transcribing recording" : "Submit recording"}
            >
              {isSubmitting ? <LoaderCircle className="h-4 w-4 animate-spin" strokeWidth={1.5} /> : <ArrowUp className="h-4 w-4" strokeWidth={1.5} />}
            </button>
          )}
        </div>
      </div>

      {errorMessage ? (
        <div className="flex flex-col gap-2" data-testid="voice-recorder-error">
          <p className="font-sans text-[12px] leading-relaxed text-destructive">{errorMessage}</p>
          {canRecover ? (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onRetry}
                disabled={isSubmitting}
                className="rounded-[7px] border-[0.5px] border-border px-3 py-1 font-sans text-[12px] text-ink-2 transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
              >
                Retry
              </button>
              <button
                type="button"
                onClick={onDiscard}
                className="rounded-[7px] px-3 py-1 font-sans text-[12px] text-ink-3 transition-colors hover:bg-muted hover:text-ink-2"
              >
                Discard
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
