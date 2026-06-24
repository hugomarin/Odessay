"use client"

import { useEffect, useRef, useState } from "react"
import { Mic } from "lucide-react"
import { VoiceRecorderControls } from "./voice-recorder-controls"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { useVoiceRecorder } from "@/hooks/useVoiceRecorder"
import { transcribeVoiceNote } from "@/lib/services/transcription/transcribe-voice-note"
import { getEditorShortcutAction } from "@/lib/editor/shortcuts"

type AnnotationBubbleProps = {
  position: { x: number; y: number } | null
  type?: "personal" | "ai" | "footnote"
  onConfirm: (note: string) => void | Promise<void>
  onCancel: () => void
}

const AI_QUICK_CHIPS = ["eliminar", "modificar", "expandir", "valida esto", "simplifica", "mantén tono"]

export function AnnotationBubble({ position, type = "personal", onConfirm, onCancel }: AnnotationBubbleProps) {
  const [note, setNote] = useState("")
  const [isSubmittingVoice, setIsSubmittingVoice] = useState(false)
  const [voiceError, setVoiceError] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const {
    state,
    start,
    stop,
    pause,
    resume,
    reset,
    blob,
    waveformData,
    duration,
    permissionDenied,
    isSupported,
    errorMessage,
  } = useVoiceRecorder()
  const supportsVoice = type === "personal" || type === "ai"
  const isVoiceMode = supportsVoice && state !== "idle"

  // Focus textarea when shown
  useEffect(() => {
    if (position) {
      setNote("")
      setVoiceError(null)
      setIsSubmittingVoice(false)
      reset()
      requestAnimationFrame(() => textareaRef.current?.focus())
    }
  }, [position, reset])

  useEffect(() => {
    if (errorMessage) {
      setVoiceError(errorMessage)
    }
  }, [errorMessage])

  // For AI type: auto-transcribe when recording stops and load text into textarea
  useEffect(() => {
    if (type !== "ai" || state !== "stopped" || !blob) return

    setVoiceError(null)
    setIsSubmittingVoice(true)

    transcribeVoiceNote(blob)
      .then((transcript) => {
        setNote(transcript)
        reset()
        requestAnimationFrame(() => textareaRef.current?.focus())
      })
      .catch((err: unknown) => {
        setVoiceError(err instanceof Error ? err.message : "Transcription failed.")
      })
      .finally(() => {
        setIsSubmittingVoice(false)
      })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, blob, type])

  // Dismiss on Escape, confirm on Enter (without shift)
  useEffect(() => {
    if (!position) return

    function handleKeydown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onCancel()
      }
    }

    document.addEventListener("keydown", handleKeydown)
    return () => document.removeEventListener("keydown", handleKeydown)
  }, [position, onCancel])

  // Toggle voice recording with the global voice-note shortcut (⌘⌥R / Ctrl+Alt+R)
  // when the bubble is open. Capture phase runs before the editor-shell handler.
  useEffect(() => {
    if (!position || !supportsVoice) return

    function handleKeydown(event: KeyboardEvent) {
      const action = getEditorShortcutAction(event)
      if (action !== "voiceNote") return

      event.preventDefault()
      event.stopPropagation()

      if (state === "idle" || state === "stopped") {
        setVoiceError(null)
        void start()
      } else if (state === "recording" || state === "paused") {
        stop()
      }
    }

    window.addEventListener("keydown", handleKeydown, true)
    return () => window.removeEventListener("keydown", handleKeydown, true)
  }, [position, supportsVoice, state, start, stop])

  if (!position) return null

  async function handleConfirm() {
    const trimmed = note.trim()
    if (type !== "personal" && !trimmed) return
    await onConfirm(type === "personal" ? trimmed : trimmed)
  }

  async function handleVoiceSubmit() {
    if (!blob) return

    setVoiceError(null)
    setIsSubmittingVoice(true)

    try {
      const transcript = await transcribeVoiceNote(blob)
      await onConfirm(transcript)
      reset()
    } catch (error) {
      setVoiceError(error instanceof Error ? error.message : "Transcription failed.")
    } finally {
      setIsSubmittingVoice(false)
    }
  }

  const isMicDisabled = !isSupported || permissionDenied
  const micTooltipMessage = !isSupported
    ? "Voice recording is not supported in this browser."
    : "Microphone permission denied. Enable it in your browser settings."

  const micButton = (
    <button
      type="button"
      onClick={() => {
        setVoiceError(null)
        void start()
      }}
      disabled={isMicDisabled}
      className="inline-flex h-8 w-8 items-center justify-center rounded-[8px] border-[0.5px] border-border text-ink transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
      aria-label="Record a voice note"
    >
      <Mic className="h-4 w-4" strokeWidth={1.5} />
    </button>
  )

  const canSubmitText = type === "personal" || note.trim().length > 0

  function handleDiscardVoice() {
    setVoiceError(null)
    setIsSubmittingVoice(false)
    reset()
  }

  return (
    <div
      ref={containerRef}
      id="annotation-bubble"
      data-section="annotation-bubble"
      data-testid="annotation-bubble"
      className="AnnotationBubble rounded-[12px] border-[0.5px] border-border bg-sb shadow-float-lg"
      style={{
        position: "fixed",
        left: position.x,
        top: position.y,
        transform: "translateX(-50%)",
        width: 260,
        zIndex: 50,
        padding: "10px 12px",
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      {isVoiceMode ? (
        <VoiceRecorderControls
          state={state}
          waveformData={waveformData}
          duration={duration}
          isSubmitting={isSubmittingVoice}
          errorMessage={voiceError}
          hideSubmit={type === "ai"}
          onPause={pause}
          onResume={resume}
          onStop={stop}
          onSubmit={() => {
            void handleVoiceSubmit()
          }}
          onDiscard={handleDiscardVoice}
        />
      ) : (
        <textarea
          ref={textareaRef}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault()
              void handleConfirm()
            }
          }}
          placeholder={type === "footnote" ? "Write your footnote…" : type === "ai" ? "Write your AI instruction…" : "Write your highlight note…"}
          rows={3}
          className="w-full resize-none rounded-[6px] bg-transparent font-sans text-[13px] text-ink-2 placeholder:text-ink-4 focus:outline-none"
          style={{ border: "none" }}
          aria-label="Annotation text"
        />
      )}
      {type === "ai" ? (
        <div className="flex flex-wrap gap-1">
          {AI_QUICK_CHIPS.map((chip) => (
            <button
              key={chip}
              onClick={() => setNote((current) => (current ? `${current} ${chip}` : chip))}
              className="rounded-[6px] border-[0.5px] border-border bg-bg px-2 py-1 font-sans text-[11px] text-ink-3 transition-colors hover:bg-muted hover:text-ink-2"
              type="button"
            >
              {chip}
            </button>
          ))}
        </div>
      ) : null}
      <div className="flex items-center justify-end gap-2">
        <button
          onClick={onCancel}
          className="rounded-[7px] px-3 py-1 font-sans text-[12px] text-ink-3 transition-colors hover:bg-muted hover:text-ink-2"
        >
          Cancel
        </button>
        {supportsVoice && !isVoiceMode ? (
          isMicDisabled ? (
            <TooltipProvider delayDuration={120}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex">{micButton}</span>
                </TooltipTrigger>
                <TooltipContent side="top" align="center">
                  {micTooltipMessage}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ) : (
            micButton
          )
        ) : null}
        <button
          onClick={() => {
            void handleConfirm()
          }}
          disabled={!canSubmitText || isVoiceMode}
          className="rounded-[7px] bg-ink px-3 py-1 font-sans text-[12px] font-medium text-bg transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {type === "footnote" ? "Add footnote" : "Save"}
        </button>
      </div>
    </div>
  )
}
