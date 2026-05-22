"use client"

import { ArrowUp, LoaderCircle, Square, X } from "lucide-react"
import type { VoiceRecorderState } from "@/hooks/useVoiceRecorder"

const WAVEFORM_BAR_COUNT = 24

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
  onStop: () => void
  onSubmit: () => void
  onDiscard: () => void
}

export function VoiceRecorderControls({
  state,
  waveformData,
  duration,
  isSubmitting,
  errorMessage = null,
  onStop,
  onSubmit,
  onDiscard,
}: VoiceRecorderControlsProps) {
  const bars = buildWaveformBars(waveformData)
  const canSubmit = state === "stopped" && !isSubmitting

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-end gap-1 rounded-[10px] bg-bg/70 px-2 py-2">
        {bars.map((bar, index) => {
          const height = 8 + Math.round(bar * 28)
          return (
            <span
              key={`${index}-${bar}`}
              aria-hidden="true"
              className="w-1 flex-1 rounded-full bg-cursor/80 transition-[height,opacity] duration-150"
              style={{
                height,
                opacity: state === "requesting" ? 0.45 : 1,
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
            {state === "requesting" ? "Allow microphone access…" : formatVoiceRecorderDuration(duration)}
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

          <button
            type="button"
            onClick={onStop}
            disabled={state !== "recording"}
            className="inline-flex h-8 w-8 items-center justify-center rounded-[8px] border-[0.5px] border-border text-ink transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
            aria-label="Stop recording"
          >
            <Square className="h-3.5 w-3.5 fill-current" strokeWidth={1.5} />
          </button>

          <button
            type="button"
            onClick={onSubmit}
            disabled={!canSubmit}
            className="inline-flex h-8 w-8 items-center justify-center rounded-[8px] bg-ink text-bg transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            aria-label={isSubmitting ? "Transcribing recording" : "Submit recording"}
          >
            {isSubmitting ? <LoaderCircle className="h-4 w-4 animate-spin" strokeWidth={1.5} /> : <ArrowUp className="h-4 w-4" strokeWidth={1.5} />}
          </button>
        </div>
      </div>

      {errorMessage ? <p className="font-sans text-[12px] leading-relaxed text-destructive">{errorMessage}</p> : null}
    </div>
  )
}
